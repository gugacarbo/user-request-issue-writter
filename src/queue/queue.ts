import { and, eq, lte, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
	llmLogs,
	queue as queueTable,
	type RequestStatus,
	requests,
} from "../db/schema";

/**
 * Repository + queue ops for the persistence layer (ADR-0007/ADR-0008).
 *
 * All writes are synchronous via better-sqlite3 (cheap at this volume); each
 * public method maps to one DB op so callers can compose transactions when
 * needed. The webhook enqueues atomically via {@link enqueueRequest}.
 */
export type QueueDeps = {
	readonly db: DB;
};

export type EnqueueInput = {
	readonly bodyHash: string;
	readonly deliveryId?: string;
	readonly owner: string;
	readonly repo: string; // full "owner/repo"
	readonly requesterName: string;
	readonly requesterEmail: string;
	/** Raw webhook body (JSON string) for replay/audit. */
	readonly payload: string;
};

export type EnqueueResult =
	| { kind: "inserted"; requestId: number }
	| { kind: "duplicate"; requestId: number | null };

/**
 * Insert a request + queue item in a single transaction. The UNIQUE
 * constraint on `requests.body_hash` (ADR-0008) is the persistence-backed
 * dedupe: a duplicate body returns `{ kind: "duplicate" }` instead of throwing,
 * so the caller can answer the no-op 200 (ADR-0003) without try/catch on SQL.
 */
export function enqueueRequest(
	deps: QueueDeps,
	input: EnqueueInput,
): EnqueueResult {
	const { db } = deps;
	const now = Math.floor(Date.now() / 1000);

	try {
		return db.transaction((tx) => {
			const inserted = tx
				.insert(requests)
				.values({
					bodyHash: input.bodyHash,
					deliveryId: input.deliveryId,
					repo: input.repo,
					owner: input.owner,
					requesterName: input.requesterName,
					requesterEmail: input.requesterEmail,
					payload: input.payload,
					status: "pending",
					createdAt: now,
					updatedAt: now,
				})
				.returning({ id: requests.id })
				.get();

			tx.insert(queueTable)
				.values({
					requestId: inserted.id,
					status: "pending",
					attempts: 0,
					nextRunAt: now,
					createdAt: now,
					updatedAt: now,
				})
				.run();

			return { kind: "inserted" as const, requestId: inserted.id };
		});
	} catch (error) {
		if (isUniqueConstraintError(error)) {
			return { kind: "duplicate", requestId: null };
		}
		throw error;
	}
}

function isUniqueConstraintError(error: unknown): boolean {
	const code = (error as { code?: string } | null)?.code;
	// SQLITE_CONSTRAINT_UNIQUE = 2067; better-sqlite3 surfaces it as such.
	return code === "2067" || code === "SQLITE_CONSTRAINT_UNIQUE";
}

/** Load the full request row by id (worker uses this to rebuild inputs). */
export function getRequest(deps: QueueDeps, requestId: number) {
	return deps.db
		.select()
		.from(requests)
		.where(eq(requests.id, requestId))
		.get();
}

/** Load the queue row for a given request id (checks processing outcome). */
export function getQueueByRequest(deps: QueueDeps, requestId: number) {
	return deps.db
		.select()
		.from(queueTable)
		.where(eq(queueTable.requestId, requestId))
		.get();
}

/** List all `llm_logs` rows for a given request id, ordered by time. */
export function listLlmLogsForRequest(deps: QueueDeps, requestId: number) {
	return deps.db
		.select()
		.from(llmLogs)
		.where(eq(llmLogs.requestId, requestId))
		.all();
}

/**
 * Test/admin helper: directly set the status for a request in BOTH the
 * `queue` and `requests` rows, mirroring what the production worker does in
 * `finalizeProcessing`. Used to simulate a crash mid-run (`processing`) or
 * seed a terminal state in tests without going through the worker; not part
 * of the production flow.
 */
export function setQueueStatusForRequest(
	deps: QueueDeps,
	requestId: number,
	status: RequestStatus,
): void {
	const now = Math.floor(Date.now() / 1000);
	deps.db.transaction((tx) => {
		tx.update(queueTable)
			.set({ status, updatedAt: now })
			.where(eq(queueTable.requestId, requestId))
			.run();
		tx.update(requests)
			.set({ status, updatedAt: now })
			.where(eq(requests.id, requestId))
			.run();
	});
}

/**
 * Atomic claim of one due queue item. Sets status to `processing` and bumps
 * `attempts`, returning the row so the worker knows which request to run.
 *
 * Uses `UPDATE … RETURNING` (atomic claim) so multiple workers (future)
 * won't double-process the same row. Returns `null` when nothing is due.
 */
export function claimNextDue(deps: QueueDeps): {
	queueId: number;
	requestId: number;
	attempts: number;
} | null {
	const now = Math.floor(Date.now() / 1000);
	return deps.db.transaction((tx) => {
		const claimed = tx
			.update(queueTable)
			.set({
				status: "processing",
				attempts: sql`${queueTable.attempts} + 1`,
				updatedAt: now,
			})
			.where(
				and(eq(queueTable.status, "pending"), lte(queueTable.nextRunAt, now)),
			)
			.returning({
				queueId: queueTable.id,
				requestId: queueTable.requestId,
				attempts: queueTable.attempts,
			})
			.get();
		if (!claimed) return null;

		tx.update(requests)
			.set({ status: "processing", updatedAt: now })
			.where(eq(requests.id, claimed.requestId))
			.run();

		return claimed;
	});
}

export type FinalizeInput = {
	readonly queueId: number;
	readonly requestId: number;
	readonly status: "done" | "failed";
	readonly issueNumber?: number;
	readonly issueUrl?: string;
	readonly lastError?: string;
};

export type RequeueInput = {
	readonly queueId: number;
	readonly requestId: number;
	readonly lastError: string;
	/** Unix epoch seconds; worker schedules the next pickup at or after this time. */
	readonly nextRunAt: number;
};

/**
 * Return a failed run to `pending` for another pickup (ADR-0008 retries).
 * Does not reset `queue.attempts` — the counter reflects how many times the
 * worker has already claimed this item.
 */
export function requeueForRetry(deps: QueueDeps, input: RequeueInput): void {
	const { db } = deps;
	const now = Math.floor(Date.now() / 1000);

	db.transaction((tx) => {
		tx.update(queueTable)
			.set({
				status: "pending",
				lastError: input.lastError,
				nextRunAt: input.nextRunAt,
				updatedAt: now,
			})
			.where(eq(queueTable.id, input.queueId))
			.run();

		tx.update(requests)
			.set({
				status: "pending",
				lastError: input.lastError,
				updatedAt: now,
			})
			.where(eq(requests.id, input.requestId))
			.run();
	});
}

/**
 * Manually re-enqueue a failed request for immediate worker pickup (dashboard).
 * Resets `queue.attempts` so automatic retry limits do not block the new run.
 */
export type ManualRetryResult =
	| { kind: "retried"; requestId: number }
	| { kind: "not_found" }
	| { kind: "not_retryable"; status: string };

export function manualRetryRequest(
	deps: QueueDeps,
	requestId: number,
): ManualRetryResult {
	const request = getRequest(deps, requestId);
	if (!request) return { kind: "not_found" };
	if (request.status !== "failed") {
		return { kind: "not_retryable", status: request.status };
	}

	const queueRow = getQueueByRequest(deps, requestId);
	if (!queueRow) return { kind: "not_found" };

	const now = Math.floor(Date.now() / 1000);
	deps.db.transaction((tx) => {
		tx.update(queueTable)
			.set({
				status: "pending",
				attempts: 0,
				lastError: null,
				nextRunAt: now,
				updatedAt: now,
			})
			.where(eq(queueTable.id, queueRow.id))
			.run();

		tx.update(requests)
			.set({
				status: "pending",
				lastError: null,
				updatedAt: now,
			})
			.where(eq(requests.id, requestId))
			.run();
	});

	return { kind: "retried", requestId };
}

/** Mark a processed item as done/failed in BOTH queue and requests (txn). */
export function finalizeProcessing(
	deps: QueueDeps,
	input: FinalizeInput,
): void {
	const { db } = deps;
	const now = Math.floor(Date.now() / 1000);

	db.transaction((tx) => {
		tx.update(queueTable)
			.set({
				status: input.status,
				lastError: input.lastError ?? null,
				updatedAt: now,
			})
			.where(eq(queueTable.id, input.queueId))
			.run();

		tx.update(requests)
			.set({
				status: input.status,
				issueNumber: input.issueNumber ?? null,
				issueUrl: input.issueUrl ?? null,
				attempts: sql`${requests.attempts} + 1`,
				lastError: input.lastError ?? null,
				updatedAt: now,
			})
			.where(eq(requests.id, input.requestId))
			.run();
	});
}

/**
 * Reset queue rows left `processing` at boot (from a crash mid-run) back to
 * `pending`. Called once on startup.
 */
export function requeueStaleProcessing(deps: QueueDeps): number {
	const now = Math.floor(Date.now() / 1000);
	return deps.db.transaction((tx) => {
		const stale = tx
			.select({ requestId: queueTable.requestId })
			.from(queueTable)
			.where(eq(queueTable.status, "processing"))
			.all();

		const result = tx
			.update(queueTable)
			.set({ status: "pending", updatedAt: now })
			.where(eq(queueTable.status, "processing"))
			.run();

		for (const row of stale) {
			tx.update(requests)
				.set({ status: "pending", updatedAt: now })
				.where(
					and(eq(requests.id, row.requestId), eq(requests.status, "processing")),
				)
				.run();
		}

		return result.changes;
	});
}

/** Append one LLM agent event to `llm_logs` (called from `onDebug`). */
export function appendLlmLog(
	deps: QueueDeps,
	input: {
		readonly requestId: number;
		readonly iteration?: number;
		readonly event: string;
		readonly toolName?: string;
		readonly data?: Record<string, unknown> | null;
	},
): void {
	const now = Math.floor(Date.now() / 1000);
	deps.db
		.insert(llmLogs)
		.values({
			requestId: input.requestId,
			iteration: input.iteration ?? null,
			event: input.event,
			toolName: input.toolName ?? null,
			data: input.data ?? null,
			createdAt: now,
		})
		.run();
}

export type { RequestStatus };
