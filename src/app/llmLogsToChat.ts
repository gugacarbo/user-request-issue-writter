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
	return `tool-${toolName}` as ToolPartType;
}

export function toolCallId(
	toolName: string,
	iteration: number | null,
	toolIndex = 0,
): string {
	return `${toolName}-${iteration ?? 0}-${toolIndex}`;
}

function toolIndexFromLog(data: Record<string, unknown> | null): number {
	const value = data?.toolIndex;
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function mapToolInput(
	args: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return args ?? {};
}

export function mapToolOutput(toolName: string, result: unknown): unknown {
	if (typeof result !== "string") return result;
	switch (toolName) {
		case "list_files": {
			const files = result
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
			return { files, numFiles: files.length, text: result };
		}
		case "read_file": {
			const lines = result.split("\n");
			return { content: result, lineCount: lines.length };
		}
		case "get_repo_info":
			return { text: result };
		default:
			return { text: result };
	}
}

function resolveToolCallId(
	log: LlmLogRow,
	toolName: string,
	tools: Map<string, ToolPart>,
): string {
	const iteration = log.iteration;
	const toolIndex = toolIndexFromLog(log.data);
	const id = toolCallId(toolName, iteration, toolIndex);
	if (tools.has(id)) return id;

	// Back-compat: logs written before toolIndex used name-iteration only.
	const legacyId = `${toolName}-${iteration ?? 0}`;
	if (tools.has(legacyId)) return legacyId;

	const prefix = `${toolName}-${iteration ?? 0}-`;
	for (const [key, part] of tools) {
		if (key.startsWith(prefix) && part.state !== "output-available") {
			return key;
		}
	}
	return id;
}

function formatStartedMessage(data: Record<string, unknown> | null): string {
	if (!data) return "Analisando solicitação…";
	const owner = data.owner;
	const repo = data.repo;
	const requester = data.requester;
	const parts: string[] = ["### Analisando solicitação"];
	if (typeof owner === "string" && typeof repo === "string") {
		parts.push(`**Repositório:** \`${owner}/${repo}\``);
	}
	if (typeof requester === "string") {
		parts.push(`**Solicitante:** ${requester}`);
	}
	return parts.join("\n\n");
}

function formatLlmMeta(data: Record<string, unknown> | null): string | null {
	if (!data) return null;
	const lines: string[] = [];
	const finishReason = data.finishReason;
	if (typeof finishReason === "string" && finishReason) {
		lines.push(`finish_reason: \`${finishReason}\``);
	}
	const usage = data.usage;
	if (usage && typeof usage === "object") {
		const u = usage as Record<string, unknown>;
		const prompt = u.promptTokens;
		const completion = u.completionTokens;
		const total = u.totalTokens;
		if (
			typeof prompt === "number" &&
			typeof completion === "number" &&
			typeof total === "number"
		) {
			lines.push(
				`tokens: ${total} (prompt ${prompt}, completion ${completion})`,
			);
		}
	}
	return lines.length > 0 ? lines.join(" · ") : null;
}

function markerText(
	event: string,
	data: Record<string, unknown> | null,
): string {
	const labels: Record<string, string> = {
		"no tool calls, ending loop": "Agente encerrou sem chamar ferramentas",
		"max iterations reached": "Limite de iterações atingido",
		"agent timeout": "Tempo máximo do agente excedido",
		"tool error": "Erro na tool",
		"report_error called": "Agente reportou erro",
	};
	const label = labels[event] ?? event;
	const detail = summarizeMarkerData(data);
	return detail ? `**${label}** — ${detail}` : `**${label}**`;
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

function lastAssistantMessage(
	messages: UIMessage[],
): (UIMessage & { parts: unknown[] }) | null {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message?.role === "assistant") {
			return message as UIMessage & { parts: unknown[] };
		}
	}
	return null;
}

function appendAssistantPart(messages: UIMessage[], part: unknown): void {
	const last = lastAssistantMessage(messages);
	if (last) {
		last.parts.push(part);
		return;
	}
	messages.push(uiMessage(`assistant-tool-${messages.length}`, "assistant", [part]));
}

function appendAssistantParts(messages: UIMessage[], parts: unknown[]): void {
	if (parts.length === 0) return;
	const last = lastAssistantMessage(messages);
	if (last) {
		last.parts.push(...parts);
		return;
	}
	messages.push(
		uiMessage(`assistant-tools-${messages.length}`, "assistant", parts),
	);
}

/**
 * Replays persisted `llm_logs` rows as AI SDK `UIMessage`s for Agent UI
 * (`MessageList`). Pairs tool dispatches/results with the matching LLM turn.
 */
export function llmLogsToUIMessages(logs: LlmLogRow[]): UIMessage[] {
	const messages: UIMessage[] = [];
	const tools = new Map<string, ToolPart>();
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
			tools.clear();
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
				const content = log.data?.content;
				const hasContent =
					typeof content === "string" && content.trim().length > 0;
				const toolCalls = log.data?.toolCalls;
				const toolNames = Array.isArray(toolCalls)
					? toolCalls.filter((name): name is string => typeof name === "string")
					: [];
				const toolParts: ToolPart[] = toolNames.map((name, i) => {
					const id = toolCallId(name, log.iteration, i);
					const part: ToolPart = {
						type: toolPartType(name),
						toolCallId: id,
						state: "input-available",
						input: {},
					};
					tools.set(id, part);
					return part;
				});

				if (!hasContent && toolParts.length > 0 && lastAssistantMessage(messages)) {
					appendAssistantParts(messages, toolParts);
					break;
				}

				const parts: Array<{ type: "text"; text: string } | ToolPart> = [];
				if (hasContent) {
					if (log.iteration !== null) {
						parts.push({
							type: "text",
							text: `**Turno ${log.iteration + 1}**`,
						});
					}
					parts.push({ type: "text", text: content.trim() });
					const meta = formatLlmMeta(log.data);
					if (meta) {
						parts.push({ type: "text", text: meta });
					}
				}
				parts.push(...toolParts);

				if (parts.length > 0) {
					messages.push(uiMessage(`assistant-${log.id}`, "assistant", parts));
				}
				break;
			}

			case "tool dispatched": {
				const toolName = log.toolName ?? String(log.data?.tool ?? "");
				if (!toolName) break;
				const id = resolveToolCallId(log, toolName, tools);
				const args =
					log.data?.arguments && typeof log.data.arguments === "object"
						? (log.data.arguments as Record<string, unknown>)
						: undefined;
				const existing = tools.get(id);
				if (existing) {
					existing.input = mapToolInput(args);
					existing.state = "input-available";
				} else {
					const part: ToolPart = {
						type: toolPartType(toolName),
						toolCallId: id,
						state: "input-available",
						input: mapToolInput(args),
					};
					tools.set(id, part);
					appendAssistantPart(messages, part);
				}
				break;
			}

			case "tool result": {
				const toolName = log.toolName ?? String(log.data?.tool ?? "");
				if (!toolName) break;
				const id = resolveToolCallId(log, toolName, tools);
				const part = tools.get(id);
				const output = mapToolOutput(toolName, log.data?.result);
				if (part) {
					part.output = output;
					part.state = "output-available";
				} else {
					messages.push(
						uiMessage(`tool-result-${log.id}`, "assistant", [
							{
								type: toolPartType(toolName),
								toolCallId: id,
								state: "output-available",
								input: {},
								output,
							},
						]),
					);
				}
				break;
			}

			case "submit_issue called": {
				const title =
					typeof log.data?.title === "string" ? log.data.title : "Issue";
				const body =
					typeof log.data?.body === "string" ? log.data.body : undefined;
				const labels = Array.isArray(log.data?.labels)
					? log.data.labels.filter((l) => typeof l === "string")
					: [];
				const id = resolveToolCallId(log, "submit_issue", tools);
				const part = tools.get(id);
				const output = {
					title,
					body,
					labels,
					message: "Rascunho da issue enviado",
				};
				if (part) {
					part.input = { title, labels, ...(body ? { body } : {}) };
					part.output = output;
					part.state = "output-available";
				} else {
					const created: ToolPart = {
						type: "tool-submit_issue",
						toolCallId: id,
						state: "output-available",
						input: { title, labels, ...(body ? { body } : {}) },
						output,
					};
					tools.set(id, created);
					messages.push(
						uiMessage(`submit-${log.id}`, "assistant", [created]),
					);
				}
				break;
			}

			case "report_error called": {
				const message =
					typeof log.data?.message === "string"
						? log.data.message
						: "Erro reportado pelo agente";
				const code =
					typeof log.data?.code === "string" ? log.data.code : undefined;
				const id = resolveToolCallId(log, "report_error", tools);
				const part = tools.get(id);
				const output = { message, code, text: message };
				if (part) {
					part.input = { message, ...(code ? { code } : {}) };
					part.output = output;
					part.state = "output-available";
				} else {
					const created: ToolPart = {
						type: "tool-report_error",
						toolCallId: id,
						state: "output-available",
						input: { message, ...(code ? { code } : {}) },
						output,
					};
					tools.set(id, created);
					messages.push(
						uiMessage(`report-error-${log.id}`, "assistant", [created]),
					);
				}
				break;
			}

			case "tool error": {
				const toolName = log.toolName ?? String(log.data?.tool ?? "");
				if (!toolName) break;
				const id = resolveToolCallId(log, toolName, tools);
				const error =
					typeof log.data?.error === "string"
						? log.data.error
						: "Falha ao executar tool";
				const part = tools.get(id);
				const output = { error, text: error };
				if (part) {
					part.output = output;
					part.state = "output-error";
				} else {
					messages.push(
						uiMessage(`tool-error-${log.id}`, "assistant", [
							{
								type: toolPartType(toolName),
								toolCallId: id,
								state: "output-error",
								input: {},
								output,
							},
						]),
					);
				}
				break;
			}

			case "agent timeout":
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
