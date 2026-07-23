export type Env = {
	readonly port: number;
	readonly webhookSecret: string;
	readonly githubToken: string;
	readonly llmBaseUrl: string;
	readonly llmApiKey: string;
	readonly llmModel: string;
	readonly logLevel: string;
	readonly triggerPrefix: string | undefined;
};

class EnvError extends Error {
	constructor(name: string, reason: string) {
		super(`Invalid env ${name}: ${reason}`);
		this.name = "EnvError";
	}
}

function requireString(name: string): string {
	const value = process.env[name];
	if (value === undefined || value.trim() === "") {
		throw new EnvError(name, "missing required value");
	}
	return value.trim();
}

function optionalString(name: string): string | undefined {
	const value = process.env[name];
	if (value === undefined || value.trim() === "") return undefined;
	return value.trim();
}

function requirePort(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim() === "") return fallback;
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
		throw new EnvError(name, `expected a valid port (1-65535), got "${raw}"`);
	}
	return parsed;
}

export function loadEnv(): Env {
	return {
		port: requirePort("PORT", 8080),
		webhookSecret: requireString("WEBHOOK_SECRET"),
		githubToken: requireString("GITHUB_TOKEN"),
		llmBaseUrl: requireString("LLM_BASE_URL"),
		llmApiKey: requireString("LLM_API_KEY"),
		llmModel: requireString("LLM_MODEL"),
		logLevel: optionalString("LOG_LEVEL") ?? "info",
		triggerPrefix: optionalString("TRIGGER_PREFIX"),
	};
}
