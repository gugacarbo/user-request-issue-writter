import { describe, expect, it } from "vitest";
import {
	llmLogsToUIMessages,
	mapToolOutput,
	toolCallId,
} from "../app/llmLogsToChat";
import { mergeLogRows } from "../app/mergeLogs";
import type { LlmLogRow } from "../app/types";

function row(
	overrides: Partial<LlmLogRow> & Pick<LlmLogRow, "id" | "event">,
): LlmLogRow {
	return {
		requestId: 1,
		iteration: 0,
		toolName: null,
		data: null,
		createdAt: 1_700_000_000,
		...overrides,
	};
}

describe("llmLogsToUIMessages", () => {
	it("maps domain tools to tool-{name} parts with indexed toolCallId", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "generateIssue started",
				data: { owner: "o", repo: "r" },
			}),
			row({
				id: 2,
				event: "llm response",
				iteration: 0,
				data: { toolCalls: ["list_files", "read_file"] },
			}),
			row({
				id: 3,
				event: "tool dispatched",
				iteration: 0,
				toolName: "list_files",
				data: { tool: "list_files", toolIndex: 0, arguments: {} },
			}),
			row({
				id: 4,
				event: "tool result",
				iteration: 0,
				toolName: "list_files",
				data: { tool: "list_files", toolIndex: 0, result: "src\nREADME.md" },
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const assistant = messages.find((m) => m.id === "assistant-2");
		expect(assistant).toBeDefined();
		const parts = assistant?.parts as Array<{
			type: string;
			toolCallId?: string;
		}>;
		expect(parts.map((p) => p.type)).toEqual([
			"text",
			"tool-list_files",
			"tool-read_file",
		]);
		expect(parts[1]?.toolCallId).toBe(toolCallId("list_files", 0, 0));
		expect(parts[2]?.toolCallId).toBe(toolCallId("read_file", 0, 1));
	});

	it("structures tool results for the issue tool renderers", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "tool result",
				iteration: 1,
				toolName: "read_file",
				data: {
					tool: "read_file",
					toolIndex: 0,
					result: "line one\nline two",
				},
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const part = messages[0]?.parts?.[0] as {
			type: string;
			output?: { content?: string; lineCount?: number };
		};
		expect(part.type).toBe("tool-read_file");
		expect(part.output).toEqual({
			content: "line one\nline two",
			lineCount: 2,
		});
	});

	it("includes LLM metadata in the assistant turn", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "llm response",
				iteration: 2,
				data: {
					toolCalls: [],
					content: "thinking",
					finishReason: "stop",
					usage: {
						promptTokens: 10,
						completionTokens: 5,
						totalTokens: 15,
					},
				},
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const textParts = (messages[0]?.parts ?? [])
			.filter((p) => (p as { type?: string }).type === "text")
			.map((p) => (p as { text: string }).text);
		expect(textParts.some((t) => t.includes("finish_reason"))).toBe(true);
		expect(textParts.some((t) => t.includes("tokens: 15"))).toBe(true);
	});
});

describe("mapToolOutput", () => {
	it("parses list_files output", () => {
		expect(mapToolOutput("list_files", "a\nb")).toEqual({
			files: ["a", "b"],
			numFiles: 2,
			text: "a\nb",
		});
	});
});

describe("mergeLogRows", () => {
	it("deduplicates by id and caps size", () => {
		const base = [row({ id: 1, event: "llm response" })];
		const incoming = [
			row({ id: 1, event: "llm response" }),
			row({ id: 2, event: "tool result", toolName: "read_file" }),
		];
		expect(mergeLogRows(base, incoming)).toHaveLength(2);
	});
});

describe("llmLogsToUIMessages submit_issue", () => {
	it("merges submit_issue into the existing tool part", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "llm response",
				iteration: 0,
				data: { toolCalls: ["submit_issue"] },
			}),
			row({
				id: 2,
				event: "tool dispatched",
				iteration: 0,
				toolName: "submit_issue",
				data: {
					tool: "submit_issue",
					toolIndex: 0,
					arguments: { title: "Bug", body: "details" },
				},
			}),
			row({
				id: 3,
				event: "submit_issue called",
				iteration: 0,
				toolName: "submit_issue",
				data: {
					toolIndex: 0,
					title: "Bug",
					body: "details",
					labels: ["bug"],
				},
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const assistant = messages.find((m) => m.id === "assistant-1");
		const part = assistant?.parts?.[1] as {
			state?: string;
			input?: { title?: string };
			output?: { message?: string };
		};
		expect(part?.state).toBe("output-available");
		expect(part?.input?.title).toBe("Bug");
		expect(part?.output?.message).toBe("Rascunho da issue enviado");
		expect(messages.filter((m) => m.id.startsWith("submit-"))).toHaveLength(0);
	});

	it("supports legacy tool ids without toolIndex", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "llm response",
				iteration: 1,
				data: { toolCalls: ["get_repo_info"] },
			}),
			row({
				id: 2,
				event: "tool result",
				iteration: 1,
				toolName: "get_repo_info",
				data: { tool: "get_repo_info", result: "Description: demo" },
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const assistant = messages.find((m) => m.id === "assistant-1");
		const part = assistant?.parts?.[1] as {
			state?: string;
			output?: { text?: string };
		};
		expect(part?.state).toBe("output-available");
		expect(part?.output?.text).toBe("Description: demo");
	});

	it("inserts a divider when request id changes", () => {
		const logs: LlmLogRow[] = [
			row({ id: 1, requestId: 1, event: "generateIssue started" }),
			row({ id: 2, requestId: 2, event: "generateIssue started" }),
		];
		const messages = llmLogsToUIMessages(logs);
		expect(messages.some((m) => m.id === "divider-2")).toBe(true);
	});
});
