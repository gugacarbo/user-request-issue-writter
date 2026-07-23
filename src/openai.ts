import OpenAI from "openai";
import type { ChatRequest, ChatResponse, LlmClient, ToolCall } from "./llm";

type SdkMessage = Parameters<
	OpenAI["chat"]["completions"]["create"]
>[0]["messages"][number];

function toSdkMessages(messages: ChatRequest["messages"]): SdkMessage[] {
	const result: SdkMessage[] = [];
	let pendingIds: string[] = [];
	let counter = 0;

	for (const msg of messages) {
		if (
			msg.role === "assistant" &&
			msg.tool_calls &&
			msg.tool_calls.length > 0
		) {
			pendingIds = msg.tool_calls.map((_, i) => `call_${counter + i}`);
			counter += msg.tool_calls.length;
			result.push({
				role: "assistant",
				content: msg.content ?? "",
				tool_calls: msg.tool_calls.map((tc, i) => ({
					id: pendingIds[i],
					type: "function" as const,
					function: {
						name: tc.name,
						arguments: JSON.stringify(tc.arguments),
					},
				})),
			});
		} else if (msg.role === "tool") {
			const id = pendingIds.shift() ?? msg.tool_call_id;
			result.push({
				role: "tool",
				content: msg.content,
				tool_call_id: id,
			});
		} else {
			result.push(msg as SdkMessage);
		}
	}

	return result;
}

export type OpenAiClientOptions = {
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly model: string;
};

export function createOpenAiLlmClient(options: OpenAiClientOptions): LlmClient {
	const client = new OpenAI({
		baseURL: options.baseUrl,
		apiKey: options.apiKey,
	});

	return {
		async chat(request: ChatRequest): Promise<ChatResponse> {
			const completion = await client.chat.completions.create({
				model: options.model || request.model,
				messages: toSdkMessages(request.messages),
				tools: request.tools,
			});

			const choice = completion.choices[0];
			const message = choice?.message;
			const toolCalls: ToolCall[] = [];

			for (const raw of message?.tool_calls ?? []) {
				if (raw.type !== "function") continue;
				const name = raw.function.name;
				if (!name) continue;
				let args: Record<string, unknown> = {};
				if (raw.function.arguments) {
					try {
						args = JSON.parse(raw.function.arguments) as Record<
							string,
							unknown
						>;
					} catch {
						args = {};
					}
				}
				toolCalls.push({ name, arguments: args });
			}

			return { toolCalls, content: message?.content ?? null };
		},
	};
}
