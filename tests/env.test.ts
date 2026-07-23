import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env.ts";

type RawEnv = Record<string, string | undefined>;

function withEnv(values: RawEnv): RawEnv {
	const backup: RawEnv = {};
	const keys = new Set<string>();
	for (const k of Object.keys(values)) keys.add(k);
	for (const k of Object.keys(process.env)) keys.add(k);
	for (const k of keys) {
		backup[k] = process.env[k];
		const v = values[k];
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	return backup;
}

function restore(backup: RawEnv): void {
	for (const [k, v] of Object.entries(backup)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
}

const FULL: RawEnv = {
	PORT: "9090",
	WEBHOOK_SECRET: "shh",
	GITHUB_TOKEN: "ghp_x",
	LLM_BASE_URL: "https://api.openai.com/v1",
	LLM_API_KEY: "sk-x",
	LLM_MODEL: "gpt-4o-mini",
	LOG_LEVEL: "debug",
	TRIGGER_PREFIX: "/issue",
};

describe("env", () => {
	let backup: RawEnv;

	beforeEach(() => {
		backup = withEnv({ ...FULL });
	});

	afterEach(() => {
		restore(backup);
	});

	it("loads a fully provided env as a typed object", async () => {
		const { loadEnv } = await import("../src/env.ts");
		const env: Env = loadEnv();
		expect(env.port).toBe(9090);
		expect(env.webhookSecret).toBe("shh");
		expect(env.githubToken).toBe("ghp_x");
		expect(env.llmBaseUrl).toBe("https://api.openai.com/v1");
		expect(env.llmApiKey).toBe("sk-x");
		expect(env.llmModel).toBe("gpt-4o-mini");
		expect(env.logLevel).toBe("debug");
		expect(env.triggerPrefix).toBe("/issue");
	});

	it("applies PORT and LOG_LEVEL defaults when omitted", async () => {
		delete process.env.PORT;
		delete process.env.LOG_LEVEL;
		const { loadEnv } = await import("../src/env.ts");
		const env = loadEnv();
		expect(env.port).toBe(8080);
		expect(env.logLevel).toBe("info");
	});

	it("treats TRIGGER_PREFIX as optional (undefined when empty)", async () => {
		delete process.env.TRIGGER_PREFIX;
		const { loadEnv } = await import("../src/env.ts");
		const env = loadEnv();
		expect(env.triggerPrefix).toBeUndefined();
	});

	it("throws when WEBHOOK_SECRET is missing", async () => {
		delete process.env.WEBHOOK_SECRET;
		const { loadEnv } = await import("../src/env.ts");
		expect(() => loadEnv()).toThrow(/WEBHOOK_SECRET/i);
	});

	it("throws when GITHUB_TOKEN is missing", async () => {
		delete process.env.GITHUB_TOKEN;
		const { loadEnv } = await import("../src/env.ts");
		expect(() => loadEnv()).toThrow(/GITHUB_TOKEN/i);
	});

	it("throws when LLM_API_KEY is missing", async () => {
		delete process.env.LLM_API_KEY;
		const { loadEnv } = await import("../src/env.ts");
		expect(() => loadEnv()).toThrow(/LLM_API_KEY/i);
	});

	it("throws when PORT is not a number", async () => {
		process.env.PORT = "not-a-port";
		const { loadEnv } = await import("../src/env.ts");
		expect(() => loadEnv()).toThrow(/PORT/i);
	});
});
