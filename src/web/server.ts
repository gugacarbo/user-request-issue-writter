import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { isRepoAllowed } from "../config/allowlist";
import type { DB } from "../db";
import type { GitHubClient } from "../github/github";
import { prepareScreenshotMarkdown } from "../issue/screenshot";
import { buildIssueBody } from "../issue/template";
import {
	type GenerateIssueInput,
	generateIssue,
	type IssueContext,
	type LlmClient,
} from "../llm/llm";
import { enqueueRequest, type QueueDeps } from "../queue/queue";
import { type DashboardPluginDeps, registerDashboard } from "./dashboard";
import {
	extractBearerToken,
	extractTicket,
	type TicketContext,
	verifyAuthToken,
} from "./webhook";

export type ServerDeps = {
	readonly github: GitHubClient;
	readonly llm: LlmClient;
	readonly webhookSecret: string;
	readonly nocobaseToken?: string;
	readonly nocobasePublicUrl?: string;
	/**
	 * Persistent DB handle (ADR-0007/0008). Required for the production path:
	 * the webhook enqueues the request+queue item in SQLite BEFORE answering
	 * 202. Tests that exercise only the dryRun/validation paths may pass a DB
	 * instance backed by `:memory:`.
	 */
	readonly db: DB;
	readonly logger?: false | { readonly level: string };
	/**
	 * Dashboard options (ADR-0009). When omitted, the dashboard plugin is
	 * NOT registered (webhook-only server, useful for some unit tests). The
	 * production entry point (`index.ts`) passes `serveStatic: true` so the
	 * built SPA is served from `dist/app`.
	 */
	readonly dashboard?: DashboardPluginDeps;
};

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

export function buildServer(deps: ServerDeps): FastifyInstance {
	const server = Fastify({
		logger: deps.logger === undefined ? false : deps.logger,
		// Behind Easypanel/Caddy/Nginx reverse proxies (README production path).
		trustProxy: true,
	});

	server.addContentTypeParser(
		"application/json",
		{ parseAs: "buffer" },
		(_req, body, done) => done(null, body),
	);

	server.get("/health", async () => ({ status: "ok" }));

	server.post("/webhook/github", async (request, reply) => {
		const token = extractBearerToken(request.headers.authorization);
		const delivery = (request.headers["x-delivery-id"] as string) ?? undefined;
		const rawBody = request.body as Buffer | undefined;

		if (!token || !verifyAuthToken(token, deps.webhookSecret)) {
			return reply.code(401).send({ error: "unauthorized", delivery });
		}

		if (!rawBody?.length) {
			return reply.code(400).send({ error: "missing body", delivery });
		}

		let payload: unknown;
		try {
			payload = JSON.parse(rawBody.toString("utf8"));
		} catch {
			return reply.code(422).send({ error: "invalid json", delivery });
		}

		const ctx = extractTicket(payload as Parameters<typeof extractTicket>[0], {
			nocobasePublicUrl: deps.nocobasePublicUrl,
		});
		if (!ctx) {
			return reply.code(400).send({
				error: "invalid payload: missing repo or descricao",
				delivery,
			});
		}

		if (!isRepoAllowed(`${ctx.owner}/${ctx.repo}`)) {
			return reply.code(403).send({
				error: "repo not allowed",
				repo: `${ctx.owner}/${ctx.repo}`,
				delivery,
			});
		}

		const bodyHash = createHash("sha256").update(rawBody).digest("hex");
		const dryRun = (request.query as { dryRun?: string }).dryRun === "true";

		const input: GenerateIssueInput = {
			owner: ctx.owner,
			repo: ctx.repo,
			requesterName: ctx.requesterName,
			requesterEmail: ctx.requesterEmail,
			descricao: ctx.descricao,
			context: extractContextFields(ctx),
		};

		// dryRun keeps the legacy synchronous, in-memory behavior (no DB, no
		// enqueue) so it can be used for debugging the LLM pipeline without
		// side effects on the queue.
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
						delivery,
						bodyHash,
						result: null,
					});
				}
				const screenshotMarkdown = await prepareScreenshotMarkdown({
					screenshot: ctx.screenshot,
					owner: input.owner,
					repo: input.repo,
					github: deps.github,
					nocobaseToken: deps.nocobaseToken,
					nocobasePublicUrl: deps.nocobasePublicUrl,
				});
				return reply.code(200).send({
					dryRun: true,
					delivery,
					bodyHash,
					repo: { owner: input.owner, name: input.repo },
					requester: {
						name: input.requesterName,
						email: input.requesterEmail,
					},
					descricao: input.descricao,
					issue: {
						title: proposal.title,
						body: buildIssueBody({
							agentBody: proposal.body,
							rawUserMessage: input.descricao,
							screenshotMarkdown,
							requesterName: input.requesterName,
							requesterEmail: input.requesterEmail,
						}),
						labels: proposal.labels,
					},
				});
			} catch (error) {
				server.log.error({ err: error }, "dryRun processing failed");
				return reply.code(500).send({
					error: "processing failed",
					delivery,
					detail: (error as Error)?.message ?? String(error),
				});
			}
		}

		// Production path (ADR-0008): persist request + queue item BEFORE
		// answering 202. The UNIQUE(body_hash) constraint is the durable
		// dedupe (replaces the in-memory ADR-0003 map). A duplicate body
		// returns the 200 no-op with `duplicate: true`.
		const queueDeps: QueueDeps = { db: deps.db };
		const result = enqueueRequest(queueDeps, {
			bodyHash,
			deliveryId: delivery,
			owner: ctx.owner,
			repo: `${ctx.owner}/${ctx.repo}`,
			requesterName: ctx.requesterName,
			requesterEmail: ctx.requesterEmail,
			payload: rawBody.toString("utf8"),
		});

		if (result.kind === "duplicate") {
			return reply
				.code(200)
				.send({ accepted: true, bodyHash, duplicate: true, delivery });
		}

		// Worker started in index.ts polls the queue and processes the
		// request in background; the 202 here only acknowledges persistence.
		return reply.code(202).send({
			accepted: true,
			requestId: result.requestId,
			bodyHash,
			delivery,
		});
	});

	// Optional dashboard (ADR-0009): SSE + static SPA. Only registered when
	// `deps.dashboard` is provided; the production entry point opts in.
	if (deps.dashboard) {
		registerDashboard(server, deps.dashboard);
	}

	return server;
}
