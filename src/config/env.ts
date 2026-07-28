import "dotenv/config";
import { createEnv, type StandardSchemaV1 } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
	server: {
		PORT: z.coerce
			.number()
			.int()
			.min(1)
			.max(65535)
			.default(
				8080,
			) /** Path to the SQLite file (or `:memory:`). See ADR-0007. */,
		DATABASE_PATH: z.string().min(1).default("./data/app.db"),
		WEBHOOK_SECRET: z.string().min(1),
		GITHUB_TOKEN: z.string().min(1),
		LLM_BASE_URL: z.url(),
		LLM_API_KEY: z.string().min(1),
		LLM_MODEL: z.string().min(1),
		LOG_LEVEL: z.string().default("info"),
		/** Max automatic worker attempts before marking a request failed (ADR-0008). */
		WORKER_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
		NOCOBASE_TOKEN: z.string().min(1).optional(),
		NOCOBASE_PUBLIC_URL: z.url().optional(),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
	onValidationError: (issues: readonly StandardSchemaV1.Issue[]) => {
		const details = issues
			.map(
				(issue) =>
					`${issue.path?.join(".") ?? "(root)"}: ${issue.message ?? "invalid"}`,
			)
			.join("; ");
		throw new Error(`Invalid environment variables: ${details}`);
	},
});

export type Env = typeof env;
