import type { GitHubClient } from "./github.js";
import { dispatchTool, type IssueProposal, toolSchemas } from "./tools.js";

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
	readonly model: string;
	readonly messages: ChatMessage[];
	readonly tools?: typeof toolSchemas;
};

export type ChatResponse = {
	readonly toolCalls: ToolCall[];
	readonly content: string | null;
};

export type LlmClient = {
	readonly chat: (request: ChatRequest) => Promise<ChatResponse>;
};

export type GenerateIssueInput = {
	readonly owner: string;
	readonly repo: string;
	readonly commentBody: string;
	readonly commentUser: string;
	readonly issue: {
		readonly number: number;
		readonly title: string;
		readonly body: string;
	};
	readonly commentUrl: string;
};

export type GenerateIssueOptions = {
	readonly maxIterations?: number;
	readonly onDebug?: DebugLog;
};

type DebugLog = (message: string, data?: Record<string, unknown>) => void;

const DEFAULT_MAX_ITERATIONS = 15;

const SYSTEM_PROMPT =
	"You are a software engineer that analyzes a repository via tools and drafts a GitHub issue from a user comment. Use the tools to understand the repository context before submitting. Always call submit_issue exactly once when ready to finalize the issue.";

function buildUserMessage(input: GenerateIssueInput): string {
	return [
		`Repository: ${input.owner}/${input.repo}`,
		`Comment author: ${input.commentUser}`,
		`Comment URL: ${input.commentUrl}`,
		`Original issue #${input.issue.number}: ${input.issue.title}`,
		`Original issue body: ${input.issue.body ?? "(empty)"}`,
		`User comment: ${input.commentBody}`,
		"",
		"Draft a well-structured GitHub issue based on this comment. Call submit_issue with the title, body (Markdown), and optional labels.",
	].join("\n");
}

export async function generateIssue(
	llm: LlmClient,
	github: GitHubClient,
	input: GenerateIssueInput,
	options: GenerateIssueOptions = {},
): Promise<IssueProposal | null> {
	const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
	const debug = options.onDebug;
	const messages: ChatMessage[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: buildUserMessage(input) },
	];

	debug?.("generateIssue started", {
		owner: input.owner,
		repo: input.repo,
		commentUser: input.commentUser,
	});

	for (let iteration = 0; iteration < maxIterations; iteration += 1) {
		const response = await llm.chat({
			model: "",
			messages,
			tools: toolSchemas,
		});
		const toolCalls = response.toolCalls ?? [];

		debug?.("llm response", {
			iteration,
			toolCalls: toolCalls.map((t) => t.name),
			content: response.content,
		});

		if (toolCalls.length === 0) {
			debug?.("no tool calls, ending loop", { iteration });
			return null;
		}

		messages.push({
			role: "assistant",
			content: response.content,
			tool_calls: toolCalls,
		});

		for (const call of toolCalls) {
			debug?.("tool dispatched", {
				iteration,
				tool: call.name,
				arguments: call.arguments,
			});

			const result = await dispatchTool(
				call.name,
				call.arguments,
				github,
				input.owner,
				input.repo,
			);

			if (result.isTerminal) {
				debug?.("submit_issue called", {
					title: result.issue.title,
					labels: result.issue.labels,
				});
				return result.issue;
			}

			const preview =
				result.content.length > 500
					? `${result.content.slice(0, 500)}...(truncated)`
					: result.content;

			debug?.("tool result", {
				iteration,
				tool: call.name,
				result: preview,
			});

			messages.push({
				role: "tool",
				content: result.content,
				tool_call_id: callNameId(call.name, iteration),
			});
		}
	}

	debug?.("max iterations reached", { maxIterations });
	return null;
}

function callNameId(name: string, iteration: number): string {
	return `${name}-${iteration}`;
}
