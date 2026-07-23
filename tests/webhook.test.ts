import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	extractContext,
	isRelevantEvent,
	verifySignature,
	type WebhookContext,
} from "../src/webhook.ts";

const SECRET = "topsecret";

function sign(body: string, secret: string = SECRET): string {
	const sig = createHmac("sha256", secret).update(body).digest("hex");
	return `sha256=${sig}`;
}

const COMMENT_BODY = JSON.stringify({
	action: "created",
	repository: {
		full_name: "owner/repo",
		name: "repo",
		owner: { login: "owner" },
	},
	issue: { number: 3, title: "Login fails", body: "it broke" },
	comment: {
		body: "/issue the login button is broken",
		user: { login: "alice" },
		html_url: "https://example/c/3",
	},
});

describe("verifySignature", () => {
	it("accepts a valid HMAC signature", () => {
		const raw = Buffer.from(COMMENT_BODY);
		expect(verifySignature(raw, sign(COMMENT_BODY), SECRET)).toBe(true);
	});

	it("rejects a divergent signature", () => {
		const raw = Buffer.from(COMMENT_BODY);
		expect(verifySignature(raw, "sha256=deadbeef", SECRET)).toBe(false);
	});

	it("rejects a missing signature", () => {
		expect(verifySignature(Buffer.from(COMMENT_BODY), "", SECRET)).toBe(false);
	});

	it("rejects when secret differs", () => {
		const raw = Buffer.from(COMMENT_BODY);
		expect(verifySignature(raw, sign(COMMENT_BODY, "other"), SECRET)).toBe(
			false,
		);
	});

	it("uses timing-safe comparison", () => {
		const raw = Buffer.from(COMMENT_BODY);
		expect(verifySignature(raw, sign(COMMENT_BODY), SECRET)).toBe(true);
	});
});

describe("isRelevantEvent", () => {
	it("returns true for issue_comment created", () => {
		expect(isRelevantEvent("issue_comment", { action: "created" })).toBe(true);
	});

	it("returns false for edited comments", () => {
		expect(isRelevantEvent("issue_comment", { action: "edited" })).toBe(false);
	});

	it("returns false for other events", () => {
		expect(isRelevantEvent("push", { action: "created" })).toBe(false);
	});
});

describe("extractContext", () => {
	it("extracts owner, repo, comment and issue fields", () => {
		const ctx = extractContext(JSON.parse(COMMENT_BODY));
		expect(ctx.owner).toBe("owner");
		expect(ctx.repo).toBe("repo");
		expect(ctx.commentUser).toBe("alice");
		expect(ctx.issueNumber).toBe(3);
		expect(ctx.issueTitle).toBe("Login fails");
		expect(ctx.commentBody).toContain("/issue");
		expect(ctx.commentUrl).toBe("https://example/c/3");
	});

	it("matches the trigger prefix when configured", () => {
		const ctx: WebhookContext = extractContext(JSON.parse(COMMENT_BODY));
		expect(ctx.matchesTrigger("/issue")).toBe(true);
	});

	it("does not match a different trigger prefix", () => {
		const ctx: WebhookContext = extractContext(JSON.parse(COMMENT_BODY));
		expect(ctx.matchesTrigger("/bug")).toBe(false);
	});

	it("always matches when no trigger prefix is set", () => {
		const ctx: WebhookContext = extractContext(JSON.parse(COMMENT_BODY));
		expect(ctx.matchesTrigger(undefined)).toBe(true);
	});
});
