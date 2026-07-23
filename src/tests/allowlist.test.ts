import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	readFileSync: vi.fn(),
}));

const { readFileSync } = await import("node:fs");

const SAMPLE = ["owner/repo", "org/another"];

beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
});

describe("allowlist", () => {
	it("allows repos present in repos.json", async () => {
		vi.mocked(readFileSync).mockReturnValue(JSON.stringify(SAMPLE));
		const { isRepoAllowed } = await import("../allowlist");
		expect(isRepoAllowed("owner/repo")).toBe(true);
		expect(isRepoAllowed("org/another")).toBe(true);
	});

	it("rejects repos not in repos.json", async () => {
		vi.mocked(readFileSync).mockReturnValue(JSON.stringify(SAMPLE));
		const { isRepoAllowed } = await import("../allowlist");
		expect(isRepoAllowed("evil/owner")).toBe(false);
		expect(isRepoAllowed("")).toBe(false);
	});

	it("parseRepo splits owner/repo correctly", async () => {
		vi.mocked(readFileSync).mockReturnValue(JSON.stringify(SAMPLE));
		const { parseRepo } = await import("../allowlist");
		expect(parseRepo("owner/repo")).toEqual({ owner: "owner", repo: "repo" });
		expect(parseRepo("a/b/c")).toBeNull();
		expect(parseRepo("")).toBeNull();
		expect(parseRepo("/repo")).toBeNull();
		expect(parseRepo("owner/")).toBeNull();
	});

	it("returns empty set when repos.json is missing", async () => {
		vi.mocked(readFileSync).mockImplementation(() => {
			throw new Error("ENOENT");
		});
		const { isRepoAllowed } = await import("../allowlist");
		expect(isRepoAllowed("owner/repo")).toBe(false);
	});
});
