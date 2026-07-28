import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queue as queueTable } from "../db/schema";
import type { CreateIssueResult, GitHubClient } from "../github/github";
import type { LlmClient } from "../llm/llm";
import type { IssueProposal } from "../llm/tools";
import {
	enqueueRequest,
	getQueueByRequest,
	getRequest,
	listLlmLogsForRequest,
	setQueueStatusForRequest,
} from "../queue/queue";
import { startWorker, type WorkerHandle } from "../queue/worker";
import { makeTestDb, type TestDb } from "./dbTestHelper";

vi.mock("../config/allowlist", () => ({ isRepoAllowed: vi.fn(() => true) }));

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
		uploadRepositoryFile: vi.fn(
			async () =>
				"https://raw.githubusercontent.com/owner/repo/main/.github/issue-screenshots/test.png",
		),
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

	it("embeds optional screenshot in the created issue body", async () => {
		const gh = mockGitHub({ number: 7, url: "https://example/7" });
		const llm = mockLlm({
			title: "Bug",
			body: "## Resumo\nBroken.",
			labels: ["bug"],
		});
		const body = ticketPayload({
			payload: {
				descricao: "The login button is broken",
				url_atual: "https://app.example.com/login",
				categoria: "bug",
				screenshot: "https://cdn.example.com/shot.png",
			},
		});
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
		});

		await vi.waitFor(() => expect(gh.createIssue).toHaveBeenCalled(), {
			timeout: 5_000,
		});
		const createIssueArgs = (gh.createIssue as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[2] as { body: string } | undefined;
		expect(createIssueArgs?.body).toContain("## Screenshot");
		expect(createIssueArgs?.body).toContain(
			"![Screenshot](https://cdn.example.com/shot.png)",
		);
		expect(createIssueArgs?.body).toContain("The login button is broken");

		await vi.waitFor(() => {
			expect(getRequest({ db: testDb.db }, requestId)?.status).toBe("done");
		});
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

	it("marks failed when stored ticket payload is invalid", async () => {
		const gh = mockGitHub();
		const llm = mockLlm({ title: "T", body: "b", labels: [] });
		const requestId = assertInserted(
			enqueueRequest(
				{ db: testDb.db },
				{
					bodyHash: bodyHash("not-json"),
					owner: "owner",
					repo: "owner/repo",
					requesterName: "Alice",
					requesterEmail: "alice@example.com",
					payload: "not-json",
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
				expect(req?.lastError).toBe("invalid stored ticket payload");
			},
			{ timeout: 5_000 },
		);
		expect(gh.createIssue).not.toHaveBeenCalled();
	}, 10_000);

	it("embeds ticket header and diagnostics in the created issue body", async () => {
		const gh = mockGitHub({ number: 12, url: "https://example/12" });
		const llm = mockLlm({
			title: "Bug",
			body: "## Resumo\nBroken.",
			labels: ["bug"],
		});
		const body = ticketPayload({
			metadata: { ticketId: "99" },
			payload: {
				descricao: "The login button is broken",
				url_atual: "https://app.example.com/login",
				categoria: "bug",
				contexto_da_sessao: "Chrome 120",
				logs_do_console: "TypeError: boom",
			},
		});
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
		});

		await vi.waitFor(() => expect(gh.createIssue).toHaveBeenCalled(), {
			timeout: 5_000,
		});
		const issueBody = (gh.createIssue as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[2] as { body: string } | undefined;
		expect(issueBody?.body).toContain("## Informações do ticket");
		expect(issueBody?.body).toContain("### Metadados");
		expect(issueBody?.body).toContain("## Contexto da sessão");
		expect(issueBody?.body).toContain("TypeError: boom");
		expect(issueBody?.body.indexOf("## Resumo")).toBeLessThan(
			issueBody?.body.indexOf("## Contexto da sessão") ?? -1,
		);

		await vi.waitFor(() => {
			expect(getRequest({ db: testDb.db }, requestId)?.status).toBe("done");
		});
	}, 10_000);

	it("retries createIssue after a transient failure and succeeds", async () => {
		const gh = mockGitHub({ number: 55, url: "https://example/55" });
		(gh.createIssue as ReturnType<typeof vi.fn>)
			.mockRejectedValueOnce(new Error("github down"))
			.mockResolvedValueOnce({ number: 55, url: "https://example/55" });
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

		worker = startWorker({
			db: testDb.db,
			github: gh,
			llm,
			pollIntervalMs: 10,
			maxAttempts: 3,
			retryBackoffSeconds: () => 0,
		});

		await vi.waitFor(() => expect(gh.createIssue).toHaveBeenCalledTimes(2), {
			timeout: 5_000,
		});
		await vi.waitFor(() => {
			expect(getRequest({ db: testDb.db }, requestId)?.status).toBe("done");
		});
	}, 10_000);

	it("retries when the agent does not call submit_issue", async () => {
		const gh = mockGitHub();
		const llm: LlmClient = {
			chat: vi
				.fn()
				.mockResolvedValueOnce({ toolCalls: [], content: null })
				.mockResolvedValueOnce({
					toolCalls: [
						{
							name: "submit_issue",
							arguments: { title: "T", body: "b", labels: [] },
						},
					],
					content: null,
				}),
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
			maxAttempts: 3,
			retryBackoffSeconds: () => 0,
		});

		await vi.waitFor(() => expect(gh.createIssue).toHaveBeenCalled(), {
			timeout: 5_000,
		});
		await vi.waitFor(() => {
			expect(getRequest({ db: testDb.db }, requestId)?.status).toBe("done");
		});
		expect(llm.chat).toHaveBeenCalledTimes(2);
	}, 10_000);

	it("marks failed when createIssue throws", async () => {
		const gh = mockGitHub();
		(gh.createIssue as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("github down"),
		);
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
				expect(req?.lastError).toBe("github down");
			},
			{ timeout: 5_000 },
		);
	}, 10_000);

	it("gives up when max attempts are exceeded", async () => {
		const gh = mockGitHub();
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

		const queueRow = getQueueByRequest({ db: testDb.db }, requestId);
		if (!queueRow) throw new Error("expected queue row");
		testDb.db
			.update(queueTable)
			.set({ attempts: 2 })
			.where(eq(queueTable.id, queueRow.id))
			.run();

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
				expect(req?.lastError).toBe("max attempts (1) exceeded");
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
