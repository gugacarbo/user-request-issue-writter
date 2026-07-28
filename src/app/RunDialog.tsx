import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
	const [retrying, setRetrying] = useState(false);
	const [retryError, setRetryError] = useState<string | null>(null);

	const loadRun = useCallback(async () => {
		const res = await fetch(`/app/api/requests/${requestId}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as RunDetail;
	}, [requestId]);

	useEffect(() => {
		let alive = true;
		setRun(null);
		setError(null);
		setRetryError(null);
		loadRun()
			.then((data) => {
				if (alive) setRun(data);
			})
			.catch((e: unknown) => {
				if (alive) setError(e instanceof Error ? e.message : String(e));
			});
		return () => {
			alive = false;
		};
	}, [loadRun]);

	const handleRetry = async () => {
		setRetrying(true);
		setRetryError(null);
		try {
			const res = await fetch(`/app/api/requests/${requestId}/retry`, {
				method: "POST",
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				throw new Error(body?.error ?? `HTTP ${res.status}`);
			}
			const data = (await res.json()) as { run?: RunDetail };
			if (data.run) setRun(data.run);
			else setRun(await loadRun());
		} catch (e: unknown) {
			setRetryError(e instanceof Error ? e.message : String(e));
		} finally {
			setRetrying(false);
		}
	};

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
							<RunSummary
								run={run}
								retrying={retrying}
								retryError={retryError}
								onRetry={handleRetry}
							/>
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

function RunSummary({
	run,
	retrying,
	retryError,
	onRetry,
}: {
	run: RunDetail;
	retrying: boolean;
	retryError: string | null;
	onRetry: () => void;
}) {
	const { request, queue } = run;
	const canRetry = request.status === "failed";
	return (
		<div className="flex flex-col gap-4">
			{canRetry ? (
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-muted-foreground">
						Esta execução falhou. Você pode disparar uma nova tentativa manual.
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={retrying}
						onClick={onRetry}
					>
						{retrying ? "Reenfileirando…" : "Tentar novamente"}
					</Button>
				</div>
			) : null}
			{retryError ? (
				<p className="text-sm text-destructive">Erro ao reenfileirar: {retryError}</p>
			) : null}
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
		</div>
	);
}
