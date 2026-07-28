import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

type ToolPart = {
	state?: string;
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
}: {
	title: string;
	subtitle?: string;
	pending: boolean;
	children?: ReactNode;
	defaultOpen?: boolean;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const expandable = Boolean(children);

	if (!expandable) {
		return (
			<div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
				<p className="font-medium">{pending ? `${title}…` : title}</p>
				{subtitle ? (
					<p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
				) : null}
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-border bg-muted/30 text-sm">
			<button
				type="button"
				className="flex w-full items-center gap-2 px-3 py-2 text-left"
				onClick={() => setOpen((value) => !value)}
			>
				<ChevronDownIcon
					className={cn(
						"size-3.5 shrink-0 text-muted-foreground transition-transform",
						open && "rotate-180",
					)}
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium">{pending ? `${title}…` : title}</p>
					{subtitle ? (
						<p className="mt-0.5 truncate text-xs text-muted-foreground">
							{subtitle}
						</p>
					) : null}
				</div>
			</button>
			{open ? (
				<div className="border-t border-border px-3 py-2">{children}</div>
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

export function ListFilesToolPart({ part }: { part: ToolPart }) {
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
			defaultOpen={files.length > 0 && files.length <= 20}
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

export function ReadFileToolPart({ part }: { part: ToolPart }) {
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
			defaultOpen={Boolean(content)}
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

export function GetRepoInfoToolPart({ part }: { part: ToolPart }) {
	const pending = isPending(part.state);
	const text = outputText(part.output);

	return (
		<ToolRow
			title={pending ? "Obtendo info do repositório" : "Info do repositório"}
			pending={pending}
			defaultOpen={Boolean(text)}
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
