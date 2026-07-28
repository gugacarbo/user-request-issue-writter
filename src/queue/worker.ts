import type { DB } from "../db";
import type { GitHubClient } from "../github/github";
import { prepareScreenshotMarkdown } from "../issue/screenshot";
import { buildIssueBody, toTicketHeaderInput } from "../issue/template";
import type { GenerateIssueInput, IssueContext, LlmClient } from "../llm/llm";
import { generateIssue } from "../llm/llm";
import { extractTicket } from "../web/webhook";
import type { QueueDeps } from "./queue";
import {
	appendLlmLog,
	claimNextDue,
	finalizeProcessing,
	getRequest,
	requeueForRetry,
	requeueStaleProcessing,
} from "./queue";

export type WorkerDeps = {
	readonly db: DB;
	readonly github: GitHubClient;
	readonly llm: LlmClient;
	/** Optional NocoBase token to fetch authenticated screenshot attachments. */
	readonly nocobaseToken?: string;
	/** Public NocoBase origin used to resolve relative attachment paths. */
	readonly nocobasePublicUrl?: string;
	/** Poll interval in ms (default 1000). */
	readonly pollIntervalMs?: number;
	/** Hard cap on attempts before giving up (default 3). */
	readonly maxAttempts?: number;
	/**
	 * Seconds to wait before the next pickup after a retryable failure.
	 * Receives the current `queue.attempts` (post-claim). Defaults to
	 * exponential backoff capped at 5 minutes.
	 */
	readonly retryBackoffSeconds?: (attempts: number) => number;
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
	const retryBackoffSeconds =
		deps.retryBackoffSeconds ?? defaultRetryBackoffSeconds;
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
			await processOne(deps, queueDeps, maxAttempts, retryBackoffSeconds, log);
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

function defaultRetryBackoffSeconds(attempts: number): number {
	const exponent = Math.max(0, attempts - 1);
	return Math.min(300, 5 * 2 ** exponent);
}

async function processOne(
	deps: WorkerDeps,
	queueDeps: QueueDeps,
	maxAttempts: number,
	retryBackoffSeconds: (attempts: number) => number,
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

	const ticket = parseStoredTicket(request.payload, deps.nocobasePublicUrl);
	if (!ticket) {
		finalizeProcessing(queueDeps, {
			queueId,
			requestId,
			status: "failed",
			lastError: "invalid stored ticket payload",
		});
		return;
	}

	const input: GenerateIssueInput = {
		owner: ticket.owner,
		repo: ticket.repo,
		requesterName: ticket.requesterName,
		requesterEmail: ticket.requesterEmail,
		descricao: ticket.descricao,
		context: ticketContextFromTicket(ticket),
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
			handleRetryableFailure(queueDeps, {
				queueId,
				requestId,
				attempts,
				maxAttempts,
				lastError: "agent did not call submit_issue",
				retryBackoffSeconds,
				log,
			});
			return;
		}

		const screenshotMarkdown = await prepareScreenshotMarkdown({
			screenshot: ticket.screenshot,
			owner: input.owner,
			repo: input.repo,
			github: deps.github,
			nocobaseToken: deps.nocobaseToken,
			nocobasePublicUrl: deps.nocobasePublicUrl,
		});
		const body = buildIssueBody({
			agentBody: proposal.body,
			rawUserMessage: input.descricao,
			ticket: toTicketHeaderInput(ticket),
			screenshotMarkdown,
			requesterName: input.requesterName,
			requesterEmail: input.requesterEmail,
		});
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
		handleRetryableFailure(queueDeps, {
			queueId,
			requestId,
			attempts,
			maxAttempts,
			lastError: message,
			retryBackoffSeconds,
			log,
		});
	}
}

function handleRetryableFailure(
	queueDeps: QueueDeps,
	input: {
		readonly queueId: number;
		readonly requestId: number;
		readonly attempts: number;
		readonly maxAttempts: number;
		readonly lastError: string;
		readonly retryBackoffSeconds: (attempts: number) => number;
		readonly log: NonNullable<WorkerDeps["log"]>;
	},
): void {
	if (input.attempts >= input.maxAttempts) {
		finalizeProcessing(queueDeps, {
			queueId: input.queueId,
			requestId: input.requestId,
			status: "failed",
			lastError: input.lastError,
		});
		input.log("error", "worker run failed", {
			requestId: input.requestId,
			error: input.lastError,
			attempts: input.attempts,
		});
		return;
	}

	const now = Math.floor(Date.now() / 1000);
	const backoffSeconds = input.retryBackoffSeconds(input.attempts);
	requeueForRetry(queueDeps, {
		queueId: input.queueId,
		requestId: input.requestId,
		lastError: input.lastError,
		nextRunAt: now + backoffSeconds,
	});
	input.log("info", "worker scheduled retry", {
		requestId: input.requestId,
		attempts: input.attempts,
		backoffSeconds,
		error: input.lastError,
	});
}

function parseStoredTicket(payloadJson: string, nocobasePublicUrl?: string) {
	try {
		return extractTicket(
			JSON.parse(payloadJson) as Parameters<typeof extractTicket>[0],
			{ nocobasePublicUrl },
		);
	} catch {
		return null;
	}
}

function ticketContextFromTicket(
	ticket: NonNullable<ReturnType<typeof parseStoredTicket>>,
): IssueContext | undefined {
	const context: IssueContext = {
		urlAtual: ticket.urlAtual,
		categoria: ticket.categoria,
		contextoSessao: ticket.contextoSessao,
		logsConsole: ticket.logsConsole,
		logsRede: ticket.logsRede,
		screenshot: ticket.screenshot,
		metadata: ticket.metadata,
	};
	const hasContext = Object.values(context).some(
		(value) => value !== undefined,
	);
	return hasContext ? context : undefined;
}
