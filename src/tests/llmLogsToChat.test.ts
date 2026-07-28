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
			"tool-list_files",
			"tool-read_file",
		]);
		expect(parts[0]?.toolCallId).toBe(toolCallId("list_files", 0, 0));
		expect(parts[1]?.toolCallId).toBe(toolCallId("read_file", 0, 1));
	});

	it("creates separate assistant messages for tool-only turns", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "llm response",
				iteration: 0,
				data: { toolCalls: ["list_files"] },
			}),
			row({
				id: 2,
				event: "llm response",
				iteration: 1,
				data: { toolCalls: ["read_file"] },
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const assistant = messages.filter((m) => m.role === "assistant");
		expect(assistant).toHaveLength(2);
		expect((assistant[0]?.parts as Array<{ type?: string }>).map((p) => p.type)).toEqual([
			"tool-list_files",
		]);
		expect((assistant[1]?.parts as Array<{ type?: string }>).map((p) => p.type)).toEqual([
			"text",
			"tool-read_file",
		]);
	});

	it("shows agent reasoning text before tools in the same LLM turn", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "llm response",
				iteration: 1,
				data: {
					toolCalls: ["list_files"],
					content: "Vou listar o diretório src.",
				},
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const parts = messages[0]?.parts as Array<{ type?: string; text?: string }>;
		expect(parts.map((p) => p.type)).toEqual(["text", "text", "tool-list_files"]);
		expect(parts[1]?.text).toBe("Vou listar o diretório src.");
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

	it("parses read_file and get_repo_info outputs", () => {
		expect(mapToolOutput("read_file", "line")).toEqual({
			content: "line",
			lineCount: 1,
		});
		expect(mapToolOutput("get_repo_info", "Description: demo")).toEqual({
			text: "Description: demo",
		});
	});

	it("wraps unknown tools as text", () => {
		expect(mapToolOutput("custom_tool", "payload")).toEqual({ text: "payload" });
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
		const part = assistant?.parts?.[0] as {
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
		const part = assistant?.parts?.find(
			(p) => (p as { type?: string }).type === "tool-get_repo_info",
		) as {
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

describe("llmLogsToUIMessages report_error and errors", () => {
	it("merges report_error into the existing tool part", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "llm response",
				iteration: 0,
				data: { toolCalls: ["report_error"] },
			}),
			row({
				id: 2,
				event: "report_error called",
				iteration: 0,
				toolName: "report_error",
				data: {
					toolIndex: 0,
					message: "Repo inacessível",
					code: "repo_not_found",
				},
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const assistant = messages.find((m) => m.id === "assistant-1");
		const part = assistant?.parts?.[0] as {
			type?: string;
			state?: string;
			output?: { message?: string };
		};
		expect(part?.type).toBe("tool-report_error");
		expect(part?.state).toBe("output-available");
		expect(part?.output?.message).toBe("Repo inacessível");
	});

	it("renders tool error state on the matching tool part", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "llm response",
				iteration: 0,
				data: { toolCalls: ["read_file"] },
			}),
			row({
				id: 2,
				event: "tool error",
				iteration: 0,
				toolName: "read_file",
				data: { tool: "read_file", toolIndex: 0, error: "404 Not Found" },
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		const part = messages[0]?.parts?.[0] as {
			state?: string;
			output?: { error?: string };
		};
		expect(part?.state).toBe("output-error");
		expect(part?.output?.error).toBe("404 Not Found");
	});

	it("renders agent timeout and marker events", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "agent timeout",
				data: { timeoutMs: 1000, elapsedMs: 1200 },
			}),
			row({
				id: 2,
				event: "no tool calls, ending loop",
				iteration: 3,
				data: {},
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		expect(messages).toHaveLength(2);
		expect((messages[0]?.parts?.[0] as { text: string }).text).toContain(
			"Tempo máximo",
		);
		expect((messages[1]?.parts?.[0] as { text: string }).text).toContain(
			"sem chamar ferramentas",
		);
	});

	it("creates a standalone tool dispatch message when no prior turn exists", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "tool dispatched",
				iteration: 2,
				toolName: "read_file",
				data: {
					tool: "read_file",
					toolIndex: 0,
					arguments: { path: "src/main.ts" },
				},
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		expect(messages[0]?.id).toBe("assistant-tool-0");
		const part = messages[0]?.parts?.[0] as {
			type?: string;
			input?: { path?: string };
		};
		expect(part?.type).toBe("tool-read_file");
		expect(part?.input?.path).toBe("src/main.ts");
	});

	it("creates standalone submit_issue and report_error messages", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "submit_issue called",
				iteration: 0,
				data: { title: "Bug", labels: ["bug"] },
			}),
			row({
				id: 2,
				event: "report_error called",
				data: { message: "Falhou" },
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		expect(messages.map((m) => m.id)).toEqual(["submit-1", "report-error-2"]);
	});

	it("creates standalone tool error message when no prior tool part exists", () => {
		const logs: LlmLogRow[] = [
			row({
				id: 1,
				event: "tool error",
				iteration: 0,
				toolName: "list_files",
				data: { tool: "list_files", toolIndex: 0 },
			}),
		];

		const messages = llmLogsToUIMessages(logs);
		expect(messages[0]?.id).toBe("tool-error-1");
		const part = messages[0]?.parts?.[0] as { state?: string };
		expect(part?.state).toBe("output-error");
	});

	it("renders unknown events without a tool name", () => {
		const logs: LlmLogRow[] = [
			row({ id: 1, event: "custom debug", data: { note: "hello" } }),
		];
		const messages = llmLogsToUIMessages(logs);
		expect((messages[0]?.parts?.[0] as { text: string }).text).toContain(
			"custom debug",
		);
	});
});
