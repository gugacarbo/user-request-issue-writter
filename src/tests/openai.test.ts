import { afterEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => ({
	default: class {
		chat = { completions: { create: createMock } };
	},
}));

describe("openai client", () => {
	afterEach(() => {
		createMock.mockReset();
	});

	it("creates an LlmClient that calls the OpenAI SDK", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: "hello",
						tool_calls: [],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(response.content).toBe("hello");
		expect(response.toolCalls).toEqual([]);
		expect(createMock).toHaveBeenCalled();
	});

	it("parses tool calls from the completion response", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								type: "function",
								function: {
									name: "list_files",
									arguments: JSON.stringify({ path: "src" }),
								},
							},
						],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "list files" }],
		});
		expect(response.toolCalls).toEqual([
			{ name: "list_files", arguments: { path: "src" } },
		]);
	});

	it("skips tool calls with non-function type", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								type: "retrieval",
								function: {
									name: "search",
									arguments: JSON.stringify({ q: "test" }),
								},
							},
							{
								type: "function",
								function: {
									name: "list_files",
									arguments: JSON.stringify({}),
								},
							},
						],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "search" }],
		});
		expect(response.toolCalls).toEqual([
			{ name: "list_files", arguments: {} },
		]);
	});

	it("skips tool calls with empty function name", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								type: "function",
								function: {
									name: "",
									arguments: JSON.stringify({}),
								},
							},
							{
								type: "function",
								function: {
									name: "list_files",
									arguments: JSON.stringify({}),
								},
							},
						],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(response.toolCalls).toEqual([
			{ name: "list_files", arguments: {} },
		]);
	});

	it("handles malformed JSON in tool call arguments gracefully", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								type: "function",
								function: {
									name: "submit_issue",
									arguments: "not-json",
								},
							},
						],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "submit" }],
		});
		expect(response.toolCalls).toEqual([
			{ name: "submit_issue", arguments: {} },
		]);
	});

	it("uses the model from options when request.model is empty", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: "ok",
						tool_calls: [],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4o",
		});
		await client.chat({
			model: "",
			messages: [{ role: "user", content: "hi" }],
		});
		const callArgs = createMock.mock.calls[0]?.[0];
		expect(callArgs.model).toBe("gpt-4o");
	});

	it("converts assistant tool_calls and tool messages to SDK format", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								type: "function",
								function: {
									name: "submit_issue",
									arguments: JSON.stringify({ title: "Bug" }),
								},
							},
						],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		await client.chat({
			model: "gpt-4",
			messages: [
				{ role: "user", content: "create issue" },
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{ name: "list_files", arguments: { path: "src" } },
					],
				},
				{
					role: "tool",
					content: "src/index.ts",
					tool_call_id: "call_0",
				},
			],
		});
		const callArgs = createMock.mock.calls[0]?.[0];
		const messages = callArgs.messages;
		expect(messages).toHaveLength(3);
		expect(messages[1].role).toBe("assistant");
		expect(messages[1].tool_calls).toHaveLength(1);
		expect(messages[1].tool_calls[0].id).toBe("call_0");
		expect(messages[2].role).toBe("tool");
		expect(messages[2].tool_call_id).toBe("call_0");
	});

	it("handles tool message without matching pending id", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: "ok",
						tool_calls: [],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		await client.chat({
			model: "gpt-4",
			messages: [
				{ role: "user", content: "hi" },
				{
					role: "tool",
					content: "result",
					tool_call_id: "orphan",
				},
			],
		});
		const callArgs = createMock.mock.calls[0]?.[0];
		const messages = callArgs.messages;
		expect(messages[1].role).toBe("tool");
		expect(messages[1].tool_call_id).toBe("orphan");
	});

	it("handles empty message array", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: "ok",
						tool_calls: [],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [],
		});
		expect(response.content).toBe("ok");
	});

	it("handles null content in assistant message with tool_calls", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{ name: "list_files", arguments: {} },
					],
				},
			],
		});
		expect(response.content).toBeNull();
	});

	it("handles missing message in choice", async () => {
		createMock.mockResolvedValueOnce({
			choices: [{}],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(response.content).toBeNull();
		expect(response.toolCalls).toEqual([]);
	});

	it("handles empty choices array", async () => {
		createMock.mockResolvedValueOnce({
			choices: [],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(response.content).toBeNull();
		expect(response.toolCalls).toEqual([]);
	});

	it("handles tool call with no arguments field", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								type: "function",
								function: {
									name: "list_files",
								},
							},
						],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const response = await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(response.toolCalls).toEqual([
			{ name: "list_files", arguments: {} },
		]);
	});

	it("passes tools to the SDK call", async () => {
		createMock.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: "ok",
						tool_calls: [],
					},
				},
			],
		});
		const { createOpenAiLlmClient } = await import("../openai");
		const client = createOpenAiLlmClient({
			baseUrl: "https://api.example.com",
			apiKey: "sk-test",
			model: "gpt-4",
		});
		const tools = [{ type: "function" as const, function: { name: "test" } }];
		await client.chat({
			model: "gpt-4",
			messages: [{ role: "user", content: "hi" }],
			tools,
		});
		const callArgs = createMock.mock.calls[0]?.[0];
		expect(callArgs.tools).toBe(tools);
	});
});
