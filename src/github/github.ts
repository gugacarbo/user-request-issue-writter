const GITHUB_API = "https://api.github.com";
const MAX_FILE_BYTES = 10_000;

type RepoTree = string[];

type RepoInfo = {
	readonly description: string | null;
	readonly languages: Record<string, number>;
	readonly readme: string | null;
};

type CreateIssueInput = {
	readonly title: string;
	readonly body: string;
	readonly labels?: string[];
};

export type CreateIssueResult = {
	readonly number: number;
	readonly url: string;
};

export type GitHubClient = {
	readonly getRepoTree: (
		owner: string,
		repo: string,
		branch?: string,
	) => Promise<RepoTree>;
	readonly getFileContent: (
		owner: string,
		repo: string,
		path: string,
		branch?: string,
	) => Promise<string>;
	readonly getRepoInfo: (owner: string, repo: string) => Promise<RepoInfo>;
	readonly createIssue: (
		owner: string,
		repo: string,
		input: CreateIssueInput,
	) => Promise<CreateIssueResult>;
};

function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
}

function decodeBase64Utf8(b64: string): string {
	return Buffer.from(b64, "base64").toString("utf8");
}

export function createGitHubClient(token: string): GitHubClient {
	const defaultBranchCache = new Map<string, string>();

	async function resolveDefaultBranch(
		owner: string,
		repo: string,
	): Promise<string> {
		const key = `${owner}/${repo}`;
		const cached = defaultBranchCache.get(key);
		if (cached) return cached;
		const data = await getJson<{ default_branch?: string }>(
			`${GITHUB_API}/repos/${owner}/${repo}`,
		);
		const branch = data.default_branch ?? "main";
		defaultBranchCache.set(key, branch);
		return branch;
	}

	async function request(url: string, init?: RequestInit): Promise<Response> {
		const headers = { ...authHeaders(token), ...(init?.headers ?? {}) };
		const res = await fetch(url, { ...init, headers });
		return res;
	}

	async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
		const res = await request(url, init);
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`GitHub API ${res.status} for ${url}: ${text}`);
		}
		return (await res.json()) as T;
	}

	return {
		async getRepoTree(owner, repo, branch?): Promise<RepoTree> {
			const ref = branch ?? (await resolveDefaultBranch(owner, repo));
			const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${ref}`;
			const data = await getJson<{ tree: { path: string }[] }>(url);
			return data.tree.map((entry) => entry.path);
		},

		async getFileContent(owner, repo, path, branch?): Promise<string> {
			const base = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
			const url = branch ? `${base}?ref=${branch}` : base;
			const data = await getJson<{ content?: string; encoding?: string }>(url);
			if (!data.content || data.encoding !== "base64") return "";
			const decoded = decodeBase64Utf8(data.content);
			if (decoded.length <= MAX_FILE_BYTES) return decoded;
			const suffix = "\n[...truncated]";
			return `${decoded.slice(0, MAX_FILE_BYTES - suffix.length)}${suffix}`;
		},

		async getRepoInfo(owner, repo): Promise<RepoInfo> {
			const base = await getJson<{ description?: string | null }>(
				`${GITHUB_API}/repos/${owner}/${repo}`,
			);
			const languages = await getJson<Record<string, number>>(
				`${GITHUB_API}/repos/${owner}/${repo}/languages`,
			);
			let readme: string | null = null;
			try {
				const data = await getJson<{ content?: string; encoding?: string }>(
					`${GITHUB_API}/repos/${owner}/${repo}/contents/README.md`,
				);
				if (data.content && data.encoding === "base64") {
					readme = decodeBase64Utf8(data.content);
				}
			} catch {
				readme = null;
			}
			return { description: base.description ?? null, languages, readme };
		},

		async createIssue(owner, repo, input): Promise<CreateIssueResult> {
			const url = `${GITHUB_API}/repos/${owner}/${repo}/issues`;
			const post = (body: CreateIssueInput): Promise<Response> =>
				request(url, { method: "POST", body: JSON.stringify(body) });

			let res = await post(input);
			if (res.status === 422 && input.labels && input.labels.length > 0) {
				res = await post({ title: input.title, body: input.body });
			}
			if (!res.ok) {
				const text = await res.text().catch(() => "");
				throw new Error(`GitHub createIssue ${res.status}: ${text}`);
			}
			const data = (await res.json()) as { number: number; html_url: string };
			return { number: data.number, url: data.html_url };
		},
	};
}
