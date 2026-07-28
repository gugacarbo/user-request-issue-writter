import { ListIcon, MessagesSquareIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { LogsChatPanel } from "./LogsChatPanel";
import type { LlmLogRow } from "./types";

type LogsView = "list" | "chat";

const EVENT_LABELS: Record<string, string> = {
	"generateIssue started": "início",
	"llm response": "resposta LLM",
	"tool dispatched": "tool chamada",
	"tool result": "resultado tool",
	"tool error": "erro na tool",
	"submit_issue called": "issue enviada",
	"report_error called": "erro reportado",
	"agent timeout": "timeout do agente",
	"no tool calls, ending loop": "sem tools",
	"max iterations reached": "limite de iterações",
};

function formatEvent(event: string): string {
	return EVENT_LABELS[event] ?? event;
}

function formatTime(unixSeconds: number): string {
	if (!unixSeconds) return "—";
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleTimeString();
}

function summarizeData(data: Record<string, unknown> | null): string {
	if (!data) return "";
	const keys = Object.keys(data);
	if (keys.length === 0) return "";
	const previewKeys = [
		"tool",
		"title",
		"result",
		"content",
		"toolCalls",
		"arguments",
	];
	for (const k of previewKeys) {
		const v = data[k];
		if (v === undefined) continue;
		const s = typeof v === "string" ? v : JSON.stringify(v);
		return `${k}: ${s.length > 120 ? `${s.slice(0, 120)}…` : s}`;
	}
	const first = keys[0] as keyof typeof data;
	const v = data[first];
	const s = typeof v === "string" ? v : JSON.stringify(v);
	return `${String(first)}: ${s.length > 120 ? `${s.slice(0, 120)}…` : s}`;
}

function LogsListView({
	logs,
	className,
}: {
	logs: LlmLogRow[];
	className?: string;
}) {
	return (
		<ScrollArea className={className ?? "h-[360px]"}>
			<ol className="m-0 list-none p-2 font-mono text-xs leading-relaxed">
				{logs.map((l) => (
					<li key={l.id} className="flex gap-2 px-2 py-0.5 hover:bg-muted/50">
						<span className="shrink-0 text-muted-foreground">
							{formatTime(l.createdAt)}
						</span>
						<span className="shrink-0 text-blue-600 dark:text-blue-400">
							#{l.requestId}
						</span>
						{l.iteration !== null && (
							<span className="shrink-0 text-yellow-600 dark:text-yellow-400">
								it{l.iteration}
							</span>
						)}
						{l.toolName && (
							<span className="shrink-0 text-green-600 dark:text-green-400">
								{l.toolName}
							</span>
						)}
						<span className="shrink-0">{formatEvent(l.event)}</span>
						<span className="truncate text-muted-foreground">
							{summarizeData(l.data)}
						</span>
					</li>
				))}
			</ol>
		</ScrollArea>
	);
}

export function LogsPanel({
	logs,
	className,
	showViewToggle = true,
}: {
	logs: LlmLogRow[];
	className?: string;
	showViewToggle?: boolean;
}) {
	const [view, setView] = useState<LogsView>("chat");
	const capped = useMemo(() => logs.slice(-300), [logs]);
	const panelHeight = className ?? "h-[360px]";

	return (
		<div className="space-y-2">
			{showViewToggle ? (
				<div className="flex justify-end gap-1">
					<Button
						type="button"
						variant={view === "list" ? "secondary" : "ghost"}
						size="sm"
						onClick={() => setView("list")}
					>
						<ListIcon className="size-3.5" />
						Lista
					</Button>
					<Button
						type="button"
						variant={view === "chat" ? "secondary" : "ghost"}
						size="sm"
						onClick={() => setView("chat")}
					>
						<MessagesSquareIcon className="size-3.5" />
						Chat
					</Button>
				</div>
			) : null}

			<div className={cn(panelHeight, "min-h-0")}>
				{view === "list" ? (
					<LogsListView logs={capped} className={panelHeight} />
				) : (
					<LogsChatPanel logs={capped} className={panelHeight} />
				)}
			</div>
		</div>
	);
}
