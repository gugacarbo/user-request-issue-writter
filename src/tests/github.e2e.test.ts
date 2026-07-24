import { afterAll, describe, expect, it } from "vitest";
import { createGitHubClient } from "../github/github";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const canRun = Boolean(GITHUB_TOKEN);

const OWNER = "gugacarbo";
const REPO = "user-request-issue-writter";

describe.skipIf(!canRun)(
	"github e2e: real GitHub API (read + create-then-close)",
	() => {
		const client = createGitHubClient(GITHUB_TOKEN as string);
		const createdIssueNumbers: number[] = [];

		async function closeIssue(number: number): Promise<void> {
			await fetch(
				`https://api.github.com/repos/${OWNER}/${REPO}/issues/${number}`,
				{
					method: "PATCH",
					headers: {
						Authorization: `Bearer ${GITHUB_TOKEN}`,
						Accept: "application/vnd.github+json",
						"X-GitHub-Api-Version": "2022-11-28",
					},
					body: JSON.stringify({
						state: "closed",
						state_reason: "not_planned",
					}),
				},
			);
		}

		afterAll(async () => {
			await Promise.all(createdIssueNumbers.map((n) => closeIssue(n)));
		});

		it("getRepoTree returns file list from main branch", async () => {
			const tree = await client.getRepoTree(OWNER, REPO);
			expect(tree.length).toBeGreaterThan(0);
			expect(tree).toContain("package.json");
		});

		it("getFileContent returns decoded file content", async () => {
			const content = await client.getFileContent(OWNER, REPO, "package.json");
			expect(content).toContain('"name"');
			expect(content).toContain("module");
		});

		it("getRepoInfo returns description, languages, and README", async () => {
			const info = await client.getRepoInfo(OWNER, REPO);
			expect(info.languages).toBeDefined();
			expect(Object.keys(info.languages).length).toBeGreaterThan(0);
			expect(info.readme).not.toBeNull();
		});

		it("createIssue creates and returns number + url, then closes in cleanup", async () => {
			const stamp = Date.now();
			const result = await client.createIssue(OWNER, REPO, {
				title: `[e2e-test] auto-cleanup ${stamp}`,
				body: "Created by automated e2e test. Closed automatically — no action needed.",
				labels: [],
			});
			expect(result.number).toBeGreaterThan(0);
			expect(result.url).toContain(`issues/${result.number}`);
			createdIssueNumbers.push(result.number);
		}, 30_000);
	},
);
