import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./StatusBadge";
import type { QueueSummaryRow } from "./types";

function formatTime(unixSeconds: number): string {
	if (!unixSeconds) return "—";
	const d = new Date(unixSeconds * 1000);
	return d.toLocaleTimeString();
}

export function QueueTable({
	rows,
	onSelect,
}: {
	rows: QueueSummaryRow[];
	onSelect?: (row: QueueSummaryRow) => void;
}) {
	if (rows.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				Nenhuma solicitação na fila ainda.
			</p>
		);
	}
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>#</TableHead>
					<TableHead>repo</TableHead>
					<TableHead>requester</TableHead>
					<TableHead>status</TableHead>
					<TableHead>attempts</TableHead>
					<TableHead>issue</TableHead>
					<TableHead>erro</TableHead>
					<TableHead>updated</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.map((r) => (
					<TableRow
						key={r.id}
						className={onSelect ? "cursor-pointer" : undefined}
						onClick={
							onSelect
								? (e) => {
										if ((e.target as HTMLElement).closest("a")) return;
										onSelect(r);
									}
								: undefined
						}
					>
						<TableCell>{r.requestId}</TableCell>
						<TableCell>{r.repo ?? "—"}</TableCell>
						<TableCell>{r.requesterName ?? "—"}</TableCell>
						<TableCell>
							<StatusBadge status={r.status} />
						</TableCell>
						<TableCell>{r.attempts}</TableCell>
						<TableCell>
							{r.issueNumber ? (
								<a
									href={r.issueUrl ?? "#"}
									target="_blank"
									rel="noreferrer"
									className="text-primary hover:underline"
								>
									#{r.issueNumber}
								</a>
							) : (
								"—"
							)}
						</TableCell>
						<TableCell className="text-destructive" title={r.lastError ?? ""}>
							{r.lastError ? "ver" : "—"}
						</TableCell>
						<TableCell>{formatTime(r.updatedAt)}</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}
