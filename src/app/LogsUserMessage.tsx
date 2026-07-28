import { Markdown } from "@agent-elements/markdown";
import type { UIMessage } from "ai";

function messageText(message: UIMessage): string {
	const parts = message.parts ?? [];
	return parts
		.filter(
			(part): part is { type: "text"; text: string } =>
				part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join("\n\n")
		.trim();
}

/** User bubble for agent log replay — renders markdown like a chat message. */
export function LogsUserMessage({ message }: { message: UIMessage }) {
	const text = messageText(message);
	if (!text) return null;

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="max-w-[min(88%,26rem)] rounded-an-message bg-an-user-message-bg px-3.5 py-2 text-sm text-an-user-message-text shadow-sm">
				<Markdown
					content={text}
					className="[&_.an-md-p]:mb-1.5 [&_.an-md-p:last-child]:mb-0 [&_.an-md-p]:text-an-user-message-text"
				/>
			</div>
		</div>
	);
}
