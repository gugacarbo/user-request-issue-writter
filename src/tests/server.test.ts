import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateIssueResult, GitHubClient } from "../github/github";
import type { LlmClient } from "../llm/llm";
import type { IssueProposal } from "../llm/tools";
import { buildServer, type ServerDeps } from "../web/server";
import { webhookAuthToken } from "../web/webhook";
import { makeTestDb, type TestDb } from "./dbTestHelper";

vi.mock("../config/allowlist", () => ({
	isRepoAllowed: vi.fn(() => true),
}));

const SECRET = "topsecret";
const TOKEN = webhookAuthToken(SECRET);

function bodyHash(body: string): string {
	return createHash("sha256").update(body).digest("hex");
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

function deps(
	db: NonNullable<ServerDeps["db"]>,
	overrides: Partial<Omit<ServerDeps, "db">> = {},
): ServerDeps {
	return {
		github: mockGitHub(),
		llm: mockLlm({ title: "Bug", body: "desc", labels: ["bug"] }),
		webhookSecret: SECRET,
		db,
		...(overrides as Partial<ServerDeps>),
	};
}

async function app(deps: ServerDeps): Promise<FastifyInstance> {
	const server = buildServer(deps);
	await server.ready();
	return server;
}

const baseHeaders = () => ({
	"content-type": "application/json",
	authorization: `Bearer ${TOKEN}`,
});

describe("server", () => {
	let server: FastifyInstance;
	let testDb: TestDb;

	beforeEach(async () => {
		vi.clearAllMocks();
		testDb = makeTestDb();
		server = await app(deps(testDb.db));
	});

	afterEach(async () => {
		await server.close();
		testDb.cleanup();
	});

	it("healthcheck returns 200", async () => {
		const res = await server.inject({ method: "GET", url: "/health" });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ status: "ok" });
	});

	it("returns 401 when bearer token is invalid", async () => {
		const body = ticketPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer deadbeef",
			},
			payload: body,
		});
		expect(res.statusCode).toBe(401);
	});

	it("returns 401 when authorization header is missing", async () => {
		const body = ticketPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: { "content-type": "application/json" },
			payload: body,
		});
		expect(res.statusCode).toBe(401);
	});

	it("returns 400 when descricao is missing", async () => {
		const body = JSON.stringify({
			repo: "owner/repo",
			requester: { name: "Alice", email: "alice@example.com" },
			payload: {},
		});
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: baseHeaders(),
			payload: body,
		});
		expect(res.statusCode).toBe(400);
	});

	it("returns 400 when repo is missing", async () => {
		const body = JSON.stringify({
			requester: { name: "Alice", email: "alice@example.com" },
			payload: { descricao: "test" },
		});
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: baseHeaders(),
			payload: body,
		});
		expect(res.statusCode).toBe(400);
	});

	it("returns 403 when repo is not in allowlist", async () => {
		const { isRepoAllowed } = await import("../config/allowlist");
		vi.mocked(isRepoAllowed).mockReturnValue(false);
		const body = ticketPayload({ repo: "evil/repo" });
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: baseHeaders(),
			payload: body,
		});
		expect(res.statusCode).toBe(403);
		vi.mocked(isRepoAllowed).mockReturnValue(true);
	});

	it("persists the request and answers 202 (worker is tested separately)", async () => {
		const gh = mockGitHub({ number: 42, url: "https://example/42" });
		server = await app(deps(testDb.db, { github: gh }));
		const body = ticketPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: baseHeaders(),
			payload: body,
		});
		expect(res.statusCode).toBe(202);
		const json = res.json() as {
			accepted: boolean;
			requestId: number;
			bodyHash: string;
		};
		expect(json.accepted).toBe(true);
		expect(json.bodyHash).toBe(bodyHash(body));
		expect(json.requestId).toBeGreaterThan(0);
		// Worker is NOT started in buildServer; createIssue is therefore NOT
		// called here. The queue row is left pending for the worker to claim.
		expect(gh.createIssue).not.toHaveBeenCalled();
	});

	it("ignores duplicate body hash (durable dedupe via SQLite UNIQUE)", async () => {
		const gh = mockGitHub();
		server = await app(deps(testDb.db, { github: gh }));
		const body = ticketPayload();
		const headers = baseHeaders();
		const first = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers,
			payload: body,
		});
		const second = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers,
			payload: body,
		});
		expect(first.statusCode).toBe(202);
		expect(second.statusCode).toBe(200);
		const secondJson = second.json() as {
			accepted: boolean;
			bodyHash: string;
			duplicate: boolean;
		};
		expect(secondJson.accepted).toBe(true);
		expect(secondJson.bodyHash).toBe(bodyHash(body));
		expect(secondJson.duplicate).toBe(true);
		// No worker → createIssue is never called; both calls only touch the DB.
		expect(gh.createIssue).not.toHaveBeenCalled();
	});

	it("dryRun=true returns issue proposal without calling createIssue", async () => {
		const gh = mockGitHub();
		server = await app(deps(testDb.db, { github: gh }));
		const body = ticketPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github?dryRun=true",
			headers: baseHeaders(),
			payload: body,
		});
		expect(res.statusCode).toBe(200);
		const json = res.json() as {
			dryRun: boolean;
			bodyHash: string;
			repo: { owner: string; name: string };
			requester: { name: string; email: string };
			descricao: string;
			issue: { title: string; body: string; labels?: string[] };
		};
		expect(json.dryRun).toBe(true);
		expect(json.bodyHash).toBe(bodyHash(body));
		expect(json.repo).toEqual({ owner: "owner", name: "repo" });
		expect(json.requester.name).toBe("Alice");
		expect(json.requester.email).toBe("alice@example.com");
		expect(json.descricao).toBe("The login button is broken");
		expect(json.issue.title).toBe("Bug");
		expect(json.issue.body).toContain("Alice");
		expect(json.issue.body).toContain("alice@example.com");
		expect(gh.createIssue).not.toHaveBeenCalled();
	});

	it("dryRun=true returns null result when LLM returns no proposal", async () => {
		const gh = mockGitHub();
		const llm: LlmClient = {
			chat: vi.fn(async () => ({ toolCalls: [], content: null })),
		};
		server = await app(deps(testDb.db, { github: gh, llm }));
		const body = ticketPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github?dryRun=true",
			headers: baseHeaders(),
			payload: body,
		});
		expect(res.statusCode).toBe(200);
		const json = res.json() as { dryRun: boolean; result: null };
		expect(json.dryRun).toBe(true);
		expect(json.result).toBeNull();
	});

	it("dryRun=true returns 500 when generateIssue throws", async () => {
		const gh = mockGitHub();
		const llm: LlmClient = {
			chat: vi.fn(async () => {
				throw new Error("LLM down");
			}),
		};
		server = await app(deps(testDb.db, { github: gh, llm }));
		const body = ticketPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github?dryRun=true",
			headers: baseHeaders(),
			payload: body,
		});
		expect(res.statusCode).toBe(500);
		const json = res.json() as { error: string; detail: string };
		expect(json.error).toBe("processing failed");
		expect(json.detail).toBe("LLM down");
	});

	it("returns 202 with bodyHash when no delivery header is present", async () => {
		const gh = mockGitHub();
		server = await app(deps(testDb.db, { github: gh }));
		const body = ticketPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: baseHeaders(),
			payload: body,
		});
		expect(res.statusCode).toBe(202);
		const json = res.json() as { accepted: boolean; bodyHash: string };
		expect(json.accepted).toBe(true);
		expect(json.bodyHash).toBe(bodyHash(body));
	});

	it("returns 422 when body is not valid JSON", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: baseHeaders(),
			payload: "not-json",
		});
		expect(res.statusCode).toBe(422);
	});

	it("returns 400 when raw body is missing", async () => {
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: baseHeaders(),
		});
		expect(res.statusCode).toBe(400);
	});
});
