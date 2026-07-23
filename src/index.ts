import { loadEnv } from "./env.js";
import { createGitHubClient } from "./github.js";
import { createOpenAiLlmClient } from "./openai.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
	const env = loadEnv();

	const server = buildServer({
		github: createGitHubClient(env.githubToken),
		llm: createOpenAiLlmClient({
			baseUrl: env.llmBaseUrl,
			apiKey: env.llmApiKey,
			model: env.llmModel,
		}),
		webhookSecret: env.webhookSecret,
		triggerPrefix: env.triggerPrefix,
		logger: { level: env.logLevel },
	});

	try {
		await server.listen({ port: env.port, host: "0.0.0.0" });
		server.log.info({ port: env.port }, "webhook server listening");
	} catch (error) {
		server.log.error({ err: error }, "failed to start server");
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
