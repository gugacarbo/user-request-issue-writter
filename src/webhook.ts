import { createHmac, timingSafeEqual } from "node:crypto";

export type WebhookContext = {
	readonly owner: string;
	readonly repo: string;
	readonly commentBody: string;
	readonly commentUser: string;
	readonly commentUrl: string;
	readonly issueNumber: number;
	readonly issueTitle: string;
	readonly issueBody: string;
	readonly matchesTrigger: (prefix: string | undefined) => boolean;
};

type IssueCommentPayload = {
	action: string;
	repository?: {
		full_name?: string;
		name?: string;
		owner?: { login?: string };
	};
	issue?: { number: number; title: string; body?: string };
	comment?: { body?: string; user?: { login?: string }; html_url?: string };
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

export function isRelevantEvent(
	event: string,
	body: { action?: string },
): boolean {
	return event === "issue_comment" && body.action === "created";
}

export function extractContext(payload: IssueCommentPayload): WebhookContext {
	const repo = payload.repository;
	const owner = repo?.owner?.login ?? repo?.full_name?.split("/")[0] ?? "";
	const repoName = repo?.name ?? repo?.full_name?.split("/")[1] ?? "";
	const commentBody = payload.comment?.body ?? "";
	const issue = payload.issue;
	const ctx: Omit<WebhookContext, "matchesTrigger"> = {
		owner,
		repo: repoName,
		commentBody,
		commentUser: payload.comment?.user?.login ?? "",
		commentUrl: payload.comment?.html_url ?? "",
		issueNumber: issue?.number ?? 0,
		issueTitle: issue?.title ?? "",
		issueBody: issue?.body ?? "",
	};
	return {
		...ctx,
		matchesTrigger: (prefix: string | undefined) => {
			if (!prefix) return true;
			return commentBody.trimStart().startsWith(prefix);
		},
	};
}
