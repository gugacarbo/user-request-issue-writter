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

function resolveFetchUrl(value: string, nocobasePublicUrl?: string): string {
	if (/^https?:\/\//i.test(value)) return value;
	if (!value.startsWith("/")) return value;
	const base = (nocobasePublicUrl ?? "https://crm.atplus.cloud").replace(
		/\/$/,
		"",
	);
	return `${base}${value}`;
}

export type PrepareScreenshotInput = {
	readonly screenshot?: string;
	readonly nocobasePublicUrl?: string;
};

/**
 * Validates the screenshot and returns Markdown that embeds the original image URL.
 */
export function prepareScreenshotMarkdown(
	input: PrepareScreenshotInput,
): string | null {
	const screenshot = input.screenshot?.trim();
	if (!screenshot) return null;

	const url = resolveFetchUrl(screenshot, input.nocobasePublicUrl);
	if (!isEmbeddableScreenshot(url)) return null;

	return `![Screenshot](${url})`;
}
