import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RequestStatus } from "./types";

const STYLES: Record<RequestStatus, { label: string; className: string }> = {
	pending: {
		label: "pending",
		className:
			"border-yellow-500/50 text-yellow-600 dark:border-yellow-400/50 dark:text-yellow-400",
	},
	processing: {
		label: "processing",
		className:
			"border-blue-500/50 text-blue-600 dark:border-blue-400/50 dark:text-blue-400",
	},
	done: {
		label: "done",
		className:
			"border-green-500/50 text-green-600 dark:border-green-400/50 dark:text-green-400",
	},
	failed: {
		label: "failed",
		className: "border-destructive/50 text-destructive",
	},
};

export function StatusBadge({ status }: { status: RequestStatus }) {
	const s = STYLES[status] ?? { label: status, className: "" };
	return (
		<Badge variant="outline" className={cn(s.className)}>
			{s.label}
		</Badge>
	);
}
