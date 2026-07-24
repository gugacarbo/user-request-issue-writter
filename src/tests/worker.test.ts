import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateIssueResult, GitHubClient } from "../github";
import type { LlmClient } from "../llm";
import {
	enqueueRequest,
	getQueueByRequest,
	getRequest,
	listLlmLogsForRequest,
	setQueueStatusForRequest,
} from "../queue";
import type { IssueProposal } from "../tools";
import { startWorker, type WorkerHandle } from "../worker";
import { makeTestDb, type TestDb } from "./dbTestHelper";

vi.mock("../allowlist", () => ({ isRepoAllowed: vi.fn(() => true) }));

function bodyHash(body: string): string {
	return createHash("sha256").update(body).digest("hex");
}

/** Type guard so the narrowed inserted variant is usable without relying on
 * vitest's `expect` (which isn't a TS type guard). */
function assertInserted(r: ReturnType<typeof enqueueRequest>): number {
	if (r.kind !== "inserted")
		throw new Error(`expected inserted, got ${r.kind}`);
	return r.requestId;
}

function ticketPayload(
	overrides: Partial<Record<string, unknown>> = {},
): string {
	return JSON.stringify({
		repo: "owner/repo",
		requester: { name: "Alice", email: "alice@example.com" },
		payload: {
			descricao: "The login button is broken",
			url_atual: "https://app.example.com/login",
			categoria: "bug",
		},
		...overrides,
	});
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

describe("worker", () => {
	let testDb: TestDb;
	let worker: WorkerHandle;

	beforeEach(() => {
		vi.clearAllMocks();
		testDb = makeTestDb();
	});

	afterEach(async () => {
		await worker.stop();
		testDb.cleanup();
	});

	it("drains a pending request: LLM → createIssue → done + llm_logs", async () => {
		const gh = mockGitHub({ number: 42, url: "https://example/42" });
		const llm = mockLlm({ title: "Bug", body: "desc", labels: ["bug"] });

		const body = ticketPayload();
		const requestId = assertInserted(
			enqueueRequest(
				{ db: testDb.db },
				{
					bodyHash: bodyHash(body),
					owner: "owner",
					repo: "owner/repo",
					requesterName: "Alice",
					requesterEmail: "alice@example.com",
					payload: body,
				},
			),
		);
		expect(requestId).toBeGreaterThan(0);
		worker = startWorker({
			db: testDb.db,
			github: gh,
			llm,
			pollIntervalMs: 10,
		});

		await vi.waitFor(() => expect(gh.createIssue).toHaveBeenCalled(), {
			timeout: 5_000,
		});
		const call = (gh.createIssue as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call?.[0]).toBe("owner");
		expect(call?.[1]).toBe("repo");
		const createIssueArgs = call?.[2] as { body: string } | undefined;
		expect(createIssueArgs).toBeDefined();
		expect(createIssueArgs?.body).toContain("Alice");

		// Allow finalize to commit, then assert rows.
		await vi.waitFor(() => {
			const req = getRequest({ db: testDb.db }, requestId);
			expect(req?.status).toBe("done");
		});
		const req = getRequest({ db: testDb.db }, requestId);
		expect(req?.issueNumber).toBe(42);
		expect(req?.issueUrl).toBe("https://example/42");

		const queueRow = getQueueByRequest({ db: testDb.db }, requestId);
		expect(queueRow?.status).toBe("done");

		// The LLM agent emitted events that landed in llm_logs.
		const logs = listLlmLogsForRequest({ db: testDb.db }, requestId);
		expect(logs.length).toBeGreaterThan(0);
	}, 10_000);

	it("marks failed when the agent does not call submit_issue", async () => {
		const gh = mockGitHub();
		const llm: LlmClient = {
			chat: vi.fn(async () => ({ toolCalls: [], content: null })),
		};

		const body = ticketPayload();
		const requestId = assertInserted(
			enqueueRequest(
				{ db: testDb.db },
				{
					bodyHash: bodyHash(body),
					owner: "owner",
					repo: "owner/repo",
					requesterName: "Alice",
					requesterEmail: "alice@example.com",
					payload: body,
				},
			),
		);

		worker = startWorker({
			db: testDb.db,
			github: gh,
			llm,
			pollIntervalMs: 10,
			maxAttempts: 1,
		});

		await vi.waitFor(
			() => {
				const req = getRequest({ db: testDb.db }, requestId);
				expect(req?.status).toBe("failed");
			},
			{ timeout: 5_000 },
		);
		expect(gh.createIssue).not.toHaveBeenCalled();
	}, 10_000);

	it("reclaims rows left processing at boot", async () => {
		const gh = mockGitHub({ number: 7, url: "https://example/7" });
		const llm = mockLlm({ title: "T", body: "b", labels: [] });

		const body = ticketPayload();
		const requestId = assertInserted(
			enqueueRequest(
				{ db: testDb.db },
				{
					bodyHash: bodyHash(body),
					owner: "owner",
					repo: "owner/repo",
					requesterName: "Alice",
					requesterEmail: "alice@example.com",
					payload: body,
				},
			),
		);

		// Simulate a crash mid-run: force the queue row to `processing`.
		setQueueStatusForRequest({ db: testDb.db }, requestId, "processing");
		worker = startWorker({
			db: testDb.db,
			github: gh,
			llm,
			pollIntervalMs: 10,
		});

		await vi.waitFor(() => expect(gh.createIssue).toHaveBeenCalled(), {
			timeout: 5_000,
		});
		await vi.waitFor(() => {
			const req = getRequest({ db: testDb.db }, requestId);
			expect(req?.status).toBe("done");
		});
	}, 10_000);
});
