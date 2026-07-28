import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/github";
import {
	isBaseUrlOnly,
	isEmbeddableScreenshot,
	normalizeScreenshotInput,
	prepareScreenshotMarkdown,
	resolveScreenshotContext,
} from "../issue/screenshot";

describe("screenshot helpers", () => {
	it("normalizeScreenshotInput accepts strings and attachment objects", () => {
		expect(normalizeScreenshotInput(" https://cdn.example.com/a.png ")).toBe(
			"https://cdn.example.com/a.png",
		);
		expect(
			normalizeScreenshotInput([
				{ url: "https://cdn.example.com/a.png", filename: "a.png" },
			]),
		).toBe("https://cdn.example.com/a.png");
		expect(
			normalizeScreenshotInput({ url: "https://cdn.example.com/a.png" }),
		).toBe("https://cdn.example.com/a.png");
		expect(normalizeScreenshotInput("   ")).toBeUndefined();
	});

	it("isEmbeddableScreenshot accepts image URLs and rejects bare origins", () => {
		expect(isEmbeddableScreenshot("https://cdn.example.com/shot.png")).toBe(
			true,
		);
		expect(
			isEmbeddableScreenshot(
				"https://crm.atplus.cloud/storage/uploads/abc.jpg",
			),
		).toBe(true);
		expect(isEmbeddableScreenshot("data:image/png;base64,abc")).toBe(true);
		expect(isEmbeddableScreenshot("https://crm.atplus.cloud")).toBe(false);
		expect(isEmbeddableScreenshot("https://crm.atplus.cloud/")).toBe(false);
	});

	it("isBaseUrlOnly detects known CRM origins without a path", () => {
		expect(isBaseUrlOnly("https://crm.atplus.cloud")).toBe(true);
		expect(isBaseUrlOnly("https://crm.atplus.cloud/")).toBe(true);
		expect(isBaseUrlOnly("https://crm2.atplus.cloud")).toBe(true);
		expect(
			isBaseUrlOnly("https://crm.atplus.cloud/storage/uploads/abc.jpg"),
		).toBe(false);
		expect(isBaseUrlOnly("https://cdn.example.com/shot.png")).toBe(false);
	});

	it("resolveScreenshotContext forwards base URL to urlAtual when missing", () => {
		expect(
			resolveScreenshotContext("https://crm.atplus.cloud", undefined),
		).toEqual({
			screenshot: undefined,
			urlAtual: "https://crm.atplus.cloud",
		});
	});

	it("resolveScreenshotContext drops base URL screenshot when urlAtual exists", () => {
		expect(
			resolveScreenshotContext(
				"https://crm.atplus.cloud",
				"https://crm2.atplus.cloud/cs/negociacoes",
			),
		).toEqual({
			screenshot: undefined,
			urlAtual: "https://crm2.atplus.cloud/cs/negociacoes",
		});
	});

	it("resolveScreenshotContext keeps real screenshot URLs", () => {
		expect(
			resolveScreenshotContext(
				"https://crm.atplus.cloud/storage/uploads/abc.jpg",
				"https://crm2.atplus.cloud/cs/negociacoes",
			),
		).toEqual({
			screenshot: "https://crm.atplus.cloud/storage/uploads/abc.jpg",
			urlAtual: "https://crm2.atplus.cloud/cs/negociacoes",
		});
	});

	it("prepareScreenshotMarkdown re-hosts fetched images on GitHub", async () => {
		const pngBytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			"base64",
		);
		const fetchMock = vi.fn(async () => ({
			ok: true,
			headers: new Headers({ "content-type": "image/png" }),
			arrayBuffer: async () => pngBytes.buffer,
		}));
		vi.stubGlobal("fetch", fetchMock);

		const github: GitHubClient = {
			getRepoTree: vi.fn(),
			getFileContent: vi.fn(),
			getRepoInfo: vi.fn(),
			createIssue: vi.fn(),
			uploadRepositoryFile: vi.fn(
				async () =>
					"https://raw.githubusercontent.com/owner/repo/main/.github/issue-screenshots/test.png",
			),
		};

		const markdown = await prepareScreenshotMarkdown({
			screenshot: "https://cdn.example.com/shot.png",
			owner: "owner",
			repo: "repo",
			github,
		});

		expect(markdown).toBe(
			"![Screenshot](https://raw.githubusercontent.com/owner/repo/main/.github/issue-screenshots/test.png)",
		);
		expect(github.uploadRepositoryFile).toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it("prepareScreenshotMarkdown re-hosts data:image screenshots", async () => {
		const github: GitHubClient = {
			getRepoTree: vi.fn(),
			getFileContent: vi.fn(),
			getRepoInfo: vi.fn(),
			createIssue: vi.fn(),
			uploadRepositoryFile: vi.fn(
				async () =>
					"https://raw.githubusercontent.com/owner/repo/main/.github/issue-screenshots/data.png",
			),
		};

		const markdown = await prepareScreenshotMarkdown({
			screenshot: "data:image/png;base64,iVBORw0KGgo=",
			owner: "owner",
			repo: "repo",
			github,
		});

		expect(markdown).toContain("![Screenshot](");
		expect(github.uploadRepositoryFile).toHaveBeenCalled();
	});

	it("prepareScreenshotMarkdown fetches relative NocoBase paths with auth", async () => {
		const pngBytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
			"base64",
		);
		const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
			expect(init?.headers).toEqual({
				Authorization: "Bearer secret-token",
			});
			return {
				ok: true,
				headers: new Headers({ "content-type": "image/png" }),
				arrayBuffer: async () => pngBytes.buffer,
			};
		});
		vi.stubGlobal("fetch", fetchMock);

		const github: GitHubClient = {
			getRepoTree: vi.fn(),
			getFileContent: vi.fn(),
			getRepoInfo: vi.fn(),
			createIssue: vi.fn(),
			uploadRepositoryFile: vi.fn(
				async () =>
					"https://raw.githubusercontent.com/owner/repo/main/.github/issue-screenshots/noco.png",
			),
		};

		const markdown = await prepareScreenshotMarkdown({
			screenshot: "https://crm.example.com/storage/uploads/shot.png",
			owner: "owner",
			repo: "repo",
			github,
			nocobaseToken: "secret-token",
			nocobasePublicUrl: "https://crm.example.com",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://crm.example.com/storage/uploads/shot.png",
			expect.any(Object),
		);
		expect(markdown).toContain("![Screenshot](");
		vi.unstubAllGlobals();
	});

	it("prepareScreenshotMarkdown returns null when fetch fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: false,
				headers: new Headers(),
				arrayBuffer: async () => new ArrayBuffer(0),
			})),
		);

		const github: GitHubClient = {
			getRepoTree: vi.fn(),
			getFileContent: vi.fn(),
			getRepoInfo: vi.fn(),
			createIssue: vi.fn(),
			uploadRepositoryFile: vi.fn(),
		};

		await expect(
			prepareScreenshotMarkdown({
				screenshot: "https://cdn.example.com/shot.png",
				owner: "owner",
				repo: "repo",
				github,
			}),
		).resolves.toBeNull();
		vi.unstubAllGlobals();
	});

	it("normalizeScreenshotInput ignores unsupported values", () => {
		expect(normalizeScreenshotInput([])).toBeUndefined();
		expect(normalizeScreenshotInput({ url: "   " })).toBeUndefined();
		expect(normalizeScreenshotInput(42)).toBeUndefined();
	});

	it("isBaseUrlOnly accepts custom NocoBase public URLs", () => {
		expect(
			isBaseUrlOnly("https://crm.example.com", "https://crm.example.com"),
		).toBe(true);
		expect(
			isBaseUrlOnly("https://crm.example.com/page", "https://crm.example.com"),
		).toBe(false);
	});

	it("resolveScreenshotContext returns urlAtual when screenshot is absent", () => {
		expect(
			resolveScreenshotContext(undefined, "https://app.example.com/login"),
		).toEqual({
			screenshot: undefined,
			urlAtual: "https://app.example.com/login",
		});
	});

	it("prepareScreenshotMarkdown returns null for invalid screenshot URLs", async () => {
		const github: GitHubClient = {
			getRepoTree: vi.fn(),
			getFileContent: vi.fn(),
			getRepoInfo: vi.fn(),
			createIssue: vi.fn(),
			uploadRepositoryFile: vi.fn(),
		};

		await expect(
			prepareScreenshotMarkdown({
				screenshot: "https://crm.atplus.cloud",
				owner: "owner",
				repo: "repo",
				github,
			}),
		).resolves.toBeNull();
	});
});
