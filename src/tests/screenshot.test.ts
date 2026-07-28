import { describe, expect, it } from "vitest";
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

	it("prepareScreenshotMarkdown embeds the original image URL", () => {
		const markdown = prepareScreenshotMarkdown({
			screenshot: "https://cdn.example.com/shot.png",
		});

		expect(markdown).toBe(
			"![Screenshot](https://cdn.example.com/shot.png)",
		);
	});

	it("prepareScreenshotMarkdown embeds data:image screenshots", () => {
		const markdown = prepareScreenshotMarkdown({
			screenshot: "data:image/png;base64,iVBORw0KGgo=",
		});

		expect(markdown).toBe("![Screenshot](data:image/png;base64,iVBORw0KGgo=)");
	});

	it("prepareScreenshotMarkdown resolves relative NocoBase paths", () => {
		const markdown = prepareScreenshotMarkdown({
			screenshot: "/storage/uploads/shot.png",
			nocobasePublicUrl: "https://crm.example.com",
		});

		expect(markdown).toBe(
			"![Screenshot](https://crm.example.com/storage/uploads/shot.png)",
		);
	});

	it("prepareScreenshotMarkdown returns null for invalid screenshot URLs", () => {
		expect(
			prepareScreenshotMarkdown({
				screenshot: "https://crm.atplus.cloud",
			}),
		).toBeNull();
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
});
