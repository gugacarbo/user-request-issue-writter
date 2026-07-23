import Fastify, { type FastifyInstance } from "fastify";
import type { GitHubClient } from "./github.js";
import {
	type GenerateIssueInput,
	generateIssue,
	type LlmClient,
} from "./llm.js";
import { extractContext, isRelevantEvent, verifySignature } from "./webhook.js";

export type ServerDeps = {
	readonly github: GitHubClient;
	readonly llm: LlmClient;
	readonly webhookSecret: string;
	readonly triggerPrefix: string | undefined;
	readonly dedupeTtlMs?: number;
	readonly logger?: false | { readonly level: string };
};

const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;

function buildIssueBody(
	proposal: { title: string; body: string },
	commentUser: string,
	commentUrl: string,
): string {
	return [
		proposal.body,
		"",
		"---",
		`_Drafted from a comment by @${commentUser}: ${commentUrl}_`,
	].join("\n");
}

export function buildServer(deps: ServerDeps): FastifyInstance {
	const ttl = deps.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
	const seenDeliveries = new Map<string, number>();

	function isDuplicate(delivery: string): boolean {
		const now = Date.now();
		for (const [key, expires] of seenDeliveries) {
			if (expires < now) seenDeliveries.delete(key);
		}
		if (seenDeliveries.has(delivery)) return true;
		seenDeliveries.set(delivery, now + ttl);
		return false;
	}

	const server = Fastify({
		logger: deps.logger === undefined ? false : deps.logger,
	});

	server.addContentTypeParser(
		"application/json",
		{ parseAs: "buffer" },
		(_req, body, done) => done(null, body),
	);

	server.get("/health", async () => ({ status: "ok" }));

	server.post("/webhook/github", async (request, reply) => {
		const event = request.headers["x-github-event"] as string | undefined;
		const delivery = request.headers["x-github-delivery"] as string | undefined;
		const signature = request.headers["x-hub-signature-256"] as
			| string
			| undefined;
		const rawBody = request.body as Buffer | undefined;

		if (
			!rawBody ||
			!verifySignature(rawBody, signature ?? "", deps.webhookSecret)
		) {
			return reply.code(401).send({ error: "invalid signature" });
		}

		let payload: unknown;
		try {
			payload = JSON.parse(rawBody.toString("utf8"));
		} catch {
			return reply.code(422).send({ error: "invalid json" });
		}

		if (!isRelevantEvent(event ?? "", payload as { action?: string })) {
			return reply.code(200).send({ ignored: true });
		}

		const deliveryId = delivery ?? `unknown-${Date.now()}`;
		if (isDuplicate(deliveryId)) {
			return reply
				.code(200)
				.send({ accepted: true, delivery: deliveryId, duplicate: true });
		}

		const ctx = extractContext(payload as Parameters<typeof extractContext>[0]);
		if (!ctx.matchesTrigger(deps.triggerPrefix)) {
			return reply.code(200).send({ ignored: true, reason: "trigger-prefix" });
		}

		const input: GenerateIssueInput = {
			owner: ctx.owner,
			repo: ctx.repo,
			commentBody: ctx.commentBody,
			commentUser: ctx.commentUser,
			commentUrl: ctx.commentUrl,
			issue: {
				number: ctx.issueNumber,
				title: ctx.issueTitle,
				body: ctx.issueBody,
			},
		};

		const dryRun = (request.query as { dryRun?: string }).dryRun === "true";

		if (dryRun) {
			try {
				const proposal = await generateIssue(deps.llm, deps.github, input, {
					onDebug: (msg, data) => {
						if (data) server.log.debug(data, msg);
						else server.log.debug(msg);
					},
				});
				if (!proposal) {
					return reply.code(200).send({
						dryRun: true,
						delivery: deliveryId,
						result: null,
					});
				}
				return reply.code(200).send({
					dryRun: true,
					delivery: deliveryId,
					repo: { owner: input.owner, name: input.repo },
					comment: {
						user: input.commentUser,
						body: input.commentBody,
						url: input.commentUrl,
					},
					sourceIssue: {
						number: input.issue.number,
						title: input.issue.title,
					},
					issue: {
						title: proposal.title,
						body: buildIssueBody(proposal, input.commentUser, input.commentUrl),
						labels: proposal.labels,
					},
				});
			} catch (error) {
				server.log.error({ err: error }, "dryRun processing failed");
				return reply.code(500).send({
					error: "processing failed",
					detail: (error as Error)?.message ?? String(error),
				});
			}
		}

		void processInBackground(server, deps, input);

		return reply.code(202).send({ accepted: true, delivery: deliveryId });
	});

	return server;
}

async function processInBackground(
	server: FastifyInstance,
	deps: ServerDeps,
	input: GenerateIssueInput,
): Promise<void> {
	try {
		const proposal = await generateIssue(deps.llm, deps.github, input, {
			onDebug: (msg, data) => {
				if (data) server.log.debug(data, msg);
				else server.log.debug(msg);
			},
		});
		if (!proposal) return;
		const body = buildIssueBody(proposal, input.commentUser, input.commentUrl);
		await deps.github.createIssue(input.owner, input.repo, {
			title: proposal.title,
			body,
			labels: proposal.labels,
		});
	} catch (error) {
		server.log.error({ err: error }, "background processing failed");
	}
}
