import type { RequestStatus } from "./types";

const STYLES: Record<RequestStatus, { label: string; className: string }> = {
	pending: { label: "pending", className: "badge pending" },
	processing: { label: "processing", className: "badge processing" },
	done: { label: "done", className: "badge done" },
	failed: { label: "failed", className: "badge failed" },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
	const s = STYLES[status] ?? {
		label: status,
		className: "badge",
	};
	return <span className={s.className}>{s.label}</span>;
}
