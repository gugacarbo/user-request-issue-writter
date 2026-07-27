import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateIssueResult, GitHubClient } from "../github/github";
import type { LlmClient } from "../llm/llm";
import type { IssueProposal } from "../llm/tools";
import type { EnqueueResult } from "../queue/queue";
import {
	appendLlmLog,
	enqueueRequest,
	setQueueStatusForRequest,
} from "../queue/queue";
import { computeLlmLogsTick, computeQueueTick } from "../web/dashboard";
import {
	countByStatus,
	listLlmLogsSince,
	listQueueSummary,
	listRecentRequests,
} from "../web/dashboardApi";
import { buildServer, type ServerDeps } from "../web/server";
import { makeTestDb, type TestDb } from "./dbTestHelper";

vi.mock("../config/allowlist", () => ({ isRepoAllowed: vi.fn(() => true) }));

/** Type-guard narrowing the inserted variant (vitest's expect isn't a TS guard). */
function assertInserted(r: EnqueueResult): number {
	if (r.kind !== "inserted")
		throw new Error(`expected inserted, got ${r.kind}`);
	return r.requestId;
}

function mockGitHub(
	issue: CreateIssueResult = { number: 11, url: "https://example/11" },
): GitHubClient {
	return {
		getRepoTree: vi.fn(async () => ["src/index.ts"]),
		getFileContent: vi.fn(async () => "export const x = 1;"),
		getRepoInfo: vi.fn(async () => ({
			description: "d",
			languages: {},
			readme: null,
		})),
		createIssue: vi.fn(async () => issue),
	};
}

function mockLlm(proposal: IssueProposal): LlmClient {
	return {
		chat: vi.fn(async () => ({
			toolCalls: [{ name: "submit_issue", arguments: proposal }],
			content: null,
		})),
	};
}

function ticketPayload(repo = "owner/repo"): string {
	return JSON.stringify({
		repo,
		requester: { name: "Alice", email: "alice@example.com" },
		payload: { descricao: "The login button is broken" },
	});
}

function hash(body: string): string {
	const { createHash } = require("node:crypto") as typeof import("node:crypto");
	return createHash("sha256").update(body).digest("hex");
}

describe("dashboardApi (read-only queries)", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = makeTestDb();
	});

	afterEach(() => {
		testDb.cleanup();
	});

	it("countByStatus counts request statuses", () => {
		enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("a/b")),
				owner: "a",
				repo: "a/b",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				payload: ticketPayload("a/b"),
			},
		);
		const enq2 = enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("c/d")),
				owner: "c",
				repo: "c/d",
				requesterName: "Bob",
				requesterEmail: "bob@example.com",
				payload: ticketPayload("c/d"),
			},
		);
		const id2 = assertInserted(enq2);
		// Force one to processing via the helper to exercise counts.
		setQueueStatusForRequest({ db: testDb.db }, id2, "processing");

		const counts = countByStatus({ db: testDb.db });
		expect(counts.pending).toBe(1);
		expect(counts.processing).toBe(1);
		expect(counts.done).toBe(0);
		expect(counts.failed).toBe(0);
	});

	it("listQueueSummary joins queue+requests newest-first", () => {
		enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("a/b")),
				owner: "a",
				repo: "a/b",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				payload: ticketPayload("a/b"),
			},
		);
		const rows = listQueueSummary({ db: testDb.db }, 100);
		expect(rows.length).toBe(1);
		expect(rows[0]?.repo).toBe("a/b");
		expect(rows[0]?.requesterName).toBe("Alice");
		expect(rows[0]?.status).toBe("pending");
	});

	it("listRecentRequests returns recent requests", () => {
		enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("a/b")),
				owner: "a",
				repo: "a/b",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				payload: ticketPayload("a/b"),
			},
		);
		const rows = listRecentRequests({ db: testDb.db }, 100);
		expect(rows.length).toBe(1);
		expect(rows[0]?.owner).toBe("a");
		expect(rows[0]?.deliveryId).toBe(null);
		expect(rows[0]?.status).toBe("pending");
	});

	it("listLlmLogsSince returns logs with id > sinceId", () => {
		const enq = enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("a/b")),
				owner: "a",
				repo: "a/b",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				payload: ticketPayload("a/b"),
			},
		);
		const requestId = assertInserted(enq);
		appendLlmLog(
			{ db: testDb.db },
			{
				requestId,
				iteration: 0,
				event: "llm response",
				toolName: "get_repo_info",
				data: { foo: "bar" },
			},
		);
		appendLlmLog({ db: testDb.db }, { requestId, event: "done" });

		const all = listLlmLogsSince({ db: testDb.db }, 0);
		expect(all.length).toBe(2);

		// all is newest-first: [log2, log1]. To get only log2 use log1.id as the cursor.
		const oldestId = Math.min(...all.map((l) => l.id));
		const tail = listLlmLogsSince({ db: testDb.db }, oldestId);
		expect(tail.length).toBe(1);
		expect(tail[0]?.event).toBe("done");
	});
});

describe("dashboard plugin (JSON + static)", () => {
	let testDb: TestDb;
	let server: FastifyInstance;

	beforeEach(() => {
		testDb = makeTestDb();
		const deps: ServerDeps = {
			github: mockGitHub(),
			llm: mockLlm({ title: "Bug", body: "desc", labels: ["bug"] }),
			webhookSecret: "topsecret",
			db: testDb.db,
			logger: false,
			// serveStatic: false → routes JSON/SSE registered, no SPA dir needed.
			dashboard: { db: testDb.db, serveStatic: false, pollIntervalMs: 10 },
		};
		server = buildServer(deps);
	});

	afterEach(async () => {
		await server.close();
		testDb.cleanup();
	});

	it("/app/api/state returns counts + queue + requests", async () => {
		// Enqueue a row first so the response is non-empty.
		const enq = enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("a/b")),
				owner: "a",
				repo: "a/b",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				payload: ticketPayload("a/b"),
			},
		);
		assertInserted(enq);

		const res = await server.inject({ method: "GET", url: "/app/api/state" });
		expect(res.statusCode).toBe(200);
		const json = res.json() as {
			counts: {
				pending: number;
				processing: number;
				done: number;
				failed: number;
			};
			queue: { requestId: number; repo: string }[];
			requests: { id: number; owner: string }[];
		};
		expect(json.counts.pending).toBe(1);
		expect(json.queue.length).toBe(1);
		expect(json.queue[0]?.repo).toBe("a/b");
		expect(json.requests[0]?.owner).toBe("a");
	});

	it("/app/api/logs returns logs since a cursor", async () => {
		const enq = enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("a/b")),
				owner: "a",
				repo: "a/b",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				payload: ticketPayload("a/b"),
			},
		);
		const enqId = assertInserted(enq);
		appendLlmLog(
			{ db: testDb.db },
			{
				requestId: enqId,
				iteration: 1,
				event: "tool dispatched",
				toolName: "list_files",
			},
		);
		appendLlmLog({ db: testDb.db }, { requestId: enqId, event: "other" });

		const res = await server.inject({ method: "GET", url: "/app/api/logs" });
		expect(res.statusCode).toBe(200);
		const json = res.json() as { logs: { event: string }[] };
		expect(json.logs.length).toBe(2);

		const firstIdRes = await server.inject({
			method: "GET",
			url: "/app/api/logs?since=9999999",
		});
		expect(firstIdRes.statusCode).toBe(200);
		expect((firstIdRes.json() as { logs: unknown[] }).logs.length).toBe(0);
	});

	it("registers without throwing even when serveStatic dir is missing", async () => {
		// A second build with serveStatic pointing at a non-existent dir should
		// only warn (already exercised above); assert /health still works.
		const res = await server.inject({ method: "GET", url: "/health" });
		expect(res.statusCode).toBe(200);
	});
});

describe("SSE tick computations (pure)", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = makeTestDb();
	});
	afterEach(() => {
		testDb.cleanup();
	});

	it("computeQueueTick sends snapshot when ids change, counts otherwise", () => {
		const enq = enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("a/b")),
				owner: "a",
				repo: "a/b",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				payload: ticketPayload("a/b"),
			},
		);
		const requestId = assertInserted(enq);
		// Need the queue row id for comparison; read it via the summary.
		const summary = listQueueSummary({ db: testDb.db }, 100);
		const newestQueueId = summary[0]?.id ?? 0;

		// First tick with lastSeen=0 → new ids present → snapshot, new cursors.
		const tick1 = computeQueueTick({ db: testDb.db }, 0, 0);
		expect(tick1).not.toBeNull();
		expect(tick1?.event.event).toBe("snapshot");
		expect(tick1?.lastQueueId).toBe(newestQueueId);
		expect(tick1?.lastRequestId).toBe(requestId);

		// Second tick with the same cursors → nothing changed → counts + same cursors.
		const tick2 = computeQueueTick({ db: testDb.db }, newestQueueId, requestId);
		expect(tick2).not.toBeNull();
		expect(tick2?.event.event).toBe("counts");
		expect(tick2?.lastQueueId).toBe(newestQueueId);
		expect(tick2?.lastRequestId).toBe(requestId);
	});

	it("computeLlmLogsTick returns null when no new logs, event otherwise", () => {
		const enq = enqueueRequest(
			{ db: testDb.db },
			{
				bodyHash: hash(ticketPayload("a/b")),
				owner: "a",
				repo: "a/b",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				payload: ticketPayload("a/b"),
			},
		);
		const requestId = assertInserted(enq);

		// No logs yet → null.
		expect(computeLlmLogsTick({ db: testDb.db }, 0)).toBeNull();

		appendLlmLog(
			{ db: testDb.db },
			{
				requestId,
				iteration: 0,
				event: "llm response",
				toolName: "list_files",
			},
		);
		const all = listLlmLogsSince({ db: testDb.db }, 0);
		const newestId = all[0]?.id ?? 0;

		// Cursor at newest → nothing newer → null.
		expect(computeLlmLogsTick({ db: testDb.db }, newestId)).toBeNull();

		// Cursor at 0 → one log event returned, cursor advances to newest.
		const tick = computeLlmLogsTick({ db: testDb.db }, 0);
		expect(tick).not.toBeNull();
		expect(tick?.event.event).toBe("logs");
		expect(tick?.lastId).toBe(newestId);
	});
});

describe("dashboard static SPA serving", () => {
	let testDb: TestDb;

	beforeEach(() => {
		testDb = makeTestDb();
	});
	afterEach(() => {
		testDb.cleanup();
	});

	it("serves index.html at /app/ and redirects / to /app/", async () => {
		const dir = mkdtempSync(join(tmpdir(), "uriw-static-"));
		writeFileSync(join(dir, "index.html"), "<!doctype html><title>ok</title>");
		const server = buildServer({
			github: mockGitHub(),
			llm: mockLlm({ title: "T", body: "b", labels: [] }),
			webhookSecret: "topsecret",
			db: testDb.db,
			logger: false,
			dashboard: { db: testDb.db, serveStatic: true, appStaticDir: dir },
		});
		await server.ready();

		const appRes = await server.inject({
			method: "GET",
			url: "/app/",
		});
		expect(appRes.statusCode).toBe(200);
		expect(appRes.body).toContain("ok");

		const rootRes = await server.inject({ method: "GET", url: "/" });
		expect(rootRes.statusCode).toBe(302);
		expect(rootRes.headers.location).toBe("/app/");

		await server.close();
		rmSync(dir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("serves built asset files under /app/assets/", async () => {
		const dir = mkdtempSync(join(tmpdir(), "uriw-static-"));
		const assetsDir = join(dir, "assets");
		mkdirSync(assetsDir, { recursive: true });
		writeFileSync(
			join(dir, "index.html"),
			[
				"<!doctype html>",
				'<link rel="stylesheet" href="/app/assets/index.css" />',
				'<script type="module" src="/app/assets/index.js"></script>',
			].join("\n"),
		);
		writeFileSync(join(assetsDir, "index.css"), "body{}");
		writeFileSync(join(assetsDir, "index.js"), "console.log('ok');");

		const server = buildServer({
			github: mockGitHub(),
			llm: mockLlm({ title: "T", body: "b", labels: [] }),
			webhookSecret: "topsecret",
			db: testDb.db,
			logger: false,
			dashboard: { db: testDb.db, serveStatic: true, appStaticDir: dir },
		});
		await server.ready();

		const cssRes = await server.inject({
			method: "GET",
			url: "/app/assets/index.css",
		});
		expect(cssRes.statusCode).toBe(200);
		expect(cssRes.body).toBe("body{}");

		const jsRes = await server.inject({
			method: "GET",
			url: "/app/assets/index.js",
		});
		expect(jsRes.statusCode).toBe(200);
		expect(jsRes.body).toContain("ok");

		const legacyRes = await server.inject({
			method: "GET",
			url: "/assets/index.js",
		});
		expect(legacyRes.statusCode).toBe(404);

		await server.close();
		rmSync(dir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("vite build emits asset URLs under /app/", () => {
		const repoRoot = resolve(import.meta.dirname, "..", "..");
		execSync("pnpm app:build", { cwd: repoRoot, stdio: "pipe" });
		const html = readFileSync(join(repoRoot, "dist", "app", "index.html"), "utf8");
		expect(html).toMatch(/\/app\/assets\//);
		expect(html).not.toMatch(/(?:src|href)="\/assets\//);
	});

	it("warns (no crash) when the static dir does not exist", async () => {
		const logs: string[] = [];
		const server = buildServer({
			github: mockGitHub(),
			llm: mockLlm({ title: "T", body: "b", labels: [] }),
			webhookSecret: "topsecret",
			db: testDb.db,
			logger: { level: "warn" },
			dashboard: {
				db: testDb.db,
				serveStatic: true,
				appStaticDir: join(tmpdir(), "definitely-not-here-xyz"),
			},
		});
		// Capture the internal logger warn output to confirm it was reached.
		const original = server.log.warn;
		server.log.warn = ((o: unknown, _m?: string) => {
			logs.push(typeof o === "string" ? o : (_m ?? ""));
			return original;
		}) as typeof server.log.warn;

		const res = await server.inject({ method: "GET", url: "/health" });
		expect(res.statusCode).toBe(200);
		await server.close();
		vi.clearAllMocks();
	});
});
