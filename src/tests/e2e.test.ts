import "dotenv/config";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { CreateIssueResult, GitHubClient } from "../github";
import { createOpenAiLlmClient } from "../openai";
import { buildServer, type ServerDeps } from "../server";
import { startWorker, type WorkerHandle } from "../worker";
import { makeTestDb, type TestDb } from "./dbTestHelper";

vi.mock("../allowlist", () => ({
	isRepoAllowed: vi.fn(() => true),
}));

const WEBHOOK_SECRET = "e2e-test-secret";

const llmEnv = {
	apiKey: process.env.LLM_API_KEY,
	baseUrl: process.env.LLM_BASE_URL,
	model: process.env.LLM_MODEL,
} as const;

const canRunE2e = Boolean(llmEnv.apiKey && llmEnv.baseUrl && llmEnv.model);

describe.skipIf(!canRunE2e)("e2e: webhook → real LLM → mocked GitHub", () => {
	let baseUrl: string;
	let createdIssue: {
		owner: string;
		repo: string;
		title: string;
		body: string;
		labels?: string[];
	} | null = null;
	let testDb: TestDb;
	let worker: WorkerHandle;

	const mockGitHub: GitHubClient = {
		getRepoTree: vi.fn(async () => [
			"src/index.ts",
			"src/login.ts",
			"tests/login.test.ts",
			"README.md",
			"package.json",
		]),
		getFileContent: vi.fn(async (_owner, _repo, path) => {
			if (path === "src/login.ts") {
				return [
					"export function login(email: string, password: string) {",
					"  // TODO: validate credentials",
					"  // Throws when password is empty",
					"  if (!password) throw new Error('empty password');",
					"  return fetch('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });",
					"}",
				].join("\n");
			}
			if (path === "README.md") return "# Demo App\n\nA login demo.";
			return "";
		}),
		getRepoInfo: vi.fn(async () => ({
			description: "Login demo application",
			languages: { TypeScript: 90, JSON: 10 },
			readme: "# Demo App\n\nA login demo.",
		})),
		createIssue: vi.fn(
			async (owner, repo, input): Promise<CreateIssueResult> => {
				createdIssue = {
					owner,
					repo,
					title: input.title,
					body: input.body,
					labels: input.labels,
				};
				return {
					number: 99,
					url: "https://github.com/owner/repo/issues/99",
				};
			},
		),
	};

	beforeAll(async () => {
		if (!llmEnv.apiKey || !llmEnv.baseUrl || !llmEnv.model) {
			throw new Error("missing LLM env vars");
		}
		const apiKey = llmEnv.apiKey;
		const llmBaseUrl = llmEnv.baseUrl;
		const model = llmEnv.model;
		testDb = makeTestDb();
		const deps: ServerDeps = {
			github: mockGitHub,
			llm: createOpenAiLlmClient({
				baseUrl: llmBaseUrl,
				apiKey,
				model,
			}),
			webhookSecret: WEBHOOK_SECRET,
			db: testDb.db,
			logger: { level: process.env.LOG_LEVEL ?? "info" },
		};
		const server = buildServer(deps);
		// Same-process worker (ADR-0008) drains the queue and drives the real
		// LLM tool loop, so the e2e flow mirrors production exactly.
		worker = startWorker({
			db: testDb.db,
			github: mockGitHub,
			llm: createOpenAiLlmClient({
				baseUrl: llmBaseUrl,
				apiKey,
				model,
			}),
			pollIntervalMs: 100,
		});
		await server.listen({ port: 0, host: "127.0.0.1" });
		const address = server.server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${address.port}`;
		afterAll(async () => {
			await worker.stop();
			await server.close();
			testDb.cleanup();
		});
	});

	beforeEach(() => {
		vi.clearAllMocks();
		createdIssue = null;
	});

	function sign(body: string): string {
		return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
	}

	function ticketBody(
		overrides: Partial<Record<string, unknown>> = {},
	): string {
		return JSON.stringify({
			repo: "owner/repo",
			requester: { name: "Bob", email: "bob@example.com" },
			payload: {
				descricao:
					"The login button is broken. When I click it, nothing happens. Please create an issue to investigate the login function in src/login.ts.",
				url_atual: "https://app.example.com/login",
				categoria: "bug",
			},
			...overrides,
		});
	}

	it("receives 202 and the LLM drafts an issue via real function calling", async () => {
		const body = ticketBody();
		const res = await fetch(`${baseUrl}/webhook/github`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-hub-signature-256": sign(body),
				"x-delivery-id": "e2e-001",
			},
			body,
		});

		expect(res.status).toBe(202);
		expect((await res.json()).delivery).toBe("e2e-001");

		await vi.waitFor(
			() => {
				expect(createdIssue).not.toBeNull();
			},
			{ timeout: 60_000, interval: 1_000 },
		);

		if (!createdIssue) throw new Error("issue was not created");

		expect(createdIssue.owner).toBe("owner");
		expect(createdIssue.repo).toBe("repo");
		expect(createdIssue.title.length).toBeGreaterThan(3);
		expect(createdIssue.body).toContain("Bob");
		expect(createdIssue.body).toContain("bob@example.com");
	}, 90_000);

	it("returns 400 when descricao is missing", async () => {
		const body = JSON.stringify({
			repo: "owner/repo",
			requester: { name: "Bob", email: "bob@example.com" },
			payload: {},
		});
		const res = await fetch(`${baseUrl}/webhook/github`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-hub-signature-256": sign(body),
				"x-delivery-id": "e2e-002",
			},
			body,
		});
		expect(res.status).toBe(400);
	});

	it("dryRun=true returns the drafted issue without creating it on GitHub", async () => {
		const body = ticketBody();
		const res = await fetch(`${baseUrl}/webhook/github?dryRun=true`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-hub-signature-256": sign(body),
				"x-delivery-id": "e2e-003",
			},
			body,
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			dryRun: boolean;
			delivery: string;
			repo: { owner: string; name: string };
			requester: { name: string; email: string };
			descricao: string;
			issue: { title: string; body: string; labels?: string[] };
		};

		expect(json.dryRun).toBe(true);
		expect(json.delivery).toBe("e2e-003");
		expect(json.repo).toEqual({ owner: "owner", name: "repo" });
		expect(json.requester.name).toBe("Bob");
		expect(json.requester.email).toBe("bob@example.com");
		expect(json.issue.title.length).toBeGreaterThan(3);
		expect(json.issue.body).toContain("Bob");
		expect(json.issue.body).toContain("bob@example.com");

		expect(mockGitHub.createIssue).not.toHaveBeenCalled();
	}, 90_000);
});
