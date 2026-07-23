import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../src/github.ts";
import type { LlmClient, ToolCall } from "../src/llm.ts";

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
	commentBody: "please create an issue for the bug in login",
	commentUser: "alice",
	issue: { number: 3, title: "Login fails", body: "it broke" },
	commentUrl: "https://example/comment/3",
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
		const { generateIssue } = await import("../src/llm.ts");
		const proposal = await generateIssue(llm, mockGitHub(), BASE_INPUT);
		expect(proposal.title).toBe("Bug");
		expect(proposal.labels).toEqual(["bug"]);
	});

	it("returns null when the model never calls submit_issue", async () => {
		const llm = scriptLlm([[{ name: "list_files", arguments: {} }]]);
		const { generateIssue } = await import("../src/llm.ts");
		const proposal = await generateIssue(llm, mockGitHub(), BASE_INPUT, {
			maxIterations: 2,
		});
		expect(proposal).toBeNull();
	});

	it("stops at the iteration cap without throwing", async () => {
		const llm: LlmClient = {
			chat: vi.fn(async () => ({
				toolCalls: [{ name: "list_files", arguments: {} }],
				content: null,
			})),
		};
		const { generateIssue } = await import("../src/llm.ts");
		const proposal = await generateIssue(llm, mockGitHub(), BASE_INPUT, {
			maxIterations: 3,
		});
		expect(proposal).toBeNull();
		expect(llm.chat).toHaveBeenCalledTimes(3);
	});

	it("throws when LLM client errors", async () => {
		const llm: LlmClient = {
			chat: vi.fn(async () => {
				throw new Error("boom");
			}),
		};
		const { generateIssue } = await import("../src/llm.ts");
		await expect(generateIssue(llm, mockGitHub(), BASE_INPUT)).rejects.toThrow(
			"boom",
		);
	});

	it("includes the user comment and issue context in the system prompt", async () => {
		const llm = scriptLlm([
			[{ name: "submit_issue", arguments: { title: "t", body: "b" } }],
		]);
		const { generateIssue } = await import("../src/llm.ts");
		await generateIssue(llm, mockGitHub(), BASE_INPUT);
		expect(llm.chat).toHaveBeenCalled();
		const firstCall = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
		const systemText = JSON.stringify(firstCall?.messages ?? []);
		expect(systemText).toContain("alice");
		expect(systemText).toContain("Login fails");
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
		const { generateIssue } = await import("../src/llm.ts");
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
		const { generateIssue } = await import("../src/llm.ts");
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
		const { generateIssue } = await import("../src/llm.ts");
		await generateIssue(llm, mockGitHub(), BASE_INPUT, {
			maxIterations: 2,
			onDebug,
		});
		expect(onDebug).toHaveBeenCalledWith(
			"max iterations reached",
			expect.objectContaining({ maxIterations: 2 }),
		);
	});
});
