import { useMemo } from "react";
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
	// Prefer compact, useful fields when present.
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

export function LogsPanel({ logs }: { logs: LlmLogRow[] }) {
	// Keep newest at bottom for a tail-like scroll; cap to avoid runaway DOM.
	const capped = useMemo(() => logs.slice(-300), [logs]);

	return (
		<ol className="logs">
			{capped.map((l) => (
				<li key={l.id}>
					<span className="log-time">{formatTime(l.createdAt)}</span>
					<span className="log-req">#{l.requestId}</span>
					{l.iteration !== null && (
						<span className="log-it">it{l.iteration}</span>
					)}
					{l.toolName && <span className="log-tool">{l.toolName}</span>}
					<span className="log-event">{l.event}</span>
					<span className="log-data">{summarizeData(l.data)}</span>
				</li>
			))}
		</ol>
	);
}
