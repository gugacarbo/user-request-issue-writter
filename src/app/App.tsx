import { useEffect, useMemo, useState } from "react";
import { CountsCards } from "./CountsCards";
import { LogsPanel } from "./LogsPanel";
import { QueueTable } from "./QueueTable";
import type { Counts, LlmLogRow, QueueSummaryRow } from "./types";
import { useSse } from "./useSse";

/**
 * Top-level dashboard (ADR-0009). Two independent SSE streams:
 *  - /app/events/queue  → counts + queue snapshot
 *  - /app/events/llm-logs → agent log lines (append-only)
 *
 * In dev the Vite proxy forwards these to the backend on :8080; in prod the
 * Fastify server serves both the SPA (static) and the SSE endpoints.
 */
export function App() {
	const queue = useSse<{
		counts?: Counts;
		queue?: QueueSummaryRow[];
	}>("/app/events/queue");

	const logs = useSse<{ logs?: LlmLogRow[] }>("/app/events/llm-logs");

	const [allLogs, setAllLogs] = useState<LlmLogRow[]>([]);

	// Append new log lines (dedup by id) to keep a growing buffer the
	// LogsPanel can tail.
	useEffect(() => {
		const incoming = logs.data?.logs;
		if (!incoming || incoming.length === 0) return;
		setAllLogs((prev) => {
			const seen = new Set(prev.map((l) => l.id));
			const next = [...prev];
			for (const l of incoming) {
				if (!seen.has(l.id)) {
					next.push(l);
					seen.add(l.id);
				}
			}
			// Keep the tail bounded.
			return next.slice(-1000);
		});
	}, [logs.data]);

	const counts = useMemo<Counts>(() => {
		const base: Counts = { pending: 0, processing: 0, done: 0, failed: 0 };
		const c = queue.data?.counts;
		if (!c) return base;
		return { ...base, ...c };
	}, [queue.data]);

	const queueRows = useMemo<QueueSummaryRow[]>(
		() => queue.data?.queue ?? [],
		[queue.data],
	);

	return (
		<main className="app">
			<header className="topbar">
				<h1>Fila de solicitações</h1>
				<div className="conn">
					<span
						className={`dot ${queue.connected && logs.connected ? "live" : "down"}`}
						aria-hidden
					/>
					{queue.connected && logs.connected ? "ao vivo" : "reconectando…"}
				</div>
			</header>

			<CountsCards counts={counts} />

			<section className="panel">
				<h2>Solicitações</h2>
				<QueueTable rows={queueRows} />
			</section>

			<section className="panel">
				<h2>Logs do agente LLM</h2>
				<div className="logs-wrap">
					<LogsPanel logs={allLogs} />
				</div>
			</section>
		</main>
	);
}
