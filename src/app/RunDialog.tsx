import { type ReactNode, useEffect, useState } from "react";
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
 * Closes on Esc, the backdrop, or the close button.
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

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div className="dialog-backdrop">
			<button
				type="button"
				className="dialog-backdrop-btn"
				aria-label="Fechar"
				onClick={onClose}
			/>
			<div
				className="dialog"
				role="dialog"
				aria-modal="true"
				aria-label={`Execução #${requestId}`}
			>
				<header className="dialog-header">
					<h2>Execução #{requestId}</h2>
					<button type="button" className="dialog-close" onClick={onClose}>
						✕
					</button>
				</header>

				<nav className="tabs">
					<button
						type="button"
						className={`tab ${tab === "summary" ? "active" : ""}`}
						onClick={() => setTab("summary")}
					>
						Resumo
					</button>
					<button
						type="button"
						className={`tab ${tab === "logs" ? "active" : ""}`}
						onClick={() => setTab("logs")}
					>
						Logs do agente
					</button>
				</nav>

				<div className="dialog-body">
					{error ? (
						<p className="empty">Erro ao carregar: {error}</p>
					) : !run ? (
						<p className="empty">Carregando…</p>
					) : tab === "summary" ? (
						<RunSummary run={run} />
					) : run.logs.length === 0 ? (
						<p className="empty">Nenhum log de agente para esta execução.</p>
					) : (
						<div className="logs-wrap">
							<LogsPanel logs={run.logs} />
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="kv">
			<span className="kv-label">{label}</span>
			<span className="kv-value">{children}</span>
		</div>
	);
}

function RunSummary({ run }: { run: RunDetail }) {
	const { request, queue } = run;
	return (
		<div className="kv-grid">
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
					<a href={request.issueUrl ?? "#"} target="_blank" rel="noreferrer">
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
					<code className="err-text">{request.lastError}</code>
				) : (
					"—"
				)}
			</Row>
		</div>
	);
}
