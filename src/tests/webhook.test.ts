import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractTicket, type TicketContext, verifySignature } from "../webhook";

const SECRET = "topsecret";

function sign(body: string, secret: string = SECRET): string {
	const sig = createHmac("sha256", secret).update(body).digest("hex");
	return `sha256=${sig}`;
}

const FULL_PAYLOAD = JSON.stringify({
	repo: "owner/repo",
	requester: { name: "Alice", email: "alice@example.com" },
	payload: {
		descricao: "The login button is broken",
		url_atual: "https://app.example.com/login",
		categoria: "bug",
		contexto_da_sessao: "User was on Chrome 120",
		logs_do_console: "TypeError: cannot read 'addEventListener'",
		logs_de_rede: "POST /api/login 500",
		screenshot: "https://cdn.example.com/shot.png",
	},
});

describe("verifySignature", () => {
	it("accepts a valid HMAC signature", () => {
		const raw = Buffer.from(FULL_PAYLOAD);
		expect(verifySignature(raw, sign(FULL_PAYLOAD), SECRET)).toBe(true);
	});

	it("rejects a divergent signature", () => {
		const raw = Buffer.from(FULL_PAYLOAD);
		expect(verifySignature(raw, "sha256=deadbeef", SECRET)).toBe(false);
	});

	it("rejects a missing signature", () => {
		expect(verifySignature(Buffer.from(FULL_PAYLOAD), "", SECRET)).toBe(false);
	});

	it("rejects when secret differs", () => {
		const raw = Buffer.from(FULL_PAYLOAD);
		expect(verifySignature(raw, sign(FULL_PAYLOAD, "other"), SECRET)).toBe(
			false,
		);
	});
});

describe("extractTicket", () => {
	it("extracts all fields from a full payload", () => {
		const ctx = extractTicket(JSON.parse(FULL_PAYLOAD)) as TicketContext;
		expect(ctx.owner).toBe("owner");
		expect(ctx.repo).toBe("repo");
		expect(ctx.requesterName).toBe("Alice");
		expect(ctx.requesterEmail).toBe("alice@example.com");
		expect(ctx.descricao).toBe("The login button is broken");
		expect(ctx.urlAtual).toBe("https://app.example.com/login");
		expect(ctx.categoria).toBe("bug");
		expect(ctx.contextoSessao).toBe("User was on Chrome 120");
		expect(ctx.logsConsole).toBe("TypeError: cannot read 'addEventListener'");
		expect(ctx.logsRede).toBe("POST /api/login 500");
		expect(ctx.screenshot).toBe("https://cdn.example.com/shot.png");
	});

	it("works with only mandatory fields (descricao + repo)", () => {
		const ctx = extractTicket({
			repo: "org/project",
			payload: { descricao: "something is wrong" },
		}) as TicketContext;
		expect(ctx.owner).toBe("org");
		expect(ctx.repo).toBe("project");
		expect(ctx.descricao).toBe("something is wrong");
		expect(ctx.urlAtual).toBeUndefined();
		expect(ctx.categoria).toBeUndefined();
	});

	it("returns null when repo is missing", () => {
		expect(extractTicket({ payload: { descricao: "x" } })).toBeNull();
	});

	it("returns null when repo format is invalid", () => {
		expect(
			extractTicket({ repo: "invalid", payload: { descricao: "x" } }),
		).toBeNull();
		expect(
			extractTicket({ repo: "a/b/c", payload: { descricao: "x" } }),
		).toBeNull();
	});

	it("returns null when descricao is missing", () => {
		expect(extractTicket({ repo: "owner/repo", payload: {} })).toBeNull();
	});

	it("returns null when descricao is empty", () => {
		expect(
			extractTicket({ repo: "owner/repo", payload: { descricao: "   " } }),
		).toBeNull();
	});

	it("handles missing requester gracefully", () => {
		const ctx = extractTicket({
			repo: "owner/repo",
			payload: { descricao: "test" },
		}) as TicketContext;
		expect(ctx.requesterName).toBe("");
		expect(ctx.requesterEmail).toBe("");
	});

	it("treats empty optional strings as undefined", () => {
		const ctx = extractTicket({
			repo: "owner/repo",
			payload: {
				descricao: "test",
				url_atual: "   ",
				categoria: "",
			},
		}) as TicketContext;
		expect(ctx.urlAtual).toBeUndefined();
		expect(ctx.categoria).toBeUndefined();
	});
});
