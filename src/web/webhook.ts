import { createHmac, timingSafeEqual } from "node:crypto";

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
};

type TicketPayload = {
	repo?: string;
	requester?: { name?: string; email?: string };
	payload?: {
		descricao?: string;
		url_atual?: string;
		categoria?: string;
		contexto_da_sessao?: string;
		logs_do_console?: string;
		logs_de_rede?: string;
		screenshot?: string;
	};
};

export function verifySignature(
	rawBody: Buffer,
	signature: string,
	secret: string,
): boolean {
	if (!signature?.startsWith("sha256=")) return false;
	const expected = createHmac("sha256", secret).update(rawBody).digest();
	const provided = Buffer.from(signature.slice("sha256=".length), "hex");
	if (provided.length !== expected.length) return false;
	return timingSafeEqual(expected, provided);
}

export function extractTicket(payload: TicketPayload): TicketContext | null {
	const repoStr = payload.repo?.trim();
	if (!repoStr) return null;
	const parts = repoStr.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

	const descricao = payload.payload?.descricao?.trim();
	if (!descricao) return null;

	const p = payload.payload;
	return {
		owner: parts[0],
		repo: parts[1],
		requesterName: payload.requester?.name?.trim() ?? "",
		requesterEmail: payload.requester?.email?.trim() ?? "",
		descricao,
		urlAtual: p?.url_atual?.trim() || undefined,
		categoria: p?.categoria?.trim() || undefined,
		contextoSessao: p?.contexto_da_sessao?.trim() || undefined,
		logsConsole: p?.logs_do_console?.trim() || undefined,
		logsRede: p?.logs_de_rede?.trim() || undefined,
		screenshot: p?.screenshot?.trim() || undefined,
	};
}
