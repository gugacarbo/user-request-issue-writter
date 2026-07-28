import type { GitHubClient } from "../github/github";
import { agentIssueBodyInstructions } from "../issue/template";
import {
	dispatchTool,
	type IssueProposal,
	toolSchemas,
} from "./tools";

export type ToolCall = {
	readonly name: string;
	readonly arguments: Record<string, unknown>;
};

type ChatMessage =
	| { readonly role: "system"; readonly content: string }
	| { readonly role: "user"; readonly content: string }
	| {
			readonly role: "assistant";
			readonly content: string | null;
			readonly tool_calls?: ToolCall[];
	  }
	| {
			readonly role: "tool";
			readonly content: string;
			readonly tool_call_id: string;
	  };

export type ChatRequest = {
	readonly model?: string;
	readonly messages: ChatMessage[];
	readonly tools?: typeof toolSchemas;
};

export type ChatResponse = {
	readonly toolCalls: ToolCall[];
	readonly content: string | null;
	readonly finishReason?: string | null;
	readonly usage?: {
		readonly promptTokens: number;
		readonly completionTokens: number;
		readonly totalTokens: number;
	};
};

export type LlmClient = {
	readonly chat: (request: ChatRequest) => Promise<ChatResponse>;
};

export type IssueContext = {
	readonly urlAtual?: string;
	readonly categoria?: string;
	readonly contextoSessao?: string;
	readonly logsConsole?: string;
	readonly logsRede?: string;
	readonly screenshot?: string;
	readonly metadata?: Record<string, unknown>;
};

export type GenerateIssueInput = {
	readonly owner: string;
	readonly repo: string;
	readonly requesterName: string;
	readonly requesterEmail: string;
	readonly descricao: string;
	readonly context?: IssueContext;
};

export type GenerateIssueResult =
	| { readonly outcome: "issue"; readonly proposal: IssueProposal }
	| {
			readonly outcome: "agent_error";
			readonly message: string;
			readonly code?: string;
	  }
	| { readonly outcome: "incomplete" };

export type GenerateIssueOptions = {
	readonly maxIterations?: number;
	readonly onDebug?: DebugLog;
	/** Wall-clock cap for the whole agent loop (ms). */
	readonly timeoutMs?: number;
};

type DebugLog = (message: string, data?: Record<string, unknown>) => void;

const DEFAULT_MAX_ITERATIONS = 200;

const SYSTEM_PROMPT = [
	"You are a software engineer that analyzes a repository via tools and drafts a GitHub issue from a user-submitted ticket.",
	"Use the tools to understand the repository context before submitting.",
	"When a tool returns an error, read the message, adjust your arguments, and retry.",
	"Call submit_issue exactly once when ready to finalize the issue successfully.",
	"Call report_error when you cannot complete the task; it stops the agent immediately.",
	agentIssueBodyInstructions(),
].join(" ");

function buildUserMessage(input: GenerateIssueInput): string {
	const lines = [
		`Repository: ${input.owner}/${input.repo}`,
		`Requester: ${input.requesterName} (${input.requesterEmail})`,
		`Description: ${input.descricao}`,
	];
	const c = input.context;
	if (c) {
		if (c.urlAtual) lines.push(`Current URL: ${c.urlAtual}`);
		if (c.categoria) lines.push(`Category: ${c.categoria}`);
		if (c.contextoSessao) lines.push(`Session context: ${c.contextoSessao}`);
		if (c.logsConsole) lines.push(`Console logs:\n${c.logsConsole}`);
		if (c.logsRede) lines.push(`Network logs:\n${c.logsRede}`);
		if (c.screenshot) lines.push(`Screenshot: ${c.screenshot}`);
		if (c.metadata) {
			lines.push(`Metadata:\n${JSON.stringify(c.metadata, null, 2)}`);
		}
	}
	lines.push(
		"",
		"Draft a well-structured GitHub issue based on this ticket.",
		agentIssueBodyInstructions(),
		"Call submit_issue with the title, body (Markdown), and optional labels when done.",
		"Call report_error if you cannot complete the task.",
	);
	return lines.join("\n");
}

function formatToolError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return [
		`Tool execution failed: ${message}`,
		"Fix the arguments and retry, or call report_error if the task cannot be completed.",
	].join("\n");
}

export async function generateIssue(
	llm: LlmClient,
	github: GitHubClient,
	input: GenerateIssueInput,
	options: GenerateIssueOptions = {},
): Promise<GenerateIssueResult> {
	const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
	const debug = options.onDebug;
	const startedAt = Date.now();
	const messages: ChatMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: buildUserMessage(input) },
	];

	debug?.("generateIssue started", {
		owner: input.owner,
		repo: input.repo,
		requester: input.requesterName,
	});

	for (let iteration = 0; iteration < maxIterations; iteration += 1) {
		if (isTimedOut(startedAt, options.timeoutMs)) {
			debug?.("agent timeout", {
				iteration,
				timeoutMs: options.timeoutMs,
				elapsedMs: Date.now() - startedAt,
			});
			return { outcome: "incomplete" };
		}

		const response = await llm.chat({
			messages,
			tools: toolSchemas,
		});
		const toolCalls = response.toolCalls ?? [];

		debug?.("llm response", {
			iteration,
			toolCalls: toolCalls.map((t) => t.name),
			content: response.content,
			finishReason: response.finishReason ?? null,
			usage: response.usage ?? null,
		});

		if (toolCalls.length === 0) {
			debug?.("no tool calls, ending loop", { iteration });
			return { outcome: "incomplete" };
		}

		messages.push({
			role: "assistant",
			content: response.content,
			tool_calls: toolCalls,
		});

		for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex += 1) {
			const call = toolCalls[toolIndex];
			debug?.("tool dispatched", {
				iteration,
				toolIndex,
				tool: call.name,
				arguments: call.arguments,
			});

			let toolContent: string;
			try {
				const result = await dispatchTool(
					call.name,
					call.arguments,
					github,
					input.owner,
					input.repo,
				);

				if (result.isTerminal) {
					if (result.kind === "submit_issue") {
						debug?.("submit_issue called", {
							iteration,
							toolIndex,
							title: result.issue.title,
							body: result.issue.body,
							labels: result.issue.labels,
						});
						return { outcome: "issue", proposal: result.issue };
					}

					debug?.("report_error called", {
						iteration,
						toolIndex,
						message: result.error.message,
						code: result.error.code ?? null,
					});
					return {
						outcome: "agent_error",
						message: result.error.message,
						code: result.error.code,
					};
				}

				toolContent = result.content;
				debug?.("tool result", {
					iteration,
					toolIndex,
					tool: call.name,
					result: toolContent,
				});
			} catch (error) {
				toolContent = formatToolError(error);
				debug?.("tool error", {
					iteration,
					toolIndex,
					tool: call.name,
					error: error instanceof Error ? error.message : String(error),
				});
			}

			messages.push({
				role: "tool",
				content: toolContent,
				tool_call_id: callNameId(call.name, iteration, toolIndex),
			});
		}
	}

	debug?.("max iterations reached", { maxIterations });
	return { outcome: "incomplete" };
}

function isTimedOut(startedAt: number, timeoutMs?: number): boolean {
	if (!timeoutMs || timeoutMs <= 0) return false;
	return Date.now() - startedAt >= timeoutMs;
}

function callNameId(
	name: string,
	iteration: number,
	toolIndex: number,
): string {
	return `${name}-${iteration}-${toolIndex}`;
}
