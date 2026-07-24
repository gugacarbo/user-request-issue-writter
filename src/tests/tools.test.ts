import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/github";

function mockGitHub(overrides: Partial<GitHubClient> = {}): GitHubClient {
	return {
		getRepoTree: vi.fn(async () => ["src/index.ts"]),
		getFileContent: vi.fn(async () => "export const x = 1;"),
		getRepoInfo: vi.fn(async () => ({
			description: "demo",
			languages: { TypeScript: 1 },
			readme: "# demo",
		})),
		createIssue: vi.fn(async () => ({ number: 1, url: "https://example/1" })),
		...overrides,
	};
}

describe("tools", () => {
	it("exports JSON schemas for all tools", async () => {
		const { toolSchemas } = await import("../llm/tools");
		const names = toolSchemas.map((t) => t.function.name);
		expect(names).toEqual([
			"list_files",
			"read_file",
			"get_repo_info",
			"submit_issue",
		]);
		expect(toolSchemas[0].function.parameters.type).toBe("object");
	});

	it("list_files dispatcher calls github.getRepoTree", async () => {
		const gh = mockGitHub();
		const { dispatchTool } = await import("../llm/tools");
		const result = await dispatchTool(
			"list_files",
			{ path: "" },
			gh,
			"owner",
			"repo",
		);
		expect(gh.getRepoTree).toHaveBeenCalledWith("owner", "repo");
		expect(result.isTerminal).toBe(false);
		expect(result.isTerminal === false && result.content).toContain(
			"src/index.ts",
		);
	});

	it("read_file dispatcher calls github.getFileContent", async () => {
		const gh = mockGitHub();
		const { dispatchTool } = await import("../llm/tools");
		const result = await dispatchTool(
			"read_file",
			{ path: "src/index.ts" },
			gh,
			"owner",
			"repo",
		);
		expect(gh.getFileContent).toHaveBeenCalledWith(
			"owner",
			"repo",
			"src/index.ts",
		);
		expect(result.isTerminal === false && result.content).toContain(
			"export const x",
		);
	});

	it("get_repo_info dispatcher calls github.getRepoInfo", async () => {
		const gh = mockGitHub();
		const { dispatchTool } = await import("../llm/tools");
		const result = await dispatchTool("get_repo_info", {}, gh, "owner", "repo");
		expect(gh.getRepoInfo).toHaveBeenCalledWith("owner", "repo");
		expect(result.isTerminal).toBe(false);
		expect(result.isTerminal === false && result.content).toContain("demo");
		expect(result.isTerminal === false && result.content).toContain(
			"TypeScript",
		);
	});

	it("submit_issue is terminal: does not call github and returns structured args", async () => {
		const gh = mockGitHub();
		const { dispatchTool } = await import("../llm/tools");
		const proposal = { title: "Bug", body: "desc", labels: ["bug"] };
		const result = await dispatchTool(
			"submit_issue",
			proposal,
			gh,
			"owner",
			"repo",
		);
		expect(gh.createIssue).not.toHaveBeenCalled();
		expect(result).toEqual({ isTerminal: true, issue: proposal });
	});

	it("dispatchTool throws on unknown tool name", async () => {
		const gh = mockGitHub();
		const { dispatchTool } = await import("../llm/tools");
		await expect(dispatchTool("nope", {}, gh, "owner", "repo")).rejects.toThrow(
			/unknown tool/i,
		);
	});

	it("get_repo_info handles missing description", async () => {
		const gh = mockGitHub({
			getRepoInfo: vi.fn(async () => ({
				description: null,
				languages: { TypeScript: 1 },
				readme: "# demo",
			})),
		});
		const { dispatchTool } = await import("../llm/tools");
		const result = await dispatchTool("get_repo_info", {}, gh, "owner", "repo");
		expect(result.isTerminal).toBe(false);
		expect(result.isTerminal === false && result.content).toContain(
			"Description: (none)",
		);
	});

	it("get_repo_info handles missing readme", async () => {
		const gh = mockGitHub({
			getRepoInfo: vi.fn(async () => ({
				description: "demo",
				languages: { TypeScript: 1 },
				readme: null,
			})),
		});
		const { dispatchTool } = await import("../llm/tools");
		const result = await dispatchTool("get_repo_info", {}, gh, "owner", "repo");
		expect(result.isTerminal).toBe(false);
		expect(result.isTerminal === false && result.content).toContain(
			"README: (none)",
		);
	});

	it("get_repo_info handles empty languages", async () => {
		const gh = mockGitHub({
			getRepoInfo: vi.fn(async () => ({
				description: "demo",
				languages: {},
				readme: "# demo",
			})),
		});
		const { dispatchTool } = await import("../llm/tools");
		const result = await dispatchTool("get_repo_info", {}, gh, "owner", "repo");
		expect(result.isTerminal).toBe(false);
		expect(result.isTerminal === false && result.content).toContain(
			"Languages: ",
		);
	});

	it("submit_issue handles missing labels", async () => {
		const gh = mockGitHub();
		const { dispatchTool } = await import("../llm/tools");
		const result = await dispatchTool(
			"submit_issue",
			{ title: "Bug", body: "desc" },
			gh,
			"owner",
			"repo",
		);
		expect(result).toEqual({
			isTerminal: true,
			issue: { title: "Bug", body: "desc", labels: undefined },
		});
	});

	it("submit_issue handles non-array labels", async () => {
		const gh = mockGitHub();
		const { dispatchTool } = await import("../llm/tools");
		const result = await dispatchTool(
			"submit_issue",
			{ title: "Bug", body: "desc", labels: "not-an-array" },
			gh,
			"owner",
			"repo",
		);
		expect(result).toEqual({
			isTerminal: true,
			issue: { title: "Bug", body: "desc", labels: undefined },
		});
	});
});
