import type { DB } from "../db";
import type { GitHubClient } from "../github/github";
import type { GenerateIssueInput, LlmClient } from "../llm/llm";
import { generateIssue } from "../llm/llm";
import type { QueueDeps } from "./queue";
import {
	appendLlmLog,
	claimNextDue,
	finalizeProcessing,
	getRequest,
	requeueStaleProcessing,
} from "./queue";

export type WorkerDeps = {
	readonly db: DB;
	readonly github: GitHubClient;
	readonly llm: LlmClient;
	/** Poll interval in ms (default 1000). */
	readonly pollIntervalMs?: number;
	/** Hard cap on attempts before giving up (default 3). */
	readonly maxAttempts?: number;
	/** Logger sink for worker lifecycle; defaults to console. */
	readonly log?: (level: "info" | "error", msg: string, data?: unknown) => void;
};

/**
 * Persistent queue worker (ADR-0008). Polls the `queue` table for `pending`
 * items at a fixed interval, claims atomically, runs the LLM tool loop with
 * every `onDebug` event persisted to `llm_logs`, creates the GitHub issue on
 * success, and finalizes the row.
 *
 * Run on boot via {@link startWorker}; stop via the returned handle.
 */
export type WorkerHandle = { readonly stop: () => Promise<void> };

export function startWorker(deps: WorkerDeps): WorkerHandle {
	const pollIntervalMs = deps.pollIntervalMs ?? 1000;
	const maxAttempts = deps.maxAttempts ?? 3;
	const log = deps.log ?? ((level, msg, data) => console[level](msg, data));
	const queueDeps: QueueDeps = { db: deps.db };

	// Reclaim rows that crashed mid-processing (ADR-0008 boot reconciliation).
	const reclaimed = requeueStaleProcessing(queueDeps);
	if (reclaimed > 0) log("info", "worker reclaimed stale rows", { reclaimed });

	let stopped = false;
	let timer: NodeJS.Timeout | null = null;
	let inFlight: Promise<void> | null = null;

	const tick = async (): Promise<void> => {
		if (stopped) return;
		try {
			await processOne(deps, queueDeps, maxAttempts, log);
		} catch (error) {
			log("error", "worker tick failed", error);
		} finally {
			if (!stopped) {
				timer = setTimeout(() => {
					inFlight = tick();
				}, pollIntervalMs);
			}
		}
	};

	inFlight = tick();

	return {
		stop: async () => {
			stopped = true;
			if (timer) clearTimeout(timer);
			await inFlight;
		},
	};
}

async function processOne(
	deps: WorkerDeps,
	queueDeps: QueueDeps,
	maxAttempts: number,
	log: NonNullable<WorkerDeps["log"]>,
): Promise<void> {
	const claimed = claimNextDue(queueDeps);
	if (!claimed) return;

	const { queueId, requestId, attempts } = claimed;
	const request = getRequest(queueDeps, requestId);
	if (!request) {
		finalizeProcessing(queueDeps, {
			queueId,
			requestId,
			status: "failed",
			lastError: "request row missing",
		});
		return;
	}

	if (attempts > maxAttempts) {
		finalizeProcessing(queueDeps, {
			queueId,
			requestId,
			status: "failed",
			lastError: `max attempts (${maxAttempts}) exceeded`,
		});
		log("info", "worker gave up", { requestId, attempts });
		return;
	}

	const input: GenerateIssueInput = {
		owner: request.owner,
		repo: request.owner
			? request.repo.slice(request.owner.length + 1)
			: request.repo,
		requesterName: request.requesterName,
		requesterEmail: request.requesterEmail,
		descricao: extractDescricao(request.payload),
	};
	try {
		const proposal = await generateIssue(deps.llm, deps.github, input, {
			onDebug: (message, data) => {
				// `iteration` is published inside `data` by the tool loop for
				// events that carry it (see llm.ts onDebug calls).
				appendLlmLog(queueDeps, {
					requestId,
					iteration:
						typeof data?.iteration === "number"
							? (data.iteration as number)
							: undefined,
					event: message,
					toolName: typeof data?.tool === "string" ? data.tool : undefined,
					data: data ?? null,
				});
			},
		});
		if (!proposal) {
			finalizeProcessing(queueDeps, {
				queueId,
				requestId,
				status: "failed",
				lastError: "agent did not call submit_issue",
			});
			log("info", "worker: agent produced no proposal", { requestId });
			return;
		}

		const body = buildIssueBody(
			proposal.body,
			input.requesterName,
			input.requesterEmail,
		);
		const created = await deps.github.createIssue(input.owner, input.repo, {
			title: proposal.title,
			body,
			labels: proposal.labels,
		});

		finalizeProcessing(queueDeps, {
			queueId,
			requestId,
			status: "done",
			issueNumber: created.number,
			issueUrl: created.url,
		});
		log("info", "worker created issue", {
			requestId,
			issueNumber: created.number,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		finalizeProcessing(queueDeps, {
			queueId,
			requestId,
			status: "failed",
			lastError: message,
		});
		log("error", "worker run failed", { requestId, error: message });
	}
}

function extractDescricao(payloadJson: string): string {
	try {
		const parsed = JSON.parse(payloadJson) as {
			payload?: { descricao?: string };
		};
		return parsed.payload?.descricao ?? "";
	} catch {
		return "";
	}
}

function buildIssueBody(
	body: string,
	requesterName: string,
	requesterEmail: string,
): string {
	return [
		body,
		"",
		"---",
		`_Requested by ${requesterName} (${requesterEmail})_`,
	].join("\n");
}
