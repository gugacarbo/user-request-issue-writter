import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Status of a webhook request as it flows through the pipeline.
 *
 * - `pending`    -> inserted, awaiting worker pickup
 * - `processing` -> claimed by the worker (in-progress)
 * - `done`       -> issue created successfully (issue_number set)
 * - `failed`     -> exhausted retries; last_error holds the final error
 */
export type RequestStatus = "pending" | "processing" | "done" | "failed";

/**
 * Immutable record of a received webhook. Inserted BEFORE the 202 response.
 *
 * `body_hash` (SHA-256 of the raw body) is the persistence-backed dedupe key
 * promoted from the in-memory ADR-0003 dedupe: the UNIQUE constraint rejects
 * re-deliveries of the same body.
 */
export const requests = sqliteTable("requests", {
	id: integer().primaryKey({ autoIncrement: true }),
	bodyHash: text("body_hash").notNull().unique(),
	deliveryId: text("delivery_id"),
	repo: text("repo").notNull(), // "owner/repo"
	owner: text("owner").notNull(),
	requesterName: text("requester_name").notNull(),
	requesterEmail: text("requester_email").notNull(),
	/** Raw, signed webhook payload (JSON string) for replay/audit. */
	payload: text("payload").notNull(),
	status: text("status").$type<RequestStatus>().notNull().default("pending"),
	issueNumber: integer("issue_number"),
	issueUrl: text("issue_url"),
	attempts: integer("attempts").notNull().default(0),
	lastError: text("last_error"),
	createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
	updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/**
 * Worker-facing queue item. Mirrors the request status so that future
 * prioritization/scheduling can live on the queue without rewriting the
 * immutable `requests` row.
 */
export const queue = sqliteTable("queue", {
	id: integer().primaryKey({ autoIncrement: true }),
	requestId: integer("request_id")
		.notNull()
		.references(() => requests.id, { onDelete: "cascade" }),
	status: text("status").$type<RequestStatus>().notNull().default("pending"),
	attempts: integer("attempts").notNull().default(0),
	lastError: text("last_error"),
	/** Unix epoch seconds; worker polls rows due at or before this time. */
	nextRunAt: integer("next_run_at").notNull().default(sql`(unixepoch())`),
	createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
	updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/**
 * Per-event log line emitted by the LLM agent onto the `onDebug` callback.
 * Each call to `onDebug(message, data)` becomes one row, keyed by
 * `request_id` and ordered by `created_at` for full replay of a run.
 */
export const llmLogs = sqliteTable("llm_logs", {
	id: integer().primaryKey({ autoIncrement: true }),
	requestId: integer("request_id")
		.notNull()
		.references(() => requests.id, { onDelete: "cascade" }),
	iteration: integer("iteration"),
	event: text("event").notNull(),
	toolName: text("tool_name"),
	/** Arbitrary JSON payload from the agent (tool args, response preview…). */
	data: text("data", { mode: "json" }).$type<Record<string, unknown> | null>(),
	createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
});
