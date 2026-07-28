import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveReposJsonPath(): string {
	const candidates = [
		join(__dirname, "..", "repos.json"), // dist/index.js -> project root
		join(__dirname, "..", "..", "repos.json"), // src/config -> project root (tsx dev)
		join(process.cwd(), "repos.json"),
	];
	return candidates.find((path) => existsSync(path)) ?? candidates[0]!;
}

function loadAllowlist(): Set<string> {
	try {
		const data = readFileSync(resolveReposJsonPath(), "utf8");
		return new Set(JSON.parse(data) as string[]);
	} catch (error) {
		console.warn(
			`[allowlist] failed to load repos.json: ${(error as Error).message}. ` +
				"No repositories will be allowed until the file is available.",
		);
		return new Set();
	}
}

const allowedRepos = loadAllowlist();

export function isRepoAllowed(fullName: string): boolean {
	return allowedRepos.has(fullName);
}

export function parseRepo(
	fullName: string,
): { owner: string; repo: string } | null {
	const parts = fullName.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
	return { owner: parts[0], repo: parts[1] };
}
