import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "ghp_test";

function jsonResponse(
	body: unknown,
	init?: { status?: number; ok?: boolean },
): Response {
	return {
		ok: init?.ok ?? true,
		status: init?.status ?? 200,
		json: async () => body,
		text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
		headers: new Headers(),
	} as Response;
}

function captureFetch(): {
	mock: ReturnType<typeof vi.fn>;
	calls: RequestInfo[];
	lastInit?: RequestInit;
} {
	const calls: RequestInfo[] = [];
	let lastInit: RequestInit | undefined;
	const mock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
		calls.push(input);
		lastInit = init;
		const url = typeof input === "string" ? input : input.url;
		if (url.includes("/contents/")) {
			const path = new URL(url).pathname.split("/contents/")[1];
			return jsonResponse({ path, content: "aGVsbG8=", encoding: "base64" });
		}
		if (url.includes("/git/trees/")) {
			return jsonResponse({
				tree: [{ path: "src/main.ts" }, { path: "README.md" }],
			});
		}
		if (url.includes("/repos/") && url.endsWith("repo")) {
			return jsonResponse({
				name: "repo",
				description: "demo",
				language: "TypeScript",
				default_branch: "main",
			});
		}
		if (url.includes("/issues") && init?.method === "POST") {
			const body = JSON.parse(String(init.body));
			if (body.labels && url.includes("bad-labels")) {
				return jsonResponse(
					{ message: "labels [nope] don't exist" },
					{ status: 422, ok: false },
				);
			}
			return jsonResponse({ number: 42, html_url: "https://example/issue/42" });
		}
		return jsonResponse({});
	});
	vi.stubGlobal("fetch", mock);
	return {
		mock,
		calls,
		get lastInit() {
			return lastInit;
		},
	};
}

describe("github client", () => {
	beforeEach(() => {
		process.env.GITHUB_TOKEN = TOKEN;
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("getRepoTree lists top-level paths and sends Bearer auth", async () => {
		const { mock, calls } = captureFetch();
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		const tree = await gh.getRepoTree("owner", "repo");
		expect(tree).toEqual(["src/main.ts", "README.md"]);
		expect(calls.at(-1)?.toString()).toContain(
			"/repos/owner/repo/git/trees/main",
		);
		expect(mock.mock.calls[0]?.[1]?.headers).toEqual(
			expect.objectContaining({
				Authorization: `Bearer ${TOKEN}`,
				Accept: "application/vnd.github+json",
			}),
		);
	});

	it("getFileContent decodes base64 and truncates large content", async () => {
		const long = "x".repeat(20_000);
		const mock = vi.fn(async () =>
			jsonResponse({
				content: Buffer.from(long).toString("base64"),
				encoding: "base64",
				size: long.length,
			}),
		);
		vi.stubGlobal("fetch", mock);
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		const content = await gh.getFileContent("owner", "repo", "src/big.ts");
		expect(content.length).toBeLessThanOrEqual(10_000);
		expect(content).toContain("x");
	});

	it("getRepoInfo returns description and languages", async () => {
		process.env.GITHUB_TOKEN = TOKEN;
		const mock = vi.fn(async (input: RequestInfo) => {
			const url = typeof input === "string" ? input : input.url;
			if (url.endsWith("/repos/owner/repo"))
				return jsonResponse({
					description: "demo repo",
					language: "TypeScript",
				});
			if (url.includes("/languages")) return jsonResponse({ TypeScript: 1000 });
			if (url.endsWith("/contents/README.md"))
				return jsonResponse({ content: "IyByZWFkbWU=", encoding: "base64" });
			return jsonResponse({});
		});
		vi.stubGlobal("fetch", mock);
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		const info = await gh.getRepoInfo("owner", "repo");
		expect(info.description).toBe("demo repo");
		expect(info.languages).toEqual({ TypeScript: 1000 });
		expect(info.readme).toContain("readme");
	});

	it("createIssue returns issue number and url", async () => {
		const { calls } = captureFetch();
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		const res = await gh.createIssue("owner", "repo", {
			title: "t",
			body: "b",
			labels: ["bug"],
		});
		expect(res).toEqual({ number: 42, url: "https://example/issue/42" });
		expect(calls[0]?.toString()).toContain("/repos/owner/repo/issues");
	});

	it("createIssue falls back to no labels on 422", async () => {
		const calls: { body: string }[] = [];
		const mock = vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			calls.push({ body: String(init?.body) });
			if (body.labels) {
				return jsonResponse(
					{ message: "labels [nope] don't exist" },
					{ status: 422, ok: false },
				);
			}
			return jsonResponse({ number: 7, html_url: "https://example/issue/7" });
		});
		vi.stubGlobal("fetch", mock);
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		const res = await gh.createIssue("owner", "repo", {
			title: "t",
			body: "b",
			labels: ["nope"],
		});
		expect(res).toEqual({ number: 7, url: "https://example/issue/7" });
		expect(calls).toHaveLength(2);
		expect(JSON.parse(calls[0].body).labels).toEqual(["nope"]);
		expect(JSON.parse(calls[1].body).labels).toBeUndefined();
	});

	it("getJson throws with status and body on non-ok response", async () => {
		const mock = vi.fn(async () =>
			jsonResponse({ message: "Not Found" }, { status: 404, ok: false }),
		);
		vi.stubGlobal("fetch", mock);
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		await expect(gh.getRepoTree("owner", "repo")).rejects.toThrow(
			/GitHub API 404/,
		);
	});

	it("getRepoInfo handles readme fetch error gracefully", async () => {
		const mock = vi.fn(async (input: RequestInfo) => {
			const url = typeof input === "string" ? input : input.url;
			if (url.endsWith("/repos/owner/repo"))
				return jsonResponse({ description: "demo" });
			if (url.includes("/languages")) return jsonResponse({ TypeScript: 1 });
			if (url.includes("/contents/README.md"))
				return jsonResponse(
					{ message: "Not Found" },
					{ status: 404, ok: false },
				);
			return jsonResponse({});
		});
		vi.stubGlobal("fetch", mock);
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		const info = await gh.getRepoInfo("owner", "repo");
		expect(info.description).toBe("demo");
		expect(info.readme).toBeNull();
	});

	it("createIssue throws on non-422 error", async () => {
		const mock = vi.fn(async () =>
			jsonResponse({ message: "Server Error" }, { status: 500, ok: false }),
		);
		vi.stubGlobal("fetch", mock);
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		await expect(
			gh.createIssue("owner", "repo", { title: "t", body: "b" }),
		).rejects.toThrow(/GitHub createIssue 500/);
	});

	it("getFileContent returns empty string when content is missing", async () => {
		const mock = vi.fn(async () => jsonResponse({ encoding: "base64" }));
		vi.stubGlobal("fetch", mock);
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		const content = await gh.getFileContent("owner", "repo", "empty.ts");
		expect(content).toBe("");
	});

	it("getFileContent returns empty string when encoding is not base64", async () => {
		const mock = vi.fn(async () =>
			jsonResponse({ content: "aGVsbG8=", encoding: "utf8" }),
		);
		vi.stubGlobal("fetch", mock);
		const { createGitHubClient } = await import("../github/github");
		const gh = createGitHubClient(TOKEN);
		const content = await gh.getFileContent("owner", "repo", "utf8.ts");
		expect(content).toBe("");
	});
});
