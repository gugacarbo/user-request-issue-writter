import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateIssueResult, GitHubClient } from "../src/github.ts";
import type { IssueProposal, LlmClient } from "../src/llm.ts";
import { buildServer, type ServerDeps } from "../src/server.ts";

const SECRET = "topsecret";

function sign(body: string): string {
	return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

function commentPayload(
	overrides: Partial<Record<string, unknown>> = {},
): string {
	return JSON.stringify({
		action: "created",
		repository: {
			full_name: "owner/repo",
			name: "repo",
			owner: { login: "owner" },
		},
		issue: { number: 3, title: "Login fails", body: "it broke" },
		comment: {
			body: "/issue login broken",
			user: { login: "alice" },
			html_url: "https://example/c/3",
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

function deps(overrides: Partial<ServerDeps> = {}): ServerDeps {
	return {
		github: mockGitHub(),
		llm: mockLlm({ title: "Bug", body: "desc", labels: ["bug"] }),
		webhookSecret: SECRET,
		triggerPrefix: undefined,
		...overrides,
	};
}

async function app(deps: ServerDeps): Promise<FastifyInstance> {
	const server = buildServer(deps);
	await server.ready();
	return server;
}

describe("server", () => {
	let server: FastifyInstance;

	beforeEach(async () => {
		server = await app(deps());
	});

	afterEach(async () => {
		await server.close();
	});

	it("healthcheck returns 200", async () => {
		const res = await server.inject({ method: "GET", url: "/health" });
		expect(res.statusCode).toBe(200);
		expect(res.json()).toEqual({ status: "ok" });
	});

	it("returns 200 no-op for non issue_comment events", async () => {
		const body = commentPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: {
				"content-type": "application/json",
				"x-github-event": "push",
				"x-hub-signature-256": sign(body),
				"x-github-delivery": "d1",
			},
			payload: body,
		});
		expect(res.statusCode).toBe(200);
	});

	it("returns 401 when HMAC signature is invalid", async () => {
		const body = commentPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: {
				"content-type": "application/json",
				"x-github-event": "issue_comment",
				"x-hub-signature-256": "sha256=bad",
				"x-github-delivery": "d2",
			},
			payload: body,
		});
		expect(res.statusCode).toBe(401);
	});

	it("returns 202 accepted and processes the issue in background", async () => {
		const gh = mockGitHub({ number: 42, url: "https://example/42" });
		server = await app(deps({ github: gh }));
		const body = commentPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: {
				"content-type": "application/json",
				"x-github-event": "issue_comment",
				"x-hub-signature-256": sign(body),
				"x-github-delivery": "d3",
			},
			payload: body,
		});
		expect(res.statusCode).toBe(202);
		expect(res.json()).toEqual({ accepted: true, delivery: "d3" });
		await vi.waitFor(() => expect(gh.createIssue).toHaveBeenCalled());
		const call = (gh.createIssue as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(call?.[0]).toBe("owner");
		expect(call?.[1]).toBe("repo");
		const proposal = call?.[2];
		expect(proposal.body).toContain("alice");
		expect(proposal.body).toContain("https://example/c/3");
	});

	it("ignores duplicate delivery id (dedupe)", async () => {
		const gh = mockGitHub();
		server = await app(deps({ github: gh }));
		const body = commentPayload();
		const headers = {
			"content-type": "application/json",
			"x-github-event": "issue_comment",
			"x-hub-signature-256": sign(body),
			"x-github-delivery": "dup1",
		};
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
		expect(second.json()).toEqual({
			accepted: true,
			delivery: "dup1",
			duplicate: true,
		});
		await vi.waitFor(() =>
			expect(
				(gh.createIssue as ReturnType<typeof vi.fn>).mock.calls,
			).toHaveLength(1),
		);
	});

	it("does not process when trigger prefix does not match", async () => {
		const gh = mockGitHub();
		server = await app(deps({ github: gh, triggerPrefix: "/bug" }));
		const body = commentPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github",
			headers: {
				"content-type": "application/json",
				"x-github-event": "issue_comment",
				"x-hub-signature-256": sign(body),
				"x-github-delivery": "d4",
			},
			payload: body,
		});
		expect(res.statusCode).toBe(200);
		await vi.waitFor(() =>
			expect(gh.createIssue as ReturnType<typeof vi.fn>).not.toHaveBeenCalled(),
		);
	});

	it("dryRun=true returns issue proposal without calling createIssue", async () => {
		const gh = mockGitHub();
		server = await app(deps({ github: gh }));
		const body = commentPayload();
		const res = await server.inject({
			method: "POST",
			url: "/webhook/github?dryRun=true",
			headers: {
				"content-type": "application/json",
				"x-github-event": "issue_comment",
				"x-hub-signature-256": sign(body),
				"x-github-delivery": "d5",
			},
			payload: body,
		});
		expect(res.statusCode).toBe(200);
		const json = res.json() as {
			dryRun: boolean;
			repo: { owner: string; name: string };
			comment: { user: string };
			sourceIssue: { number: number };
			issue: { title: string; body: string; labels?: string[] };
		};
		expect(json.dryRun).toBe(true);
		expect(json.repo).toEqual({ owner: "owner", name: "repo" });
		expect(json.comment.user).toBe("alice");
		expect(json.sourceIssue.number).toBe(3);
		expect(json.issue.title).toBe("Bug");
		expect(json.issue.body).toContain("alice");
		expect(json.issue.body).toContain("https://example/c/3");

		expect(gh.createIssue).not.toHaveBeenCalled();
	});
});
