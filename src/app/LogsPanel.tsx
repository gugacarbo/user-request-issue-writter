import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LlmLogRow } from "./types";

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

export function LogsPanel({
	logs,
	className,
}: {
	logs: LlmLogRow[];
	className?: string;
}) {
	const capped = useMemo(() => logs.slice(-300), [logs]);

	return (
		<ScrollArea className={className ?? "h-[360px]"}>
			<ol className="m-0 list-none p-2 font-mono text-xs leading-relaxed">
				{capped.map((l) => (
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
						<span className="shrink-0">{l.event}</span>
						<span className="truncate text-muted-foreground">
							{summarizeData(l.data)}
						</span>
					</li>
				))}
			</ol>
		</ScrollArea>
	);
}
