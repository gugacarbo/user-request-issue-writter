/**
 * Canonical GitHub issue body shape for agent-drafted issues.
 * The host injects the raw user message; the LLM fills the analysis sections.
 */

export const AGENT_ISSUE_SECTIONS = [
	"## Resumo",
	"## Comportamento esperado",
	"## Comportamento atual / problema",
	"## Arquivos e código relevantes",
	"## Abordagem sugerida",
] as const;

import { isEmbeddableScreenshot } from "./screenshot";

const RAW_USER_MESSAGE_HEADING = "## Mensagem original do usuário";
const SCREENSHOT_HEADING = "## Screenshot";
const TICKET_INFO_HEADING = "## Informações do ticket";

export type TicketHeaderInput = {
	readonly owner: string;
	readonly repo: string;
	readonly requesterName?: string;
	readonly requesterEmail?: string;
	readonly urlAtual?: string;
	readonly categoria?: string;
	readonly contextoSessao?: string;
	readonly logsConsole?: string;
	readonly logsRede?: string;
	readonly screenshot?: string;
	readonly metadata?: Record<string, unknown>;
};

function formatRequester(name?: string, email?: string): string | null {
	const trimmedName = name?.trim() ?? "";
	const trimmedEmail = email?.trim() ?? "";
	if (trimmedName && trimmedEmail) return `${trimmedName} (${trimmedEmail})`;
	if (trimmedName) return trimmedName;
	if (trimmedEmail) return trimmedEmail;
	return null;
}

function fencedBlock(content: string, language = ""): string[] {
	return ["", `\`\`\`${language}`, content.trim(), "```"];
}

export function formatTicketHeader(input: TicketHeaderInput): string {
	const lines = [
		TICKET_INFO_HEADING,
		"",
		`- **Repositório:** ${input.owner}/${input.repo}`,
	];

	const requester = formatRequester(input.requesterName, input.requesterEmail);
	if (requester) lines.push(`- **Solicitante:** ${requester}`);
	if (input.urlAtual) lines.push(`- **URL atual:** ${input.urlAtual}`);
	if (input.categoria) lines.push(`- **Categoria:** ${input.categoria}`);
	if (input.screenshot) lines.push(`- **Screenshot:** ${input.screenshot}`);

	const sections: string[] = [...lines];

	if (input.metadata) {
		sections.push(
			"### Metadados",
			...fencedBlock(JSON.stringify(input.metadata, null, 2), "json"),
		);
	}

	return `${sections.join("\n")}\n`;
}

const SESSION_CONTEXT_HEADING = "## Contexto da sessão";

export function formatTicketDiagnostics(
	input: TicketHeaderInput,
): string | null {
	const sections: string[] = [];

	if (input.contextoSessao?.trim()) {
		sections.push(SESSION_CONTEXT_HEADING, "", input.contextoSessao.trim());
	}
	if (input.logsConsole?.trim()) {
		sections.push(
			"### Logs do console",
			...fencedBlock(input.logsConsole, "text"),
		);
	}
	if (input.logsRede?.trim()) {
		sections.push("### Logs de rede", ...fencedBlock(input.logsRede, "text"));
	}

	if (sections.length === 0) return null;
	return `${sections.join("\n")}\n`;
}

export function toTicketHeaderInput(ctx: {
	readonly owner: string;
	readonly repo: string;
	readonly requesterName: string;
	readonly requesterEmail: string;
	readonly urlAtual?: string;
	readonly categoria?: string;
	readonly contextoSessao?: string;
	readonly logsConsole?: string;
	readonly logsRede?: string;
	readonly screenshot?: string;
	readonly metadata?: Record<string, unknown>;
}): TicketHeaderInput {
	return {
		owner: ctx.owner,
		repo: ctx.repo,
		requesterName: ctx.requesterName,
		requesterEmail: ctx.requesterEmail,
		urlAtual: ctx.urlAtual,
		categoria: ctx.categoria,
		contextoSessao: ctx.contextoSessao,
		logsConsole: ctx.logsConsole,
		logsRede: ctx.logsRede,
		screenshot: ctx.screenshot,
		metadata: ctx.metadata,
	};
}

export function formatScreenshotMarkdown(screenshot: string): string | null {
	const value = screenshot.trim();
	if (!value || !isEmbeddableScreenshot(value)) return null;
	return `![Screenshot](${value})`;
}

export function agentIssueBodyInstructions(): string {
	return [
		"Structure the issue `body` (Markdown) with exactly these sections:",
		...AGENT_ISSUE_SECTIONS,
		"",
		"Do NOT include the raw user message, screenshot, or requester metadata in `body` — the host adds them.",
		"Fill each section from repository analysis and the ticket context.",
	].join("\n");
}

export type BuildIssueBodyInput = {
	readonly agentBody: string;
	readonly rawUserMessage: string;
	readonly ticket?: TicketHeaderInput;
	/** Pre-rendered screenshot markdown (preferred). */
	readonly screenshotMarkdown?: string | null;
	readonly screenshot?: string;
	readonly requesterName: string;
	readonly requesterEmail: string;
};

export function buildIssueBody(input: BuildIssueBodyInput): string {
	const headerSection = input.ticket ? [formatTicketHeader(input.ticket)] : [];

	const rawMessage = input.rawUserMessage.trim();
	const rawSection = rawMessage
		? [RAW_USER_MESSAGE_HEADING, "", rawMessage, ""]
		: [];

	const screenshotMarkdown =
		input.screenshotMarkdown ??
		(input.screenshot ? formatScreenshotMarkdown(input.screenshot) : null);
	const screenshotSection = screenshotMarkdown
		? [SCREENSHOT_HEADING, "", screenshotMarkdown, ""]
		: [];

	const diagnosticsSection = input.ticket
		? (formatTicketDiagnostics(input.ticket) ?? "")
		: "";

	return [
		...headerSection,
		...rawSection,
		...screenshotSection,
		input.agentBody.trim(),
		"",
		diagnosticsSection,
		"---",
		`_Requested by ${input.requesterName} (${input.requesterEmail})_`,
	].join("\n");
}
