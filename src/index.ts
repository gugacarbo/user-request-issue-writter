import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "./config/env";
import { createDb } from "./db";
import { createGitHubClient } from "./github/github";
import { createOpenAiLlmClient } from "./llm/openai";
import { startWorker, type WorkerHandle } from "./queue/worker";
import { buildServer } from "./web/server";

async function main(): Promise<void> {
	// Ensure the SQLite file's parent dir exists (DATABASE_PATH may point at
	// ./data/app.db which is not created by better-sqlite3 on its own).
	if (env.DATABASE_PATH !== ":memory:") {
		mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
	}

	const { db } = createDb({ path: env.DATABASE_PATH });

	const server = buildServer({
		github: createGitHubClient(env.GITHUB_TOKEN),
		llm: createOpenAiLlmClient({
			baseUrl: env.LLM_BASE_URL,
			apiKey: env.LLM_API_KEY,
			model: env.LLM_MODEL,
		}),
		webhookSecret: env.WEBHOOK_SECRET,
		nocobaseToken: env.NOCOBASE_TOKEN,
		nocobasePublicUrl: env.NOCOBASE_PUBLIC_URL,
		agentTimeoutMs: env.AGENT_TIMEOUT_MS,
		db,
		logger: { level: env.LOG_LEVEL },
		// Serve the built SPA (dist/app) and stream queue/logs over SSE when
		// present (ADR-0009). Missing dir logs a warning, not a boot failure.
		dashboard: { db, serveStatic: true, llmModel: env.LLM_MODEL },
	});

	// Persistent queue worker (ADR-0008): polls the `queue` table for
	// pending items, runs the LLM tool loop with logging to `llm_logs`, and
	// creates the GitHub issue. Same process as the webhook server.
	const worker: WorkerHandle = startWorker({
		db,
		github: createGitHubClient(env.GITHUB_TOKEN),
		llm: createOpenAiLlmClient({
			baseUrl: env.LLM_BASE_URL,
			apiKey: env.LLM_API_KEY,
			model: env.LLM_MODEL,
		}),
		nocobaseToken: env.NOCOBASE_TOKEN,
		nocobasePublicUrl: env.NOCOBASE_PUBLIC_URL,
		maxAttempts: env.WORKER_MAX_ATTEMPTS,
		agentTimeoutMs: env.AGENT_TIMEOUT_MS,
		log: (level, msg, data) => server.log[level]({ data }, msg),
	});

	let shuttingDown = false;
	async function shutdown(signal: string): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		server.log.info({ signal }, "shutting down");
		await worker.stop();
		await server.close();
		process.exit(0);
	}
	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));

	try {
		await server.listen({ port: env.PORT, host: "0.0.0.0" });
		server.log.info({ port: env.PORT }, "webhook server listening");
	} catch (error) {
		server.log.error({ err: error }, "failed to start server");
		await worker.stop();
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
