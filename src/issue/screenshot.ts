import { createHash } from "node:crypto";
import type { GitHubClient } from "../github/github";

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i;
const DATA_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;

type AttachmentLike = {
	readonly url?: unknown;
};

function normalizeOrigin(value: string): string {
	return value.trim().replace(/\/+$/, "").toLowerCase();
}

function knownBaseOrigins(nocobasePublicUrl?: string): string[] {
	const defaults = ["https://crm.atplus.cloud", "https://crm2.atplus.cloud"];
	if (!nocobasePublicUrl) return defaults.map(normalizeOrigin);
	return [...defaults, nocobasePublicUrl].map(normalizeOrigin);
}

/** True when the value is an http(s) origin with no meaningful path (e.g. app base URL). */
export function isBaseUrlOnly(
	value: string,
	nocobasePublicUrl?: string,
): boolean {
	const trimmed = value.trim();
	if (!/^https?:\/\//i.test(trimmed)) return false;

	try {
		const url = new URL(trimmed);
		const path = url.pathname.replace(/\/+$/, "");
		if (path !== "") return false;
		return knownBaseOrigins(nocobasePublicUrl).includes(
			normalizeOrigin(url.origin),
		);
	} catch {
		return false;
	}
}

export type ResolvedScreenshotContext = {
	readonly screenshot?: string;
	readonly urlAtual?: string;
};

/**
 * When the webhook sends the app base URL in `screenshot` by mistake, drop it
 * from the image field and forward it as `urlAtual` when that field is empty.
 */
export function resolveScreenshotContext(
	screenshot: string | undefined,
	urlAtual: string | undefined,
	nocobasePublicUrl?: string,
): ResolvedScreenshotContext {
	if (!screenshot) {
		return { screenshot: undefined, urlAtual };
	}
	if (!isBaseUrlOnly(screenshot, nocobasePublicUrl)) {
		return { screenshot, urlAtual };
	}
	return {
		screenshot: undefined,
		urlAtual: urlAtual ?? screenshot,
	};
}

export function normalizeScreenshotInput(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed || undefined;
	}
	if (Array.isArray(value) && value.length > 0) {
		return normalizeScreenshotInput(value[0]);
	}
	if (value && typeof value === "object" && "url" in value) {
		const url = (value as AttachmentLike).url;
		return typeof url === "string" && url.trim() ? url.trim() : undefined;
	}
	return undefined;
}

export function isEmbeddableScreenshot(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (DATA_IMAGE_RE.test(trimmed)) return true;
	if (!/^https?:\/\//i.test(trimmed)) return false;

	try {
		const url = new URL(trimmed);
		if (!url.pathname || url.pathname === "/") return false;
	} catch {
		return false;
	}

	if (IMAGE_EXTENSION_RE.test(trimmed)) return true;
	if (/\/storage\/uploads\//i.test(trimmed)) return true;
	if (/user-images\.githubusercontent\.com/i.test(trimmed)) return true;
	if (/user-attachments\/assets/i.test(trimmed)) return true;
	if (/\/attachments\//i.test(trimmed)) return true;

	return false;
}

function parseDataImage(value: string): { mime: string; bytes: Buffer } | null {
	const match = DATA_IMAGE_RE.exec(value.trim());
	if (!match) return null;
	return {
		mime: match[1],
		bytes: Buffer.from(match[2], "base64"),
	};
}

function extensionForMime(mime: string): string {
	switch (mime.toLowerCase()) {
		case "image/png":
			return "png";
		case "image/gif":
			return "gif";
		case "image/webp":
			return "webp";
		case "image/svg+xml":
			return "svg";
		default:
			return "jpg";
	}
}

function resolveFetchUrl(value: string, nocobasePublicUrl?: string): string {
	if (/^https?:\/\//i.test(value)) return value;
	if (!value.startsWith("/")) return value;
	const base = (nocobasePublicUrl ?? "https://crm.atplus.cloud").replace(
		/\/$/,
		"",
	);
	return `${base}${value}`;
}

function fetchHeaders(
	url: string,
	nocobaseToken?: string,
	nocobasePublicUrl?: string,
): Record<string, string> | undefined {
	if (!nocobaseToken) return undefined;
	const base = (nocobasePublicUrl ?? "https://crm.atplus.cloud").replace(
		/\/$/,
		"",
	);
	try {
		const parsed = new URL(url);
		const baseHost = new URL(base).host;
		if (parsed.host === baseHost) {
			return { Authorization: `Bearer ${nocobaseToken}` };
		}
	} catch {
		return undefined;
	}
	return undefined;
}

async function loadScreenshotBytes(
	value: string,
	options?: {
		readonly nocobaseToken?: string;
		readonly nocobasePublicUrl?: string;
	},
): Promise<{ bytes: Buffer; extension: string } | null> {
	const dataImage = parseDataImage(value);
	if (dataImage) {
		return {
			bytes: dataImage.bytes,
			extension: extensionForMime(dataImage.mime),
		};
	}

	if (!isEmbeddableScreenshot(value)) return null;

	const fetchUrl = resolveFetchUrl(value, options?.nocobasePublicUrl);
	const headers = fetchHeaders(
		fetchUrl,
		options?.nocobaseToken,
		options?.nocobasePublicUrl,
	);
	const response = await fetch(fetchUrl, headers ? { headers } : undefined);
	if (!response.ok) return null;

	const contentType = response.headers.get("content-type") ?? "";
	if (contentType && !contentType.startsWith("image/")) return null;

	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length === 0) return null;

	const extension =
		IMAGE_EXTENSION_RE.exec(fetchUrl)?.[1]?.toLowerCase() ??
		extensionForMime(contentType.split(";")[0] || "image/jpeg");

	return { bytes, extension };
}

export type PrepareScreenshotInput = {
	readonly screenshot?: string;
	readonly owner: string;
	readonly repo: string;
	readonly github: GitHubClient;
	readonly nocobaseToken?: string;
	readonly nocobasePublicUrl?: string;
};

/**
 * Validates the screenshot, fetches image bytes when needed, re-hosts on the
 * target repository, and returns Markdown that GitHub can render in issues.
 */
export async function prepareScreenshotMarkdown(
	input: PrepareScreenshotInput,
): Promise<string | null> {
	const screenshot = input.screenshot?.trim();
	if (!screenshot || !isEmbeddableScreenshot(screenshot)) return null;

	const loaded = await loadScreenshotBytes(screenshot, {
		nocobaseToken: input.nocobaseToken,
		nocobasePublicUrl: input.nocobasePublicUrl,
	});
	if (!loaded) return null;

	const hash = createHash("sha256").update(loaded.bytes).digest("hex");
	const path = `.github/issue-screenshots/${hash}.${loaded.extension}`;
	const hostedUrl = await input.github.uploadRepositoryFile(
		input.owner,
		input.repo,
		path,
		loaded.bytes,
		"Add issue screenshot",
	);

	return `![Screenshot](${hostedUrl})`;
}
