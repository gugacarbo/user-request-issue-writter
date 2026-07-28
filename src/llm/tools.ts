import type { GitHubClient } from "../github/github";
import { agentIssueBodyInstructions } from "../issue/template";

export type IssueProposal = {
	readonly title: string;
	readonly body: string;
	readonly labels?: string[];
};

export type AgentErrorReport = {
	readonly message: string;
	readonly code?: string;
};

export type ToolDispatcherResult =
	| { readonly isTerminal: false; readonly content: string }
	| {
			readonly isTerminal: true;
			readonly kind: "submit_issue";
			readonly issue: IssueProposal;
	  }
	| {
			readonly isTerminal: true;
			readonly kind: "report_error";
			readonly error: AgentErrorReport;
	  };

type JsonSchemaProperty = {
	readonly type: string;
	readonly description?: string;
	readonly items?: { readonly type: string };
};

type FunctionSchema = {
	readonly type: "function";
	readonly function: {
		readonly name: string;
		readonly description: string;
		readonly parameters: {
			readonly type: "object";
			readonly properties: Record<string, JsonSchemaProperty>;
			readonly required?: string[];
		};
	};
};

export const toolSchemas: FunctionSchema[] = [
	{
		type: "function",
		function: {
			name: "list_files",
			description:
				"List the top-level files and directories of the repository.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Optional subpath to list (unused; lists repo root).",
					},
				},
			},
		},
	},
	{
		type: "function",
		function: {
			name: "read_file",
			description:
				"Read the content of a file in the repository. Large files are truncated.",
			parameters: {
				type: "object",
				properties: {
					path: {
						type: "string",
						description: "Repository-relative file path.",
					},
				},
				required: ["path"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "get_repo_info",
			description: "Get repository description, languages, and README.",
			parameters: { type: "object", properties: {} },
		},
	},
	{
		type: "function",
		function: {
			name: "submit_issue",
			description: `Submit the drafted issue and finish successfully. Terminal tool: stops the agent after submission. Does not create the issue directly; the host creates it. ${agentIssueBodyInstructions()}`,
			parameters: {
				type: "object",
				properties: {
					title: { type: "string", description: "Issue title." },
					body: {
						type: "string",
						description:
							"Issue body in Markdown (analysis sections only; host injects raw user message).",
					},
					labels: {
						type: "array",
						items: { type: "string" },
						description: "Optional labels to apply.",
					},
				},
				required: ["title", "body"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "report_error",
			description:
				"Report that the issue cannot be drafted and stop the agent. Terminal tool: use when the repository is inaccessible, the ticket lacks enough information, or repeated tool failures cannot be resolved.",
			parameters: {
				type: "object",
				properties: {
					message: {
						type: "string",
						description:
							"Human-readable explanation of why the agent could not complete the task.",
					},
					code: {
						type: "string",
						description:
							"Optional short machine-readable code (e.g. repo_not_found, insufficient_context).",
					},
				},
				required: ["message"],
			},
		},
	},
];

export async function dispatchTool(
	name: string,
	args: Record<string, unknown>,
	github: GitHubClient,
	owner: string,
	repo: string,
): Promise<ToolDispatcherResult> {
	switch (name) {
		case "list_files": {
			const tree = await github.getRepoTree(owner, repo);
			return { isTerminal: false, content: tree.join("\n") };
		}
		case "read_file": {
			const path = String(args.path ?? "");
			const content = await github.getFileContent(owner, repo, path);
			return { isTerminal: false, content };
		}
		case "get_repo_info": {
			const info = await github.getRepoInfo(owner, repo);
			const parts = [
				info.description
					? `Description: ${info.description}`
					: "Description: (none)",
				`Languages: ${Object.keys(info.languages).join(", ")}`,
				info.readme ? `README:\n${info.readme}` : "README: (none)",
			];
			return { isTerminal: false, content: parts.join("\n\n") };
		}
		case "submit_issue": {
			const issue: IssueProposal = {
				title: String(args.title ?? ""),
				body: String(args.body ?? ""),
				labels: Array.isArray(args.labels)
					? (args.labels as string[])
					: undefined,
			};
			return { isTerminal: true, kind: "submit_issue", issue };
		}
		case "report_error": {
			const message = String(args.message ?? "").trim();
			const code =
				typeof args.code === "string" && args.code.trim()
					? args.code.trim()
					: undefined;
			return {
				isTerminal: true,
				kind: "report_error",
				error: { message: message || "Agent reported an error.", code },
			};
		}
		default:
			throw new Error(`unknown tool: ${name}`);
	}
}
