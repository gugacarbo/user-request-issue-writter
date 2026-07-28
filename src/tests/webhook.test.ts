import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	extractBearerToken,
	extractTicket,
	type TicketContext,
	verifyAuthToken,
	webhookAuthToken,
} from "../web/webhook";

const SECRET = "topsecret";
const TOKEN = webhookAuthToken(SECRET);

const FULL_PAYLOAD = JSON.stringify({
	repo: "owner/repo",
	requester: { name: "Alice", email: "alice@example.com" },
	metadata: { ticketId: "42", source: "nocobase" },
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

describe("webhookAuthToken", () => {
	it("returns the SHA-256 hex digest of the secret", () => {
		const expected = createHash("sha256").update(SECRET).digest("hex");
		expect(webhookAuthToken(SECRET)).toBe(expected);
	});
});

describe("extractBearerToken", () => {
	it("extracts the token from a Bearer header", () => {
		expect(extractBearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
	});

	it("returns undefined for missing or malformed headers", () => {
		expect(extractBearerToken(undefined)).toBeUndefined();
		expect(extractBearerToken("")).toBeUndefined();
		expect(extractBearerToken("Basic abc")).toBeUndefined();
		expect(extractBearerToken("Bearer ")).toBeUndefined();
	});
});

describe("verifyAuthToken", () => {
	it("accepts the SHA-256 digest of the secret", () => {
		expect(verifyAuthToken(TOKEN, SECRET)).toBe(true);
	});

	it("rejects a divergent token", () => {
		expect(verifyAuthToken("deadbeef", SECRET)).toBe(false);
	});

	it("rejects an empty token", () => {
		expect(verifyAuthToken("", SECRET)).toBe(false);
	});

	it("rejects when secret differs", () => {
		expect(verifyAuthToken(webhookAuthToken("other"), SECRET)).toBe(false);
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
		expect(ctx.metadata).toEqual({ ticketId: "42", source: "nocobase" });
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

	it("normalizes screenshot attachment objects", () => {
		const ctx = extractTicket({
			repo: "owner/repo",
			payload: {
				descricao: "test",
				screenshot: [{ url: "https://cdn.example.com/shot.png" }],
			},
		}) as TicketContext;
		expect(ctx.screenshot).toBe("https://cdn.example.com/shot.png");
	});

	it("forwards base URL screenshot to urlAtual when url_atual is missing", () => {
		const ctx = extractTicket({
			repo: "owner/repo",
			payload: {
				descricao: "test",
				screenshot: "https://crm.atplus.cloud",
			},
		}) as TicketContext;
		expect(ctx.screenshot).toBeUndefined();
		expect(ctx.urlAtual).toBe("https://crm.atplus.cloud");
	});

	it("drops base URL screenshot when url_atual is already set", () => {
		const ctx = extractTicket({
			repo: "owner/repo",
			payload: {
				descricao: "test",
				url_atual: "https://crm2.atplus.cloud/cs/negociacoes",
				screenshot: "https://crm.atplus.cloud",
			},
		}) as TicketContext;
		expect(ctx.screenshot).toBeUndefined();
		expect(ctx.urlAtual).toBe("https://crm2.atplus.cloud/cs/negociacoes");
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

	it("extracts metadata when provided", () => {
		const ctx = extractTicket({
			repo: "owner/repo",
			metadata: { recordId: 99, nested: { ok: true } },
			payload: { descricao: "test" },
		}) as TicketContext;
		expect(ctx.metadata).toEqual({ recordId: 99, nested: { ok: true } });
	});

	it("ignores invalid or empty metadata", () => {
		expect(
			extractTicket({
				repo: "owner/repo",
				metadata: {},
				payload: { descricao: "test" },
			})?.metadata,
		).toBeUndefined();
		expect(
			extractTicket({
				repo: "owner/repo",
				metadata: "not-an-object",
				payload: { descricao: "test" },
			})?.metadata,
		).toBeUndefined();
		expect(
			extractTicket({
				repo: "owner/repo",
				metadata: ["array"],
				payload: { descricao: "test" },
			})?.metadata,
		).toBeUndefined();
	});
});
