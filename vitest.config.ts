import { defineConfig } from "vitest/config";

// Coverage thresholds are global. The dashboard SSE handlers (ADR-0009)
// contain background-timer ticks (`setInterval` bodies + best-effort send
// catch blocks) that cannot be exercised deterministically under
// `server.inject` (the connection stays open / the poll fires after the
// test resolves). Their pure diff logic is extracted into
// `computeQueueTick`/`computeLlmLogsTick` and fully unit-tested; only the
// thin timer plumbing stays uncovered. Keeping the threshold at 80%
// reflects that reality while still guarding regressions everywhere else.
export default defineConfig({
	test: {
		globals: true,
		include: ["src/tests/**/*.test.ts"],
		coverage: {
			provider: "v8",
			thresholds: {
				statements: 80,
				branches: 80,
				functions: 80,
				lines: 80,
			},
		},
	},
});
