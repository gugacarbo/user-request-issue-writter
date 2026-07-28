import { MessageList } from "@agent-elements/message-list";
import { ToolRenderer as DefaultToolRenderer } from "@agent-elements/tools/tool-renderer";
import { type ComponentProps, useMemo } from "react";
import {
	GetRepoInfoToolPart,
	ListFilesToolPart,
	ReadFileToolPart,
} from "./issueToolRenderers";
import { llmLogsToUIMessages } from "./llmLogsToChat";
import type { LlmLogRow } from "./types";

function SubmitIssueFromPart({
	part,
}: {
	part: {
		input?: unknown;
		output?: unknown;
		state?: string;
	};
}) {
	const input = (part.input ?? {}) as Record<string, unknown>;
	const output = (part.output ?? {}) as Record<string, unknown>;
	const title =
		typeof input.title === "string"
			? input.title
			: typeof output.title === "string"
				? output.title
				: "Rascunho da issue";
	const body =
		typeof input.body === "string"
			? input.body
			: typeof output.body === "string"
				? output.body
				: undefined;
	const labels = Array.isArray(input.labels)
		? input.labels.filter((l) => typeof l === "string")
		: Array.isArray(output.labels)
			? output.labels.filter((l) => typeof l === "string")
			: [];
	const isPending =
		part.state !== "output-available" && part.state !== "output-error";

	return (
		<div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
			<p className="font-medium">
				{isPending ? "Enviando rascunho da issue…" : "Rascunho da issue enviado"}
			</p>
			<p className="mt-1 font-medium text-foreground">{title}</p>
			{labels.length > 0 ? (
				<p className="mt-1 text-xs text-muted-foreground">
					Labels: {labels.join(", ")}
				</p>
			) : null}
			{body ? (
				<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">
					{body}
				</pre>
			) : null}
		</div>
	);
}

function LogsToolRenderer(props: ComponentProps<typeof DefaultToolRenderer>) {
	const partType = props.part?.type as string | undefined;
	if (partType === "tool-submit_issue") {
		return <SubmitIssueFromPart part={props.part} />;
	}
	if (partType === "tool-list_files") {
		return <ListFilesToolPart part={props.part} />;
	}
	if (partType === "tool-read_file") {
		return <ReadFileToolPart part={props.part} />;
	}
	if (partType === "tool-get_repo_info") {
		return <GetRepoInfoToolPart part={props.part} />;
	}
	return <DefaultToolRenderer {...props} />;
}

export function LogsChatPanel({
	logs,
	className,
}: {
	logs: LlmLogRow[];
	className?: string;
}) {
	const messages = useMemo(() => llmLogsToUIMessages(logs), [logs]);

	if (messages.length === 0) {
		return (
			<p className="py-6 text-center text-sm text-muted-foreground">
				Nenhum log de agente para exibir.
			</p>
		);
	}

	return (
		<div className={className ?? "h-[360px]"} data-slot="agent-logs-chat">
			<MessageList
				messages={messages}
				status="ready"
				initialScrollBehavior="top"
				enableImagePreview={false}
				showCopyToolbar
				slots={{ ToolRenderer: LogsToolRenderer }}
				className="h-full min-h-0"
			/>
		</div>
	);
}
