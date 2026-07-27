import { type ReactNode, useEffect, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogsPanel } from "./LogsPanel";
import { StatusBadge } from "./StatusBadge";
import type { RunDetail } from "./types";

function formatTime(unixSeconds: number): string {
	if (!unixSeconds) return "—";
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleString();
}

/**
 * Modal showing the detail of one agent run (ADR-0009 run dialog). Fetches
 * `/app/api/requests/:id` on open and renders two tabs: a summary of the
 * request/queue state, and the ordered agent log lines (replay of the run).
 */
export function RunDialog({
	requestId,
	onClose,
}: {
	requestId: number;
	onClose: () => void;
}) {
	const [run, setRun] = useState<RunDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<"summary" | "logs">("summary");

	useEffect(() => {
		let alive = true;
		setRun(null);
		setError(null);
		fetch(`/app/api/requests/${requestId}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return (await res.json()) as RunDetail;
			})
			.then((data) => {
				if (alive) setRun(data);
			})
			.catch((e: unknown) => {
				if (alive) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			alive = false;
		};
	}, [requestId]);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className="flex max-h-[min(80vh,100%)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
				aria-label={`Execução #${requestId}`}
			>
				<DialogHeader className="border-b px-4 py-3">
					<DialogTitle>Execução #{requestId}</DialogTitle>
				</DialogHeader>

				<Tabs
					value={tab}
					onValueChange={(v) => setTab(v as "summary" | "logs")}
					className="gap-0"
				>
					<TabsList
						variant="line"
						className="w-full justify-start rounded-none border-b px-4"
					>
						<TabsTrigger value="summary">Resumo</TabsTrigger>
						<TabsTrigger value="logs">Logs do agente</TabsTrigger>
					</TabsList>

					<TabsContent value="summary" className="p-4">
						{error ? (
							<p className="text-sm text-muted-foreground">
								Erro ao carregar: {error}
							</p>
						) : !run ? (
							<p className="text-sm text-muted-foreground">Carregando…</p>
						) : (
							<RunSummary run={run} />
						)}
					</TabsContent>

					<TabsContent value="logs" className="p-4">
						{error ? (
							<p className="text-sm text-muted-foreground">
								Erro ao carregar: {error}
							</p>
						) : !run ? (
							<p className="text-sm text-muted-foreground">Carregando…</p>
						) : run.logs.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								Nenhum log de agente para esta execução.
							</p>
						) : (
							<LogsPanel logs={run.logs} className="h-[min(50vh,400px)]" />
						)}
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</span>
			<span className="truncate text-sm">{children}</span>
		</div>
	);
}

function RunSummary({ run }: { run: RunDetail }) {
	const { request, queue } = run;
	return (
		<div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
			<Row label="Status">
				<StatusBadge status={request.status} />
			</Row>
			<Row label="Repo">{request.repo}</Row>
			<Row label="Owner">{request.owner}</Row>
			<Row label="Requester">{request.requesterName}</Row>
			<Row label="Email">{request.requesterEmail}</Row>
			<Row label="Tentativas">{request.attempts}</Row>
			<Row label="Issue">
				{request.issueNumber ? (
					<a
						href={request.issueUrl ?? "#"}
						target="_blank"
						rel="noreferrer"
						className="text-primary hover:underline"
					>
						#{request.issueNumber}
					</a>
				) : (
					"—"
				)}
			</Row>
			<Row label="Delivery">{request.deliveryId ?? "—"}</Row>
			<Row label="Criado em">{formatTime(request.createdAt)}</Row>
			<Row label="Atualizado em">{formatTime(request.updatedAt)}</Row>
			{queue ? (
				<Row label="Próxima execução">{formatTime(queue.nextRunAt)}</Row>
			) : null}
			<Row label="Erro">
				{request.lastError ? (
					<code className="font-mono text-xs text-destructive break-words whitespace-pre-wrap">
						{request.lastError}
					</code>
				) : (
					"—"
				)}
			</Row>
		</div>
	);
}
