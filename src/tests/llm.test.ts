import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/github";
import type { LlmClient, ToolCall } from "../llm/llm";

function mockGitHub(): GitHubClient {
	return {
		getRepoTree: vi.fn(async () => ["src/index.ts", "README.md"]),
		getFileContent: vi.fn(async () => "export const main = () => {};"),
		getRepoInfo: vi.fn(async () => ({
			description: "demo",
			languages: { TypeScript: 1 },
			readme: "# demo",
		})),
		createIssue: vi.fn(async () => ({ number: 1, url: "x" })),
		uploadRepositoryFile: vi.fn(
			async () =>
				"https://raw.githubusercontent.com/owner/repo/main/.github/issue-screenshots/test.png",
		),
	};
}

function scriptLlm(script: ToolCall[][]): LlmClient {
	let i = 0;
	return {
		chat: vi.fn(async () => {
			const toolCalls = script[i++] ?? [];
			return { toolCalls, content: null };
		}),
	};
}

const BASE_INPUT = {
	owner: "owner",
	repo: "repo",
	requesterName: "Alice",
	requesterEmail: "alice@example.com",
	descricao: "please create an issue for the bug in login",
};

describe("llm.generateIssue", () => {
	it("runs a tool loop and returns the submitted issue proposal", async () => {
		const llm = scriptLlm([
			[{ name: "list_files", arguments: {} }],
			[
				{
					name: "submit_issue",
					arguments: { title: "Bug", body: "desc", labels: ["bug"] },
				},
			],
		]);
		const { generateIssue } = await import("../llm/llm");
		const result = await generateIssue(llm, mockGitHub(), BASE_INPUT);
		expect(result.outcome).toBe("issue");
		if (result.outcome === "issue") {
			expect(result.proposal.title).toBe("Bug");
			expect(result.proposal.labels).toEqual(["bug"]);
		}
	});

	it("returns incomplete when the model never calls submit_issue", async () => {
		const llm = scriptLlm([[{ name: "list_files", arguments: {} }]]);
		const { generateIssue } = await import("../llm/llm");
		const result = await generateIssue(llm, mockGitHub(), BASE_INPUT, {
			maxIterations: 2,
		});
		expect(result).toEqual({ outcome: "incomplete" });
	});

	it("stops at the iteration cap without throwing", async () => {
		const llm: LlmClient = {
			chat: vi.fn(async () => ({
				toolCalls: [{ name: "list_files", arguments: {} }],
				content: null,
			})),
		};
		const { generateIssue } = await import("../llm/llm");
		const result = await generateIssue(llm, mockGitHub(), BASE_INPUT, {
			maxIterations: 3,
		});
		expect(result).toEqual({ outcome: "incomplete" });
		expect(llm.chat).toHaveBeenCalledTimes(3);
	});

	it("returns agent_error when report_error is called", async () => {
		const llm = scriptLlm([
			[
				{
					name: "report_error",
					arguments: {
						message: "Repository not accessible",
						code: "repo_not_found",
					},
				},
			],
		]);
		const { generateIssue } = await import("../llm/llm");
		const result = await generateIssue(llm, mockGitHub(), BASE_INPUT);
		expect(result).toEqual({
			outcome: "agent_error",
			message: "Repository not accessible",
			code: "repo_not_found",
		});
	});

	it("feeds tool failures back to the model and allows recovery", async () => {
		const gh = mockGitHub();
		(gh.getFileContent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("404 Not Found"),
		);
		const llm = scriptLlm([
			[{ name: "read_file", arguments: { path: "missing.ts" } }],
			[
				{
					name: "submit_issue",
					arguments: { title: "Bug", body: "desc" },
				},
			],
		]);
		const onDebug = vi.fn();
		const { generateIssue } = await import("../llm/llm");
		const result = await generateIssue(llm, gh, BASE_INPUT, { onDebug });
		expect(result.outcome).toBe("issue");
		expect(onDebug).toHaveBeenCalledWith(
			"tool error",
			expect.objectContaining({ tool: "read_file", error: "404 Not Found" }),
		);
		const firstChat = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];
		const toolMessages = (firstChat?.messages ?? []).filter(
			(m: { role?: string }) => m.role === "tool",
		);
		expect(JSON.stringify(toolMessages)).toContain("404 Not Found");
	});

	it("returns incomplete when the agent timeout elapses", async () => {
		const llm: LlmClient = {
			chat: vi.fn(async () => {
				await new Promise((resolve) => setTimeout(resolve, 30));
				return {
					toolCalls: [{ name: "list_files", arguments: {} }],
					content: null,
				};
			}),
		};
		const onDebug = vi.fn();
		const { generateIssue } = await import("../llm/llm");
		const result = await generateIssue(llm, mockGitHub(), BASE_INPUT, {
			timeoutMs: 5,
			onDebug,
		});
		expect(result).toEqual({ outcome: "incomplete" });
		expect(onDebug).toHaveBeenCalledWith(
			"agent timeout",
			expect.objectContaining({ timeoutMs: 5 }),
		);
	});

	it("throws when LLM client errors", async () => {
		const llm: LlmClient = {
			chat: vi.fn(async () => {
				throw new Error("boom");
			}),
		};
		const { generateIssue } = await import("../llm/llm");
		await expect(generateIssue(llm, mockGitHub(), BASE_INPUT)).rejects.toThrow(
			"boom",
		);
	});

	it("includes the requester and description in the system prompt", async () => {
		const llm = scriptLlm([
			[{ name: "submit_issue", arguments: { title: "t", body: "b" } }],
		]);
		const { generateIssue } = await import("../llm/llm");
		await generateIssue(llm, mockGitHub(), BASE_INPUT);
		expect(llm.chat).toHaveBeenCalled();
		const firstCall = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
		const systemText = JSON.stringify(firstCall?.messages ?? []);
		expect(systemText).toContain("Alice");
		expect(systemText).toContain("please create an issue for the bug in login");
	});

	it("calls onDebug with LLM responses and tool dispatches", async () => {
		const llm = scriptLlm([
			[{ name: "list_files", arguments: {} }],
			[
				{
					name: "submit_issue",
					arguments: { title: "Bug", body: "desc", labels: ["bug"] },
				},
			],
		]);
		const onDebug = vi.fn();
		const { generateIssue } = await import("../llm/llm");
		await generateIssue(llm, mockGitHub(), BASE_INPUT, { onDebug });

		const calls = onDebug.mock.calls.map(([msg]) => msg);
		expect(calls).toContain("generateIssue started");
		expect(calls).toContain("llm response");
		expect(calls).toContain("tool dispatched");
		expect(calls).toContain("submit_issue called");

		const dispatchCall = onDebug.mock.calls.find(
			([msg]) => msg === "tool dispatched",
		);
		expect(dispatchCall?.[1]).toMatchObject({ tool: "list_files" });
	});

	it("calls onDebug when no tool calls are returned", async () => {
		const llm = scriptLlm([[]]);
		const onDebug = vi.fn();
		const { generateIssue } = await import("../llm/llm");
		await generateIssue(llm, mockGitHub(), BASE_INPUT, { onDebug });
		expect(onDebug).toHaveBeenCalledWith(
			"no tool calls, ending loop",
			expect.objectContaining({ iteration: 0 }),
		);
	});

	it("calls onDebug when max iterations are reached", async () => {
		const llm: LlmClient = {
			chat: vi.fn(async () => ({
				toolCalls: [{ name: "list_files", arguments: {} }],
				content: null,
			})),
		};
		const onDebug = vi.fn();
		const { generateIssue } = await import("../llm/llm");
		await generateIssue(llm, mockGitHub(), BASE_INPUT, {
			maxIterations: 2,
			onDebug,
		});
		expect(onDebug).toHaveBeenCalledWith(
			"max iterations reached",
			expect.objectContaining({ maxIterations: 2 }),
		);
	});

	it("includes context fields in the user message", async () => {
		const llm = scriptLlm([
			[{ name: "submit_issue", arguments: { title: "t", body: "b" } }],
		]);
		const { generateIssue } = await import("../llm/llm");
		await generateIssue(llm, mockGitHub(), {
			...BASE_INPUT,
			context: {
				urlAtual: "https://app.example.com/page",
				categoria: "bug",
				contextoSessao: "user logged in",
				logsConsole: "Error: something",
				logsRede: "GET /api 500",
				screenshot: "data:image/png;base64,...",
				metadata: { ticketId: "42" },
			},
		});
		const firstCall = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
		const systemText = JSON.stringify(firstCall?.messages ?? []);
		expect(systemText).toContain("https://app.example.com/page");
		expect(systemText).toContain("bug");
		expect(systemText).toContain("user logged in");
		expect(systemText).toContain("Error: something");
		expect(systemText).toContain("GET /api 500");
		expect(systemText).toContain("data:image/png;base64,...");
		expect(systemText).toContain("Metadata:");
		expect(systemText).toContain("ticketId");
	});

	it("handles toolCalls being undefined in response", async () => {
		const llm: LlmClient = {
			chat: vi.fn(async () => ({
				toolCalls: undefined as unknown as ToolCall[],
				content: null,
			})),
		};
		const { generateIssue } = await import("../llm/llm");
		const result = await generateIssue(llm, mockGitHub(), BASE_INPUT, {
			maxIterations: 1,
		});
		expect(result).toEqual({ outcome: "incomplete" });
	});

	it("calls onDebug with full tool result content", async () => {
		const longContent = "x".repeat(600);
		const gh = mockGitHub();
		(gh.getFileContent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			longContent,
		);
		const llm = scriptLlm([
			[{ name: "read_file", arguments: { path: "big.ts" } }],
			[
				{
					name: "submit_issue",
					arguments: { title: "Bug", body: "desc" },
				},
			],
		]);
		const onDebug = vi.fn();
		const { generateIssue } = await import("../llm/llm");
		await generateIssue(llm, gh, BASE_INPUT, { onDebug });

		const resultCall = onDebug.mock.calls.find(
			([msg]) => msg === "tool result",
		);
		expect(resultCall?.[1]).toMatchObject({
			tool: "read_file",
			result: longContent,
		});
	});
});
