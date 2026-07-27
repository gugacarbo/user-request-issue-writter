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
	/** Pre-rendered screenshot markdown (preferred — already hosted for GitHub). */
	readonly screenshotMarkdown?: string | null;
	readonly screenshot?: string;
	readonly requesterName: string;
	readonly requesterEmail: string;
};

export function buildIssueBody(input: BuildIssueBodyInput): string {
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

	return [
		...rawSection,
		...screenshotSection,
		input.agentBody.trim(),
		"",
		"---",
		`_Requested by ${input.requesterName} (${input.requesterEmail})_`,
	].join("\n");
}
