import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

type ToolPart = {
	state?: string;
	type?: string;
	toolCallId?: string;
	input?: Record<string, unknown>;
	output?: unknown;
};

function isPending(state: string | undefined): boolean {
	return state !== "output-available" && state !== "output-error";
}

function ToolRow({
	title,
	subtitle,
	pending,
	children,
	defaultOpen = false,
	nested = false,
}: {
	title: string;
	subtitle?: string;
	pending: boolean;
	children?: ReactNode;
	defaultOpen?: boolean;
	nested?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const expandable = Boolean(children);

	if (!expandable) {
		return (
			<div
				className={cn(
					"text-xs",
					nested
						? "px-2 py-1"
						: "rounded-lg border border-border bg-muted/30 px-2 py-1",
				)}
			>
				<p className="truncate font-medium">
					{pending ? `${title}…` : title}
					{subtitle ? (
						<span className="font-normal text-muted-foreground">
							{" "}
							· {subtitle}
						</span>
					) : null}
				</p>
			</div>
		);
	}

	return (
		<div
			className={cn(
				"text-xs",
				nested
					? "rounded-md border border-border/60 bg-background/40"
					: "rounded-lg border border-border bg-muted/30",
			)}
		>
			<button
				type="button"
				className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
				onClick={() => setOpen((value) => !value)}
			>
				<ChevronDownIcon
					className={cn(
						"size-3 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180",
					)}
				/>
				<div className="min-w-0 flex-1 truncate">
					<span className="font-medium">{pending ? `${title}…` : title}</span>
					{subtitle ? (
						<span className="text-muted-foreground"> · {subtitle}</span>
					) : null}
				</div>
			</button>
			{open ? (
				<div
					className={cn(
						"border-t border-border px-2 py-1.5",
						nested && "border-border/60",
					)}
				>
					{children}
				</div>
			) : null}
		</div>
	);
}

function outputRecord(output: unknown): Record<string, unknown> | null {
	if (!output || typeof output !== "object") return null;
	return output as Record<string, unknown>;
}

function outputText(output: unknown): string {
	if (typeof output === "string") return output;
	const record = outputRecord(output);
	if (record && typeof record.text === "string") return record.text;
	if (record && typeof record.content === "string") return record.content;
	return "";
}

const TOOL_GROUP_LABELS: Record<string, [string, string]> = {
	read_file: ["leitura", "leituras"],
	list_files: ["listagem", "listagens"],
	get_repo_info: ["info do repositório", "infos do repositório"],
	submit_issue: ["envio de issue", "envios de issue"],
	report_error: ["erro reportado", "erros reportados"],
};

function summarizeToolGroup(tools: ToolPart[]): string {
	const counts = new Map<string, number>();
	for (const tool of tools) {
		const name = (tool.type ?? "").replace(/^tool-/, "");
		if (!name) continue;
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}

	const segments: string[] = [];
	for (const [name, count] of counts) {
		const labels = TOOL_GROUP_LABELS[name];
		if (labels) {
			segments.push(`${count} ${count === 1 ? labels[0] : labels[1]}`);
			continue;
		}
		segments.push(`${count} ${name}`);
	}

	if (segments.length === 0) return `${tools.length} ferramentas`;
	if (segments.length === 1) return segments[0]!;
	if (segments.length === 2) return `${segments[0]} e ${segments[1]}`;
	return `${segments.slice(0, -1).join(", ")} e ${segments.at(-1)}`;
}

export function ToolCallsGroup({
	tools,
	renderTool,
}: {
	tools: ToolPart[];
	renderTool: (tool: ToolPart, index: number) => ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const anyPending = tools.some((tool) => isPending(tool.state));
	const summary = summarizeToolGroup(tools);

	return (
		<div className="rounded-lg border border-border bg-muted/30 text-xs">
			<button
				type="button"
				className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
				onClick={() => setOpen((value) => !value)}
			>
				<ChevronDownIcon
					className={cn(
						"size-3 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180",
					)}
				/>
				<span className="min-w-0 flex-1 truncate font-medium">
					{anyPending ? `${summary}…` : summary}
				</span>
				<span className="shrink-0 text-muted-foreground">{tools.length}</span>
			</button>
			{open ? (
				<div className="space-y-1 border-t border-border px-1.5 py-1.5">
					{tools.map((tool, index) => (
						<div key={index}>{renderTool(tool, index)}</div>
					))}
				</div>
			) : null}
		</div>
	);
}

export function ListFilesToolPart({
	part,
	nested = false,
}: {
	part: ToolPart;
	nested?: boolean;
}) {
	const pending = isPending(part.state);
	const record = outputRecord(part.output);
	const files = Array.isArray(record?.files)
		? record.files.filter((f): f is string => typeof f === "string")
		: outputText(part.output)
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean);
	const count =
		typeof record?.numFiles === "number" ? record.numFiles : files.length;

	return (
		<ToolRow
			title={pending ? "Listando arquivos" : `Listou ${count} itens`}
			subtitle={
				typeof part.input?.path === "string" && part.input.path
					? part.input.path
					: "raiz do repositório"
			}
			pending={pending}
			nested={nested}
		>
			{files.length > 0 ? (
				<ul className="max-h-48 list-none space-y-0.5 overflow-y-auto font-mono text-xs">
					{files.map((file) => (
						<li key={file} className="truncate text-foreground/90">
							{file}
						</li>
					))}
				</ul>
			) : (
				<p className="text-xs text-muted-foreground">Nenhum arquivo listado.</p>
			)}
		</ToolRow>
	);
}

export function ReadFileToolPart({
	part,
	nested = false,
}: {
	part: ToolPart;
	nested?: boolean;
}) {
	const pending = isPending(part.state);
	const path =
		typeof part.input?.path === "string"
			? part.input.path
			: typeof part.input?.file_path === "string"
				? part.input.file_path
				: "arquivo";
	const content = outputText(part.output);
	const output = outputRecord(part.output);
	const lineCount =
		typeof output?.lineCount === "number"
			? output.lineCount
			: content.split("\n").length;

	return (
		<ToolRow
			title={pending ? "Lendo arquivo" : "Arquivo lido"}
			subtitle={path}
			pending={pending}
			nested={nested}
		>
			{content ? (
				<pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">
					{content}
				</pre>
			) : (
				<p className="text-xs text-muted-foreground">Sem conteúdo.</p>
			)}
			{!pending && content ? (
				<p className="mt-2 text-xs text-muted-foreground">
					{lineCount} {lineCount === 1 ? "linha" : "linhas"}
				</p>
			) : null}
		</ToolRow>
	);
}

export function GetRepoInfoToolPart({
	part,
	nested = false,
}: {
	part: ToolPart;
	nested?: boolean;
}) {
	const pending = isPending(part.state);
	const text = outputText(part.output);

	return (
		<ToolRow
			title={pending ? "Obtendo info do repositório" : "Info do repositório"}
			pending={pending}
			nested={nested}
		>
			{text ? (
				<pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">
					{text}
				</pre>
			) : (
				<p className="text-xs text-muted-foreground">Sem dados.</p>
			)}
		</ToolRow>
	);
}

export function SubmitIssueToolPart({
	part,
	nested = false,
}: {
	part: ToolPart;
	nested?: boolean;
}) {
	const pending = isPending(part.state);
	const input = part.input ?? {};
	const output = outputRecord(part.output) ?? {};
	const issueTitle =
		typeof input.title === "string"
			? input.title
			: typeof output.title === "string"
				? output.title
				: "Rascunho da issue";
	const body =
		typeof input.body === "string"
			? input.body
			: typeof output.body === "string"
				? output.body
				: undefined;
	const labels = Array.isArray(input.labels)
		? input.labels.filter((l): l is string => typeof l === "string")
		: Array.isArray(output.labels)
			? output.labels.filter((l): l is string => typeof l === "string")
			: [];
	const labelsSuffix =
		labels.length > 0 ? ` · ${labels.join(", ")}` : "";

	return (
		<ToolRow
			title={
				pending ? "Enviando rascunho da issue" : "Rascunho da issue enviado"
			}
			subtitle={`${issueTitle}${labelsSuffix}`}
			pending={pending}
			nested={nested}
		>
			<p className="font-medium text-foreground">{issueTitle}</p>
			{labels.length > 0 ? (
				<p className="mt-1 text-muted-foreground">Labels: {labels.join(", ")}</p>
			) : null}
			{body ? (
				<pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground/90">
					{body}
				</pre>
			) : (
				<p className="mt-2 text-muted-foreground">Sem corpo da issue.</p>
			)}
		</ToolRow>
	);
}

export function ReportErrorToolPart({
	part,
	nested = false,
}: {
	part: ToolPart;
	nested?: boolean;
}) {
	const pending = isPending(part.state);
	const record = outputRecord(part.output) ?? outputRecord(part.input);
	const message =
		typeof record?.message === "string"
			? record.message
			: outputText(part.output) || "Erro reportado";
	const code = typeof record?.code === "string" ? record.code : undefined;

	return (
		<ToolRow
			title={pending ? "Reportando erro…" : "Agente encerrou com erro"}
			subtitle={code}
			pending={pending}
			nested={nested}
		>
			<p className="text-sm text-destructive whitespace-pre-wrap">{message}</p>
		</ToolRow>
	);
}
