import { existsSync } from "node:fs";
import { resolve } from "node:path";
import ssePlugin from "@fastify/sse";
import { fastifyStatic } from "@fastify/static";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import type { DB } from "../db";
import {
	countByStatus,
	type DashboardDeps,
	listLlmLogsSince,
	listQueueSummary,
	listRecentRequests,
} from "./dashboardApi";

/**
 * Dashboard wiring (ADR-0009): SSE endpoints for real-time observation of the
 * queue + LLM agent logs, plus JSON mirrors for non-SSE clients, and serving
 * the built React app as static assets in production.
 *
 * Registered as a plugin so `server.ts` stays focused on the webhook. The
 * dashboard is read-only — it never mutates `requests`/`queue`/`llm_logs`.
 */
export type DashboardPluginDeps = {
	readonly db: DB;
	/** Enable serving the built SPA from `appStaticDir` (default `./dist/app`). */
	readonly serveStatic?: boolean;
	/**
	 * Absolute path to the built SPA. Defaults to `./dist/app` relative to
	 * the process cwd; tests pass an empty dir with `serveStatic: false`.
	 */
	readonly appStaticDir?: string;
	/** SSE poll interval in ms (default 1000). */
	readonly pollIntervalMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 1000;

const dashboardPlugin: FastifyPluginAsync<DashboardPluginDeps> = async (
	server,
	opts,
) => {
	const dashboardDeps: DashboardDeps = { db: opts.db };
	const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

	// @fastify/sse must be registered before SSE routes. Scoped to this
	// plugin so it doesn't leak into the webhook routes.
	await server.register(ssePlugin);

	// --- JSON mirrors (handy for curl / non-SSE) ---------------------------
	server.get("/app/api/state", async () => {
		return {
			counts: countByStatus(dashboardDeps),
			queue: listQueueSummary(dashboardDeps),
			requests: listRecentRequests(dashboardDeps),
		};
	});

	server.get("/app/api/logs", async (request) => {
		const since = Number.parseInt(
			(request.query as { since?: string }).since ?? "0",
			10,
		);
		return {
			logs: listLlmLogsSince(dashboardDeps, Number.isNaN(since) ? 0 : since),
		};
	});

	// --- SSE: /app/events/queue -------------------------------------------
	// Streams a snapshot first, then diffs every `pollIntervalMs`. Each client
	// keeps its own last-seen-ids so we only send deltas.
	server.get("/app/events/queue", { sse: "only" }, async (_req, reply) => {
		reply.sse.keepAlive();

		let lastQueueId = 0;
		let lastRequestId = 0;

		const sendSnapshot = () => {
			const queue = listQueueSummary(dashboardDeps, 100);
			const counts = countByStatus(dashboardDeps);
			lastQueueId = queue[0]?.id ?? 0;
			lastRequestId = queue[0]?.requestId ?? 0;
			return reply.sse.send({
				event: "snapshot",
				data: { counts, queue, asOf: Date.now() },
			});
		};

		await sendSnapshot();

		const interval = setInterval(async () => {
			if (!reply.sse.isConnected) {
				clearInterval(interval);
				return;
			}
			const tick = computeQueueTick(dashboardDeps, lastQueueId, lastRequestId);
			if (!tick) return;
			lastQueueId = tick.lastQueueId;
			lastRequestId = tick.lastRequestId;
			try {
				await reply.sse.send(tick.event);
			} catch (error) {
				server.log.debug({ err: error }, "queue SSE tick failed");
			}
		}, pollIntervalMs);

		reply.sse.onClose(() => {
			clearInterval(interval);
		});
	});

	// --- SSE: /app/events/llm-logs -----------------------------------------
	// Streams recent logs first, then any newer than the last seen id.
	server.get("/app/events/llm-logs", { sse: "only" }, async (_req, reply) => {
		reply.sse.keepAlive();

		// Seed: send the most recent N so a reconnect catches up; client tracks
		// the highest id it has seen (Last-Event-ID is also supported by the
		// plugin, but we use our own cursor for clarity).
		const initial = listLlmLogsSince(dashboardDeps, 0, 50);
		let lastId = initial[0]?.id ?? 0;
		await reply.sse.send({
			event: "snapshot",
			data: { logs: reverseNewestFirst(initial) },
		});

		const interval = setInterval(async () => {
			if (!reply.sse.isConnected) {
				clearInterval(interval);
				return;
			}
			const tick = computeLlmLogsTick(dashboardDeps, lastId);
			if (!tick) return;
			lastId = tick.lastId;
			try {
				await reply.sse.send(tick.event);
			} catch (error) {
				server.log.debug({ err: error }, "llm-logs SSE tick failed");
			}
		}, pollIntervalMs);

		reply.sse.onClose(() => {
			clearInterval(interval);
		});
	});

	// --- Static SPA (production) ------------------------------------------
	if (opts.serveStatic) {
		const dir = opts.appStaticDir ?? defaultAppDir();
		if (existsSync(dir)) {
			await server.register(fastifyStatic, {
				root: dir,
				prefix: "/app/",
				wildcard: false,
			});
			// SPA fallback so client-side routes resolve to index.html.
			server.get("/app/*", async (_req, reply) => {
				return reply.sendFile("index.html", dir);
			});
			// Convenience: "/" loads the dashboard directly.
			server.get("/", async (_req, reply) => {
				return reply.sendFile("index.html", dir);
			});
		} else {
			server.log.warn(
				{ dir },
				"dashboard static dir missing — run `pnpm app:build` to build the SPA",
			);
		}
	}
};

/**
 * Reverse an array copy without mutating the original. The SSE polls return
 * newest-first from the DB; for append-style rendering we flip to oldest-first.
 */
function reverseNewestFirst<T>(xs: readonly T[]): T[] {
	const out: T[] = [];
	for (let i = xs.length - 1; i >= 0; i -= 1) out.push(xs[i]);
	return out;
}

function defaultAppDir(): string {
	// The bundled server runs from `dist/index.js` and the built SPA lives in
	// `dist/app` side-by-side. Resolving from cwd covers both production
	// (cwd=/app) and local `pnpm start` (cwd=repo root). Tests use
	// `serveStatic: false` so they never hit this default.
	return resolve(process.cwd(), "dist", "app");
}

/**
 * Pure SSE-tick computation for the queue stream. Given the last-seen ids,
 * returns the next event to send (snapshot or counts) plus the new cursors,
 * or `null` when there is nothing to emit. Extracted so the diff logic is
 * unit-testable without timers/EventSource.
 */
export type QueueTickResult = {
	event: { event: "snapshot" | "counts"; data: unknown };
	lastQueueId: number;
	lastRequestId: number;
};

export function computeQueueTick(
	deps: DashboardDeps,
	lastQueueId: number,
	lastRequestId: number,
): QueueTickResult | null {
	const counts = countByStatus(deps);
	const queue = listQueueSummary(deps, 100);
	const newestQueueId = queue[0]?.id ?? 0;
	const newestRequestId = queue[0]?.requestId ?? 0;
	if (newestQueueId === lastQueueId && newestRequestId === lastRequestId) {
		return {
			event: { event: "counts", data: counts },
			lastQueueId,
			lastRequestId,
		};
	}
	return {
		event: {
			event: "snapshot",
			data: { counts, queue, asOf: Date.now() },
		},
		lastQueueId: newestQueueId,
		lastRequestId: newestRequestId,
	};
}

/** Pure SSE-tick computation for the llm-logs stream. Returns null when no
 * new logs exist since `lastId`; otherwise the event + new cursor. */
export type LlmLogsTickResult = {
	event: { event: "logs"; data: { logs: unknown[] } };
	lastId: number;
};

export function computeLlmLogsTick(
	deps: DashboardDeps,
	lastId: number,
): LlmLogsTickResult | null {
	const fresh = listLlmLogsSince(deps, lastId, 200);
	if (fresh.length === 0) return null;
	return {
		event: { event: "logs", data: { logs: reverseNewestFirst(fresh) } },
		lastId: fresh[0]?.id ?? lastId,
	};
}

/** Register the dashboard plugin on an existing instance. */
export function registerDashboard(
	server: FastifyInstance,
	deps: DashboardPluginDeps,
): void {
	server.register(dashboardPlugin, deps);
}
