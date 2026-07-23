import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { isRepoAllowed } from "./allowlist";
import type { GitHubClient } from "./github";
import {
	type GenerateIssueInput,
	generateIssue,
	type IssueContext,
	type LlmClient,
} from "./llm";
import { extractTicket, type TicketContext, verifySignature } from "./webhook";

export type ServerDeps = {
	readonly github: GitHubClient;
	readonly llm: LlmClient;
	readonly webhookSecret: string;
	readonly dedupeTtlMs?: number;
	readonly logger?: false | { readonly level: string };
};

const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;

function extractContextFields(ctx: TicketContext): IssueContext {
	return {
		urlAtual: ctx.urlAtual,
		categoria: ctx.categoria,
		contextoSessao: ctx.contextoSessao,
		logsConsole: ctx.logsConsole,
		logsRede: ctx.logsRede,
		screenshot: ctx.screenshot,
	};
}

function buildIssueBody(
	proposal: { title: string; body: string },
	requesterName: string,
	requesterEmail: string,
): string {
	return [
		proposal.body,
		"",
		"---",
		`_Requested by ${requesterName} (${requesterEmail})_`,
	].join("\n");
}

export function buildServer(deps: ServerDeps): FastifyInstance {
	const ttl = deps.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
	const seenBodies = new Map<string, number>();

	function isDuplicate(bodyHash: string): boolean {
		const now = Date.now();
		for (const [key, expires] of seenBodies) {
			if (expires < now) seenBodies.delete(key);
		}
		if (seenBodies.has(bodyHash)) return true;
		seenBodies.set(bodyHash, now + ttl);
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

		const ctx = extractTicket(payload as Parameters<typeof extractTicket>[0]);
		if (!ctx) {
			return reply
				.code(400)
				.send({ error: "invalid payload: missing repo or descricao" });
		}

		if (!isRepoAllowed(`${ctx.owner}/${ctx.repo}`)) {
			return reply
				.code(403)
				.send({ error: "repo not allowed", repo: `${ctx.owner}/${ctx.repo}` });
		}

		const bodyHash = createHash("sha256").update(rawBody).digest("hex");
		if (isDuplicate(bodyHash)) {
			return reply
				.code(200)
				.send({ accepted: true, bodyHash, duplicate: true });
		}

		const input: GenerateIssueInput = {
			owner: ctx.owner,
			repo: ctx.repo,
			requesterName: ctx.requesterName,
			requesterEmail: ctx.requesterEmail,
			descricao: ctx.descricao,
			context: extractContextFields(ctx),
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
						bodyHash,
						result: null,
					});
				}
				return reply.code(200).send({
					dryRun: true,
					bodyHash,
					repo: { owner: input.owner, name: input.repo },
					requester: {
						name: input.requesterName,
						email: input.requesterEmail,
					},
					descricao: input.descricao,
					issue: {
						title: proposal.title,
						body: buildIssueBody(
							proposal,
							input.requesterName,
							input.requesterEmail,
						),
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

		return reply.code(202).send({ accepted: true, bodyHash });
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
		const body = buildIssueBody(
			proposal,
			input.requesterName,
			input.requesterEmail,
		);
		await deps.github.createIssue(input.owner, input.repo, {
			title: proposal.title,
			body,
			labels: proposal.labels,
		});
	} catch (error) {
		server.log.error({ err: error }, "background processing failed");
	}
}
