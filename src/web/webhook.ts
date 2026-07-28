import { createHash, timingSafeEqual } from "node:crypto";
import {
	normalizeScreenshotInput,
	resolveScreenshotContext,
} from "../issue/screenshot";

export type TicketContext = {
	readonly owner: string;
	readonly repo: string;
	readonly requesterName: string;
	readonly requesterEmail: string;
	readonly descricao: string;
	readonly urlAtual?: string;
	readonly categoria?: string;
	readonly contextoSessao?: string;
	readonly logsConsole?: string;
	readonly logsRede?: string;
	readonly screenshot?: string;
	readonly metadata?: Record<string, unknown>;
};

type ExtractTicketOptions = {
	readonly nocobasePublicUrl?: string;
};

function normalizeMetadata(value: unknown): Record<string, unknown> | undefined {
	if (value === null || value === undefined) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	return Object.keys(record).length > 0 ? record : undefined;
}

type TicketPayload = {
	repo?: string;
	requester?: { name?: string; email?: string };
	metadata?: unknown;
	payload?: {
		descricao?: string;
		url_atual?: string;
		categoria?: string;
		contexto_da_sessao?: string;
		logs_do_console?: string;
		logs_de_rede?: string;
		screenshot?: unknown;
	};
};

export function webhookAuthToken(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}

export function extractBearerToken(
	authHeader: string | undefined,
): string | undefined {
	if (!authHeader?.startsWith("Bearer ")) return undefined;
	const token = authHeader.slice("Bearer ".length).trim();
	return token || undefined;
}

export function verifyAuthToken(token: string, secret: string): boolean {
	const expected = Buffer.from(webhookAuthToken(secret), "utf8");
	const provided = Buffer.from(token, "utf8");
	if (provided.length !== expected.length) return false;
	return timingSafeEqual(expected, provided);
}

export function extractTicket(
	payload: TicketPayload,
	options?: ExtractTicketOptions,
): TicketContext | null {
	const repoStr = payload.repo?.trim();
	if (!repoStr) return null;
	const parts = repoStr.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

	const descricao = payload.payload?.descricao?.trim();
	if (!descricao) return null;

	const p = payload.payload;
	const urlAtual = p?.url_atual?.trim() || undefined;
	const screenshot = normalizeScreenshotInput(p?.screenshot);
	const resolved = resolveScreenshotContext(
		screenshot,
		urlAtual,
		options?.nocobasePublicUrl,
	);

	return {
		owner: parts[0],
		repo: parts[1],
		requesterName: payload.requester?.name?.trim() ?? "",
		requesterEmail: payload.requester?.email?.trim() ?? "",
		descricao,
		urlAtual: resolved.urlAtual,
		categoria: p?.categoria?.trim() || undefined,
		contextoSessao: p?.contexto_da_sessao?.trim() || undefined,
		logsConsole: p?.logs_do_console?.trim() || undefined,
		logsRede: p?.logs_de_rede?.trim() || undefined,
		screenshot: resolved.screenshot,
		metadata: normalizeMetadata(payload.metadata),
	};
}
