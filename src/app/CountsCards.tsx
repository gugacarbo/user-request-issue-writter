import { Card, CardContent, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Counts, RequestStatus } from "./types";

const ORDER: RequestStatus[] = ["pending", "processing", "done", "failed"];

const VALUE_STYLES: Record<RequestStatus, string> = {
	pending: "text-yellow-600 dark:text-yellow-400",
	processing: "text-blue-600 dark:text-blue-400",
	done: "text-green-600 dark:text-green-400",
	failed: "text-destructive",
};

export function CountsCards({ counts }: { counts: Counts }) {
	return (
		<section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
			{ORDER.map((k) => (
				<Card key={k} size="sm">
					<CardContent className="flex flex-col gap-1">
						<div
							className={cn("text-2xl font-bold tabular-nums", VALUE_STYLES[k])}
						>
							{counts[k] ?? 0}
						</div>
						<CardDescription className="uppercase tracking-wide">
							{k}
						</CardDescription>
					</CardContent>
				</Card>
			))}
		</section>
	);
}
