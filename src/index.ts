import { env } from "./env.js";
import { createGitHubClient } from "./github.js";
import { createOpenAiLlmClient } from "./openai.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
	const server = buildServer({
		github: createGitHubClient(env.GITHUB_TOKEN),
		llm: createOpenAiLlmClient({
			baseUrl: env.LLM_BASE_URL,
			apiKey: env.LLM_API_KEY,
			model: env.LLM_MODEL,
		}),
		webhookSecret: env.WEBHOOK_SECRET,
		triggerPrefix: env.TRIGGER_PREFIX,
		logger: { level: env.LOG_LEVEL },
	});

	try {
		await server.listen({ port: env.PORT, host: "0.0.0.0" });
		server.log.info({ port: env.PORT }, "webhook server listening");
	} catch (error) {
		server.log.error({ err: error }, "failed to start server");
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
