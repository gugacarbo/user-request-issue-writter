import { MessageList } from "@agent-elements/message-list";
import { ToolRenderer as DefaultToolRenderer } from "@agent-elements/tools/tool-renderer";
import type { CustomToolRendererProps } from "@agent-elements/types";
import { type ComponentProps, useMemo } from "react";
import { llmLogsToUIMessages } from "./llmLogsToChat";
import type { LlmLogRow } from "./types";

function SubmitIssueFromPart({
	part,
}: {
	part: {
		input?: unknown;
		state?: string;
	};
}) {
	const input = (part.input ?? {}) as Record<string, unknown>;
	const title = typeof input.title === "string" ? input.title : "Issue draft";
	const labels = Array.isArray(input.labels)
		? input.labels.filter((l) => typeof l === "string")
		: [];
	const isPending =
		part.state !== "output-available" && part.state !== "output-error";

	return (
		<div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
			<p className="font-medium">
				{isPending ? "Submitting issue…" : "Issue draft submitted"}
			</p>
			<p className="mt-1 text-foreground">{title}</p>
			{labels.length > 0 ? (
				<p className="mt-1 text-xs text-muted-foreground">
					Labels: {labels.join(", ")}
				</p>
			) : null}
		</div>
	);
}

function LogsToolRenderer(props: ComponentProps<typeof DefaultToolRenderer>) {
	if (props.part?.type === "tool-submit_issue") {
		return <SubmitIssueFromPart part={props.part} />;
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
