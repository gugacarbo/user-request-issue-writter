import { describe, expect, it } from "vitest";
import {
	AGENT_ISSUE_SECTIONS,
	agentIssueBodyInstructions,
	buildIssueBody,
	formatScreenshotMarkdown,
} from "../issue/template";

describe("issue template", () => {
	it("lists agent sections in instructions", () => {
		const instructions = agentIssueBodyInstructions();
		for (const section of AGENT_ISSUE_SECTIONS) {
			expect(instructions).toContain(section);
		}
		expect(instructions).toContain(
			"Do NOT include the raw user message, screenshot, or requester metadata",
		);
	});

	it("formatScreenshotMarkdown embeds http(s) and data:image URLs", () => {
		expect(formatScreenshotMarkdown("https://cdn.example.com/shot.png")).toBe(
			"![Screenshot](https://cdn.example.com/shot.png)",
		);
		expect(formatScreenshotMarkdown("data:image/png;base64,abc")).toBe(
			"![Screenshot](data:image/png;base64,abc)",
		);
		expect(formatScreenshotMarkdown("   ")).toBeNull();
	});

	it("buildIssueBody includes screenshot section when provided", () => {
		const body = buildIssueBody({
			agentBody: "## Resumo\nLogin broken.",
			rawUserMessage: "The login button is broken.",
			screenshot: "https://cdn.example.com/shot.png",
			requesterName: "Alice",
			requesterEmail: "alice@example.com",
		});

		expect(body).toContain("## Screenshot");
		expect(body).toContain("![Screenshot](https://cdn.example.com/shot.png)");
		expect(body.indexOf("## Screenshot")).toBeGreaterThan(
			body.indexOf("The login button is broken."),
		);
		expect(body.indexOf("## Resumo")).toBeGreaterThan(
			body.indexOf("## Screenshot"),
		);
	});

	it("buildIssueBody injects raw user message before agent content", () => {
		const body = buildIssueBody({
			agentBody: "## Resumo\nLogin broken.",
			rawUserMessage: "The login button is broken.",
			requesterName: "Alice",
			requesterEmail: "alice@example.com",
		});

		expect(body).toContain("## Mensagem original do usuário");
		expect(body).toContain("The login button is broken.");
		expect(body).toContain("## Resumo");
		expect(body).toContain("Login broken.");
		expect(body.indexOf("The login button is broken.")).toBeLessThan(
			body.indexOf("## Resumo"),
		);
		expect(body).toContain("_Requested by Alice (alice@example.com)_");
	});

	it("buildIssueBody omits raw section when message is empty", () => {
		const body = buildIssueBody({
			agentBody: "## Resumo\nDone.",
			rawUserMessage: "   ",
			requesterName: "Bob",
			requesterEmail: "bob@example.com",
		});

		expect(body).not.toContain("## Mensagem original do usuário");
		expect(body).toContain("## Resumo");
	});
});
