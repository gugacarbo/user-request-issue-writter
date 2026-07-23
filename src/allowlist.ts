import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadAllowlist(): Set<string> {
	try {
		const data = readFileSync(join(__dirname, "..", "repos.json"), "utf8");
		return new Set(JSON.parse(data) as string[]);
	} catch {
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
