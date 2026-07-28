import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CountsCards } from "./CountsCards";
import { ModeToggle } from "./components/mode-toggle";
import { LogsPanel } from "./LogsPanel";
import { QueueTable } from "./QueueTable";
import { RunDialog } from "./RunDialog";
import { mergeLogRows } from "./mergeLogs";
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
		llmModel?: string;
	}>("/app/events/queue");

	const logs = useSse<{ logs?: LlmLogRow[] }>("/app/events/llm-logs");

	const [allLogs, setAllLogs] = useState<LlmLogRow[]>([]);
	const [selectedRequestId, setSelectedRequestId] = useState<number | null>(
		null,
	);

	useEffect(() => {
		const incoming = logs.data?.logs;
		if (!incoming || incoming.length === 0) return;
		setAllLogs((prev) => mergeLogRows(prev, incoming));
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

	const llmModel = queue.data?.llmModel;
	const isLive = queue.connected && logs.connected;

	return (
		<main className="mx-auto max-w-5xl p-4">
			<header className="mb-4 flex items-center justify-between gap-3 border-b pb-3">
				<div className="flex min-w-0 flex-wrap items-center gap-3">
					<h1 className="text-lg font-semibold">Fila de solicitações</h1>
					{llmModel ? (
						<Badge
							variant="outline"
							className="max-w-full gap-1.5"
							title="Modelo LLM configurado"
						>
							<span className="font-semibold text-foreground">LLM</span>
							<code className="truncate font-mono text-primary">
								{llmModel}
							</code>
						</Badge>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					<div className="flex items-center gap-1.5 text-sm text-muted-foreground">
						<span
							className={cn(
								"size-2 rounded-full",
								isLive
									? "bg-green-500 shadow-[0_0_0_3px] shadow-green-500/15"
									: "bg-yellow-500",
							)}
							aria-hidden
						/>
						{isLive ? "ao vivo" : "reconectando…"}
					</div>
					<ModeToggle />
				</div>
			</header>

			<CountsCards counts={counts} />

			<Card className="mb-4">
				<CardHeader>
					<CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
						Solicitações
					</CardTitle>
				</CardHeader>
				<CardContent>
					<QueueTable
						rows={queueRows}
						onSelect={(r) => setSelectedRequestId(r.requestId)}
					/>
				</CardContent>
			</Card>

			<Card className="mb-4">
				<CardHeader>
					<CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
						Logs do agente LLM
					</CardTitle>
				</CardHeader>
				<CardContent className="pt-0">
					<LogsPanel logs={allLogs} />
				</CardContent>
			</Card>

			{selectedRequestId !== null && (
				<RunDialog
					requestId={selectedRequestId}
					onClose={() => setSelectedRequestId(null)}
				/>
			)}
		</main>
	);
}
