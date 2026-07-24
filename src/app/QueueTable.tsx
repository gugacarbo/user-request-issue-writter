import { StatusBadge } from "./StatusBadge";
import type { QueueSummaryRow } from "./types";

function formatTime(unixSeconds: number): string {
	if (!unixSeconds) return "—";
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleTimeString();
}

export function QueueTable({ rows }: { rows: QueueSummaryRow[] }) {
	if (rows.length === 0) {
		return <p className="empty">Nenhuma solicitação na fila ainda.</p>;
	}
	return (
		<table className="queue-table">
			<thead>
				<tr>
					<th>#</th>
					<th>repo</th>
					<th>requester</th>
					<th>status</th>
					<th>attempts</th>
					<th>issue</th>
					<th>erro</th>
					<th>updated</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((r) => (
					<tr key={r.id}>
						<td>{r.requestId}</td>
						<td>{r.repo ?? "—"}</td>
						<td>{r.requesterName ?? "—"}</td>
						<td>
							<StatusBadge status={r.status} />
						</td>
						<td>{r.attempts}</td>
						<td>
							{r.issueNumber ? (
								<a href={r.issueUrl ?? "#"} target="_blank" rel="noreferrer">
									#{r.issueNumber}
								</a>
							) : (
								"—"
							)}
						</td>
						<td className="err" title={r.lastError ?? ""}>
							{r.lastError ? "ver" : "—"}
						</td>
						<td>{formatTime(r.updatedAt)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
