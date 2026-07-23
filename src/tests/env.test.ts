import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
};

describe("env", () => {
	let backup: RawEnv;

	beforeEach(() => {
		backup = withEnv({ ...FULL });
		vi.resetModules();
	});

	afterEach(() => {
		restore(backup);
	});

	it("loads a fully provided env as a typed object", async () => {
		const { env } = await import("../env");
		expect(env.PORT).toBe(9090);
		expect(env.WEBHOOK_SECRET).toBe("shh");
		expect(env.GITHUB_TOKEN).toBe("ghp_x");
		expect(env.LLM_BASE_URL).toBe("https://api.openai.com/v1");
		expect(env.LLM_API_KEY).toBe("sk-x");
		expect(env.LLM_MODEL).toBe("gpt-4o-mini");
		expect(env.LOG_LEVEL).toBe("debug");
	});

	it("applies PORT and LOG_LEVEL defaults when omitted", async () => {
		delete process.env.PORT;
		delete process.env.LOG_LEVEL;
		const { env } = await import("../env");
		expect(env.PORT).toBe(8080);
		expect(env.LOG_LEVEL).toBe("info");
	});

	it("throws when WEBHOOK_SECRET is missing", async () => {
		delete process.env.WEBHOOK_SECRET;
		await expect(import("../env")).rejects.toThrow(/WEBHOOK_SECRET/i);
	});

	it("throws when GITHUB_TOKEN is missing", async () => {
		delete process.env.GITHUB_TOKEN;
		await expect(import("../env")).rejects.toThrow(/GITHUB_TOKEN/i);
	});

	it("throws when LLM_API_KEY is missing", async () => {
		delete process.env.LLM_API_KEY;
		await expect(import("../env")).rejects.toThrow(/LLM_API_KEY/i);
	});

	it("throws when PORT is not a number", async () => {
		process.env.PORT = "not-a-port";
		await expect(import("../env")).rejects.toThrow(/PORT/i);
	});
});
