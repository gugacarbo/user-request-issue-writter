import type { LlmLogRow } from "./types";

/** Append-only merge of LLM log rows by primary key (`id`). */
export function mergeLogRows(
	prev: readonly LlmLogRow[],
	incoming: readonly LlmLogRow[],
	max = 1000,
): LlmLogRow[] {
	if (incoming.length === 0) return [...prev];
	const seen = new Set(prev.map((row) => row.id));
	const next = [...prev];
	for (const row of incoming) {
		if (seen.has(row.id)) continue;
		next.push(row);
		seen.add(row.id);
	}
	return next.length > max ? next.slice(-max) : next;
}
