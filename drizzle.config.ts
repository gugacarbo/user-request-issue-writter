import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration. Migrations are GENERATED from the TS schema
 * (ADR-0007 — migrations only via the ORM, never hand-written).
 *
 * Generate a new migration after changing src/db/schema.ts:
 *   pnpm db:generate
 *
 * The generated SQL lives in ./migrations and is applied:
 *   - in dev/boot via createDb({ runMigrations: true }) (see src/db/index.ts)
 *   - on demand: pnpm db:migrate
 */
export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./migrations",
	dialect: "sqlite",
	dbCredentials: {
		url: process.env.DATABASE_PATH ?? "./data/app.db",
	},
});
