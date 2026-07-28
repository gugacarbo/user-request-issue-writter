import { MessageList } from "@agent-elements/message-list";
import { ToolRenderer as DefaultToolRenderer } from "@agent-elements/tools/tool-renderer";
import { type ComponentProps, type ComponentType, useMemo } from "react";
import {
	GetRepoInfoToolPart,
	ListFilesToolPart,
	ReadFileToolPart,
	ReportErrorToolPart,
	SubmitIssueToolPart,
	ToolCallsGroup,
} from "./issueToolRenderers";
import { LogsUserMessage } from "./LogsUserMessage";
import { llmLogsToUIMessages } from "./llmLogsToChat";
import type { LlmLogRow } from "./types";

function LogsToolRenderer({
	part,
	nested = false,
	...props
}: ComponentProps<typeof DefaultToolRenderer> & { nested?: boolean }) {
	const partType = part?.type as string | undefined;
	if (partType === "tool-submit_issue") {
		return <SubmitIssueToolPart part={part} nested={nested} />;
	}
	if (partType === "tool-list_files") {
		return <ListFilesToolPart part={part} nested={nested} />;
	}
	if (partType === "tool-read_file") {
		return <ReadFileToolPart part={part} nested={nested} />;
	}
	if (partType === "tool-get_repo_info") {
		return <GetRepoInfoToolPart part={part} nested={nested} />;
	}
	if (partType === "tool-report_error") {
		return <ReportErrorToolPart part={part} nested={nested} />;
	}
	return <DefaultToolRenderer part={part} {...props} />;
}

type LogsToolPart = NonNullable<
	ComponentProps<typeof DefaultToolRenderer>["part"]
>;

type LogsGroupedToolsProps = {
	tools: LogsToolPart[];
	ToolRendererComponent: ComponentType<ComponentProps<typeof DefaultToolRenderer>>;
	chatStatus?: string;
	toolRenderers?: Record<string, ComponentType<unknown>>;
};

function LogsGroupedTools({ tools }: LogsGroupedToolsProps) {
	return (
		<ToolCallsGroup
			tools={tools}
			renderTool={(tool, index) => (
				<LogsToolRenderer
					key={tool.toolCallId ?? `tool-${index}`}
					part={tool}
					nested
				/>
			)}
		/>
	);
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
				initialScrollBehavior="bottom"
				enableImagePreview={false}
				showCopyToolbar={false}
				virtualized
				showTurnDividers
				splitAssistantMessages
				groupConsecutiveTools
				classNames={{
					content: "w-full max-w-none px-2 sm:px-4",
					assistantBubble:
						"w-full max-w-[min(96%,52rem)] rounded-an-message border border-border/60 bg-muted/25 px-3 py-2.5 shadow-sm",
				}}
				slots={{
					UserMessage: LogsUserMessage,
					ToolRenderer: LogsToolRenderer,
					GroupedTools: LogsGroupedTools as NonNullable<
						ComponentProps<typeof MessageList>["slots"]
					>["GroupedTools"],
				}}
				className="h-full min-h-0"
			/>
		</div>
	);
}
