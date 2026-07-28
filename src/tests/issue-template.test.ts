import { describe, expect, it } from "vitest";
import {
	AGENT_ISSUE_SECTIONS,
	agentIssueBodyInstructions,
	buildIssueBody,
	formatScreenshotMarkdown,
	formatTicketDiagnostics,
	formatTicketHeader,
	toTicketHeaderInput,
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
		expect(formatScreenshotMarkdown("https://crm.atplus.cloud")).toBeNull();
		expect(formatScreenshotMarkdown("   ")).toBeNull();
	});

	it("formatTicketHeader renders main webhook fields without diagnostics", () => {
		const header = formatTicketHeader(
			toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				urlAtual: "https://app.example.com/login",
				categoria: "bug",
				contextoSessao: "Chrome 120 on macOS",
				logsConsole: "TypeError: boom",
				logsRede: "POST /api/login 500",
				screenshot: "https://cdn.example.com/shot.png",
				metadata: { ticketId: "42" },
			}),
		);

		expect(header).toContain("## Informações do ticket");
		expect(header).toContain("**Repositório:** owner/repo");
		expect(header).toContain("**Solicitante:** Alice (alice@example.com)");
		expect(header).toContain("**URL atual:** https://app.example.com/login");
		expect(header).toContain("**Categoria:** bug");
		expect(header).toContain(
			"**Screenshot:** https://cdn.example.com/shot.png",
		);
		expect(header).not.toContain("Contexto da sessão");
		expect(header).not.toContain("Logs do console");
		expect(header).toContain("### Metadados");
		expect(header).toContain('"ticketId": "42"');
	});

	it("formatTicketDiagnostics renders session context and logs when present", () => {
		const diagnostics = formatTicketDiagnostics(
			toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				contextoSessao: "Chrome 120 on macOS",
				logsConsole: "TypeError: boom",
				logsRede: "POST /api/login 500",
			}),
		);

		expect(diagnostics).toContain("## Contexto da sessão");
		expect(diagnostics).toContain("Chrome 120 on macOS");
		expect(diagnostics).toContain("### Logs do console");
		expect(diagnostics).toContain("TypeError: boom");
		expect(diagnostics).toContain("### Logs de rede");
		expect(diagnostics).toContain("POST /api/login 500");
	});

	it("formatTicketDiagnostics returns null when nothing relevant is present", () => {
		expect(
			formatTicketDiagnostics(
				toTicketHeaderInput({
					owner: "owner",
					repo: "repo",
					requesterName: "Alice",
					requesterEmail: "alice@example.com",
				}),
			),
		).toBeNull();
	});

	it("formatTicketHeader omits requester when name and email are empty", () => {
		const header = formatTicketHeader(
			toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "   ",
				requesterEmail: "",
			}),
		);

		expect(header).not.toContain("**Solicitante:**");
	});

	it("formatTicketHeader supports name-only and email-only requesters", () => {
		const nameOnly = formatTicketHeader(
			toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "Alice",
				requesterEmail: "",
			}),
		);
		const emailOnly = formatTicketHeader(
			toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "",
				requesterEmail: "alice@example.com",
			}),
		);

		expect(nameOnly).toContain("**Solicitante:** Alice");
		expect(emailOnly).toContain("**Solicitante:** alice@example.com");
	});

	it("formatTicketDiagnostics renders only relevant sections", () => {
		expect(
			formatTicketDiagnostics(
				toTicketHeaderInput({
					owner: "owner",
					repo: "repo",
					requesterName: "Alice",
					requesterEmail: "alice@example.com",
					logsConsole: "console only",
				}),
			),
		).toContain("### Logs do console");

		expect(
			formatTicketDiagnostics(
				toTicketHeaderInput({
					owner: "owner",
					repo: "repo",
					requesterName: "Alice",
					requesterEmail: "alice@example.com",
					logsRede: "network only",
				}),
			),
		).toContain("### Logs de rede");

		expect(
			formatTicketDiagnostics(
				toTicketHeaderInput({
					owner: "owner",
					repo: "repo",
					requesterName: "Alice",
					requesterEmail: "alice@example.com",
					contextoSessao: "   ",
				}),
			),
		).toBeNull();
	});

	it("buildIssueBody omits diagnostics when only metadata is present", () => {
		const body = buildIssueBody({
			agentBody: "## Resumo\nDone.",
			rawUserMessage: "help",
			ticket: toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				metadata: { ticketId: "42" },
			}),
			requesterName: "Alice",
			requesterEmail: "alice@example.com",
		});

		expect(body).toContain("### Metadados");
		expect(body).not.toContain("## Contexto da sessão");
		expect(body).not.toContain("### Logs do console");
	});

	it("buildIssueBody places diagnostics after agent content and before footer", () => {
		const body = buildIssueBody({
			agentBody: "## Resumo\nLogin broken.",
			rawUserMessage: "The login button is broken.",
			ticket: toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				contextoSessao: "Chrome 120 on macOS",
				logsConsole: "TypeError: boom",
			}),
			requesterName: "Alice",
			requesterEmail: "alice@example.com",
		});

		expect(body).toContain("## Contexto da sessão");
		expect(body).toContain("TypeError: boom");
		expect(body.indexOf("## Resumo")).toBeLessThan(
			body.indexOf("## Contexto da sessão"),
		);
		expect(body.indexOf("TypeError: boom")).toBeLessThan(body.indexOf("---"));
	});

	it("buildIssueBody places ticket header before the raw user message", () => {
		const body = buildIssueBody({
			agentBody: "## Resumo\nLogin broken.",
			rawUserMessage: "The login button is broken.",
			ticket: toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
				urlAtual: "https://app.example.com/login",
				categoria: "bug",
			}),
			requesterName: "Alice",
			requesterEmail: "alice@example.com",
		});

		expect(body).toContain("## Informações do ticket");
		expect(body).toContain("## Mensagem original do usuário");
		expect(body.indexOf("## Informações do ticket")).toBeLessThan(
			body.indexOf("## Mensagem original do usuário"),
		);
		expect(body.indexOf("The login button is broken.")).toBeLessThan(
			body.indexOf("## Resumo"),
		);
	});

	it("buildIssueBody includes screenshot section when provided", () => {
		const body = buildIssueBody({
			agentBody: "## Resumo\nLogin broken.",
			rawUserMessage: "The login button is broken.",
			ticket: toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
			}),
			screenshotMarkdown: "![Screenshot](https://cdn.example.com/shot.png)",
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
			ticket: toTicketHeaderInput({
				owner: "owner",
				repo: "repo",
				requesterName: "Alice",
				requesterEmail: "alice@example.com",
			}),
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

	it("buildIssueBody uses screenshot fallback when markdown is not provided", () => {
		const body = buildIssueBody({
			agentBody: "## Resumo\nDone.",
			rawUserMessage: "help",
			screenshot: "https://cdn.example.com/shot.png",
			requesterName: "Alice",
			requesterEmail: "alice@example.com",
		});

		expect(body).toContain("## Screenshot");
		expect(body).toContain("![Screenshot](https://cdn.example.com/shot.png)");
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
