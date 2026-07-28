import { describe, expect, it } from "vitest";
import { mergeLogRows } from "../app/mergeLogs";
import type { LlmLogRow } from "../app/types";

function log(id: number): LlmLogRow {
	return {
		id,
		requestId: 1,
		iteration: null,
		event: "llm response",
		toolName: null,
		data: null,
		createdAt: id,
	};
}

describe("mergeLogRows", () => {
	it("appends only unseen ids preserving order", () => {
		expect(mergeLogRows([log(1)], [log(1), log(2)])).toEqual([log(1), log(2)]);
	});

	it("trims to max length from the tail", () => {
		const prev = [log(1), log(2), log(3)];
		const merged = mergeLogRows(prev, [log(4)], 3);
		expect(merged.map((r) => r.id)).toEqual([2, 3, 4]);
	});
});
