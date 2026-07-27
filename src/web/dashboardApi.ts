import { asc, desc, eq, gt } from "drizzle-orm";
import type { DB } from "../db";
import { llmLogs, queue as queueTable, requests } from "../db/schema";

/**
 * Read-only queries backing the observability dashboard (ADR-0009).
 *
 * The dashboard polls these via the SSE endpoints in `server.ts`. All
 * functions are pure SELECTs on the SQLite store — they neve mutate state.
 * The sources of mutation remain the webhook (enqueue) and the worker
 * (claim/finalize/log).
 */
export type DashboardDeps = { readonly db: DB };

export type QueueSummaryRow = {
	id: number;
	requestId: number;
	status: string;
	attempts: number;
	lastError: string | null;
	nextRunAt: number;
	createdAt: number;
	updatedAt: number;
	// joined from requests
	bodyHash: string | null;
	repo: string | null;
	requesterName: string | null;
	issueNumber: number | null;
	issueUrl: string | null;
};

export type LlmLogRow = {
	id: number;
	requestId: number;
	iteration: number | null;
	event: string;
	toolName: string | null;
	data: Record<string, unknown> | null;
	createdAt: number;
};

export type RequestRow = {
	id: number;
	bodyHash: string;
	deliveryId: string | null;
	repo: string;
	owner: string;
	requesterName: string;
	requesterEmail: string;
	status: string;
	issueNumber: number | null;
	issueUrl: string | null;
	attempts: number;
	lastError: string | null;
	createdAt: number;
	updatedAt: number;
};

/**
 * Full queue+request snapshot, newest first, capped at `limit`. Sent as the
 * first SSE event so a freshly-connected client paints immediately.
 */
export function listQueueSummary(
	deps: DashboardDeps,
	limit = 100,
): QueueSummaryRow[] {
	const rows = deps.db
		.select({
			id: queueTable.id,
			requestId: queueTable.requestId,
			status: queueTable.status,
			attempts: queueTable.attempts,
			lastError: queueTable.lastError,
			nextRunAt: queueTable.nextRunAt,
			createdAt: queueTable.createdAt,
			updatedAt: queueTable.updatedAt,
			bodyHash: requests.bodyHash,
			repo: requests.repo,
			requesterName: requests.requesterName,
			issueNumber: requests.issueNumber,
			issueUrl: requests.issueUrl,
		})
		.from(queueTable)
		.innerJoin(requests, eq(queueTable.requestId, requests.id))
		.orderBy(desc(queueTable.createdAt))
		.limit(limit)
		.all();
	return rows;
}

/**
 * Aggregate counts per status — powers the header cards on the dashboard.
 */
export function countByStatus(deps: DashboardDeps): Record<string, number> {
	const rows = deps.db
		.select({ status: requests.status, count: requests.id })
		.from(requests)
		.all();
	const out: Record<string, number> = {
		pending: 0,
		processing: 0,
		done: 0,
		failed: 0,
	};
	for (const r of rows) {
		out[r.status] = (out[r.status] ?? 0) + 1;
	}
	return out;
}

/**
 * LLM logs with `id > sinceId`, newest-first but bounded by `limit`. Used by
 * the SSE poller to send only the delta to connected clients.
 */
export function listLlmLogsSince(
	deps: DashboardDeps,
	sinceId: number,
	limit = 200,
): LlmLogRow[] {
	return deps.db
		.select({
			id: llmLogs.id,
			requestId: llmLogs.requestId,
			iteration: llmLogs.iteration,
			event: llmLogs.event,
			toolName: llmLogs.toolName,
			data: llmLogs.data,
			createdAt: llmLogs.createdAt,
		})
		.from(llmLogs)
		.where(gt(llmLogs.id, sinceId))
		.orderBy(desc(llmLogs.id))
		.limit(limit)
		.all();
}

export type QueueRow = {
	id: number;
	requestId: number;
	status: string;
	attempts: number;
	lastError: string | null;
	nextRunAt: number;
	createdAt: number;
	updatedAt: number;
};

/**
 * Full detail of one agent run: the immutable request, its queue item, and the
 * ordered LLM agent log lines (oldest-first for run replay). Powers the run
 * dialog opened when a queue row is clicked. Returns `null` when the request
 * id does not exist.
 */
export type RunDetail = {
	request: RequestRow;
	queue: QueueRow | null;
	logs: LlmLogRow[];
};

export function getRequestRun(
	deps: DashboardDeps,
	requestId: number,
): RunDetail | null {
	const request = deps.db
		.select({
			id: requests.id,
			bodyHash: requests.bodyHash,
			deliveryId: requests.deliveryId,
			repo: requests.repo,
			owner: requests.owner,
			requesterName: requests.requesterName,
			requesterEmail: requests.requesterEmail,
			status: requests.status,
			issueNumber: requests.issueNumber,
			issueUrl: requests.issueUrl,
			attempts: requests.attempts,
			lastError: requests.lastError,
			createdAt: requests.createdAt,
			updatedAt: requests.updatedAt,
		})
		.from(requests)
		.where(eq(requests.id, requestId))
		.get();
	if (!request) return null;

	const queue = deps.db
		.select({
			id: queueTable.id,
			requestId: queueTable.requestId,
			status: queueTable.status,
			attempts: queueTable.attempts,
			lastError: queueTable.lastError,
			nextRunAt: queueTable.nextRunAt,
			createdAt: queueTable.createdAt,
			updatedAt: queueTable.updatedAt,
		})
		.from(queueTable)
		.where(eq(queueTable.requestId, requestId))
		.get();

	const logs = deps.db
		.select({
			id: llmLogs.id,
			requestId: llmLogs.requestId,
			iteration: llmLogs.iteration,
			event: llmLogs.event,
			toolName: llmLogs.toolName,
			data: llmLogs.data,
			createdAt: llmLogs.createdAt,
		})
		.from(llmLogs)
		.where(eq(llmLogs.requestId, requestId))
		.orderBy(asc(llmLogs.createdAt), asc(llmLogs.id))
		.all();

	return { request, queue, logs };
}

/** Recent requests, newest first (used for the requests panel). */
export function listRecentRequests(
	deps: DashboardDeps,
	limit = 100,
): RequestRow[] {
	return deps.db
		.select({
			id: requests.id,
			bodyHash: requests.bodyHash,
			deliveryId: requests.deliveryId,
			repo: requests.repo,
			owner: requests.owner,
			requesterName: requests.requesterName,
			requesterEmail: requests.requesterEmail,
			status: requests.status,
			issueNumber: requests.issueNumber,
			issueUrl: requests.issueUrl,
			attempts: requests.attempts,
			lastError: requests.lastError,
			createdAt: requests.createdAt,
			updatedAt: requests.updatedAt,
		})
		.from(requests)
		.orderBy(desc(requests.createdAt))
		.limit(limit)
		.all();
}
