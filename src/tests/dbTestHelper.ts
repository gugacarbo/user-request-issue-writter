import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DB } from "../db";

/**
 * Fresh in-memory SQLite (Drizzle) for tests, with migrations applied so the
 * `requests`/`queue`/`llm_logs` tables exist. Each call yields an ISOLATED
 * database (better-sqlite3 `:memory:` is per-connection; using a temp file is
 * required for drizzle's migrate to work reliably across the in-process
 * schema). Cleanup is the caller's responsibility via the returned `cleanup`.
 */
export type TestDb = { db: DB; cleanup: () => void };

export function makeTestDb(): TestDb {
	const dir = mkdtempSync(join(tmpdir(), "uriw-test-"));
	// Ensure the parent of the db path exists; createDb leaves file creation
	// to better-sqlite3, but the dir must exist.
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "test.db");
	const { db, native } = createDb({ path });
	return {
		db,
		cleanup: () => {
			native.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
