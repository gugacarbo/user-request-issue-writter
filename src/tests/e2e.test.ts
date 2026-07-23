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
import type { CreateIssueResult, GitHubClient } from "../src/github.ts";
import { createOpenAiLlmClient } from "../src/openai.ts";
import { buildServer, type ServerDeps } from "../src/server.ts";

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
		const deps: ServerDeps = {
			github: mockGitHub,
			llm: createOpenAiLlmClient({
				baseUrl: llmEnv.baseUrl,
				apiKey: llmEnv.apiKey,
				model: llmEnv.model,
			}),
			webhookSecret: WEBHOOK_SECRET,
			triggerPrefix: undefined,
			logger: { level: process.env.LOG_LEVEL ?? "info" },
		};
		const server = buildServer(deps);
		await server.listen({ port: 0, host: "127.0.0.1" });
		const address = server.server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${address.port}`;
		afterAll(() => server.close());
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	function sign(body: string): string {
		return `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")}`;
	}

	function commentBody(
		overrides: Partial<Record<string, unknown>> = {},
	): string {
		return JSON.stringify({
			action: "created",
			repository: {
				full_name: "owner/repo",
				name: "repo",
				owner: { login: "owner" },
			},
			issue: {
				number: 5,
				title: "Login button does nothing",
				body: "When I click login nothing happens",
			},
			comment: {
				body: "The login button is broken. When I click it, nothing happens. Please create an issue to investigate the login function in src/login.ts.",
				user: { login: "bob" },
				html_url: "https://github.com/owner/repo/issues/5#issuecomment-1",
			},
			...overrides,
		});
	}

	it("receives 202 and the LLM drafts an issue via real function calling", async () => {
		const body = commentBody();
		const res = await fetch(`${baseUrl}/webhook/github`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-github-event": "issue_comment",
				"x-hub-signature-256": sign(body),
				"x-github-delivery": "e2e-001",
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
		expect(createdIssue.body).toContain("bob");
		expect(createdIssue.body).toContain(
			"https://github.com/owner/repo/issues/5#issuecomment-1",
		);
	}, 90_000);

	it("ignored event returns 200", async () => {
		const body = commentBody({ action: "deleted" });
		const res = await fetch(`${baseUrl}/webhook/github`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-github-event": "issue_comment",
				"x-hub-signature-256": sign(body),
				"x-github-delivery": "e2e-002",
			},
			body,
		});
		expect(res.status).toBe(200);
	});

	it("dryRun=true returns the drafted issue without creating it on GitHub", async () => {
		const body = commentBody();
		const res = await fetch(`${baseUrl}/webhook/github?dryRun=true`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-github-event": "issue_comment",
				"x-hub-signature-256": sign(body),
				"x-github-delivery": "e2e-003",
			},
			body,
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			dryRun: boolean;
			delivery: string;
			repo: { owner: string; name: string };
			comment: { user: string; body: string; url: string };
			sourceIssue: { number: number; title: string };
			issue: { title: string; body: string; labels?: string[] };
		};

		expect(json.dryRun).toBe(true);
		expect(json.delivery).toBe("e2e-003");
		expect(json.repo).toEqual({ owner: "owner", name: "repo" });
		expect(json.comment.user).toBe("bob");
		expect(json.comment.url).toBe(
			"https://github.com/owner/repo/issues/5#issuecomment-1",
		);
		expect(json.sourceIssue.number).toBe(5);
		expect(json.sourceIssue.title).toBe("Login button does nothing");
		expect(json.issue.title.length).toBeGreaterThan(3);
		expect(json.issue.body).toContain("bob");
		expect(json.issue.body).toContain(
			"https://github.com/owner/repo/issues/5#issuecomment-1",
		);

		expect(mockGitHub.createIssue).not.toHaveBeenCalled();
	}, 90_000);
});
