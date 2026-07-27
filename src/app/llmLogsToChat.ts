import type { UIMessage } from "ai";
import type { LlmLogRow } from "./types";

function uiMessage(
	id: string,
	role: UIMessage["role"],
	parts: unknown[],
): UIMessage {
	return { id, role, parts } as UIMessage;
}

type ToolPartType = `tool-${string}`;

type ToolPart = {
	type: ToolPartType;
	toolCallId: string;
	state: "input-available" | "output-available" | "output-error";
	input?: Record<string, unknown>;
	output?: unknown;
};

function toolPartType(toolName: string): ToolPartType {
	switch (toolName) {
		case "read_file":
			return "tool-Read";
		case "list_files":
			return "tool-Glob";
		default:
			return `tool-${toolName}`;
	}
}

function toolCallId(toolName: string, iteration: number | null): string {
	return `${toolName}-${iteration ?? 0}`;
}

function mapToolInput(
	toolName: string,
	args: Record<string, unknown> | undefined,
): Record<string, unknown> {
	const input = args ?? {};
	if (toolName === "read_file" && typeof input.path === "string") {
		return { file_path: input.path };
	}
	if (toolName === "list_files") {
		return { pattern: "*", ...input };
	}
	return input;
}

function formatStartedMessage(data: Record<string, unknown> | null): string {
	if (!data) return "Analisando solicitação…";
	const owner = data.owner;
	const repo = data.repo;
	const requester = data.requester;
	const parts: string[] = ["Analisando solicitação"];
	if (typeof owner === "string" && typeof repo === "string") {
		parts.push(`**Repositório:** ${owner}/${repo}`);
	}
	if (typeof requester === "string") {
		parts.push(`**Solicitante:** ${requester}`);
	}
	return parts.join("\n\n");
}

function markerText(
	event: string,
	data: Record<string, unknown> | null,
): string {
	const detail = summarizeMarkerData(data);
	return detail ? `**${event}** — ${detail}` : `**${event}**`;
}

function summarizeMarkerData(data: Record<string, unknown> | null): string {
	if (!data) return "";
	const keys = Object.keys(data);
	if (keys.length === 0) return "";
	const preview = keys
		.slice(0, 3)
		.map((k) => {
			const v = data[k];
			const s = typeof v === "string" ? v : JSON.stringify(v);
			return `${k}: ${s.length > 80 ? `${s.slice(0, 80)}…` : s}`;
		})
		.join("; ");
	return preview;
}

/**
 * Replays persisted `llm_logs` rows as AI SDK `UIMessage`s for Agent UI
 * (`MessageList`). Pairs tool dispatches/results with the matching LLM turn.
 */
export function llmLogsToUIMessages(logs: LlmLogRow[]): UIMessage[] {
	const messages: UIMessage[] = [];
	const toolParts = new Map<string, ToolPart>();
	let lastRequestId: number | null = null;

	for (const log of logs) {
		if (lastRequestId !== null && log.requestId !== lastRequestId) {
			messages.push(
				uiMessage(`divider-${log.id}`, "assistant", [
					{
						type: "text",
						text: `--- Solicitação #${log.requestId} ---`,
					},
				]),
			);
		}
		lastRequestId = log.requestId;

		switch (log.event) {
			case "generateIssue started":
				messages.push(
					uiMessage(`user-${log.id}`, "user", [
						{
							type: "text",
							text: formatStartedMessage(log.data),
						},
					]),
				);
				break;

			case "llm response": {
				const parts: Array<{ type: "text"; text: string } | ToolPart> = [];
				const content = log.data?.content;
				if (typeof content === "string" && content.trim()) {
					parts.push({ type: "text", text: content });
				}

				const toolCalls = log.data?.toolCalls;
				if (Array.isArray(toolCalls)) {
					for (const name of toolCalls) {
						if (typeof name !== "string") continue;
						const id = toolCallId(name, log.iteration);
						const part: ToolPart = {
							type: toolPartType(name),
							toolCallId: id,
							state: "input-available",
							input: {},
						};
						toolParts.set(id, part);
						parts.push(part);
					}
				}

				if (parts.length > 0) {
					messages.push(uiMessage(`assistant-${log.id}`, "assistant", parts));
				}
				break;
			}

			case "tool dispatched": {
				const toolName = log.toolName ?? String(log.data?.tool ?? "");
				if (!toolName) break;
				const id = toolCallId(toolName, log.iteration);
				const existing = toolParts.get(id);
				const args =
					log.data?.arguments && typeof log.data.arguments === "object"
						? (log.data.arguments as Record<string, unknown>)
						: undefined;
				if (existing) {
					existing.input = mapToolInput(toolName, args);
					existing.state = "input-available";
				} else {
					const part: ToolPart = {
						type: toolPartType(toolName),
						toolCallId: id,
						state: "input-available",
						input: mapToolInput(toolName, args),
					};
					toolParts.set(id, part);
					messages.push(
						uiMessage(`tool-dispatch-${log.id}`, "assistant", [part]),
					);
				}
				break;
			}

			case "tool result": {
				const toolName = log.toolName ?? String(log.data?.tool ?? "");
				if (!toolName) break;
				const id = toolCallId(toolName, log.iteration);
				const part = toolParts.get(id);
				if (part) {
					part.output = log.data?.result;
					part.state = "output-available";
				} else {
					messages.push(
						uiMessage(`tool-result-${log.id}`, "assistant", [
							{
								type: toolPartType(toolName),
								toolCallId: id,
								state: "output-available",
								input: mapToolInput(toolName, undefined),
								output: log.data?.result,
							},
						]),
					);
				}
				break;
			}

			case "submit_issue called": {
				const title =
					typeof log.data?.title === "string" ? log.data.title : "Issue";
				const labels = Array.isArray(log.data?.labels)
					? log.data.labels.filter((l) => typeof l === "string")
					: [];
				const id = toolCallId("submit_issue", log.iteration);
				const part: ToolPart = {
					type: "tool-submit_issue",
					toolCallId: id,
					state: "output-available",
					input: {
						title,
						labels,
					},
					output: "Issue draft submitted",
				};
				toolParts.set(id, part);
				messages.push(uiMessage(`submit-${log.id}`, "assistant", [part]));
				break;
			}

			case "no tool calls, ending loop":
			case "max iterations reached":
				messages.push(
					uiMessage(`marker-${log.id}`, "assistant", [
						{
							type: "text",
							text: markerText(log.event, log.data),
						},
					]),
				);
				break;

			default:
				if (log.toolName) break;
				messages.push(
					uiMessage(`event-${log.id}`, "assistant", [
						{
							type: "text",
							text: markerText(log.event, log.data),
						},
					]),
				);
		}
	}

	return messages;
}
