import { useEffect, useRef, useState } from "react";

/**
 * Subscribe to a Server-Sent Events endpoint and parse typed events.
 *
 * Uses the browser's EventSource. On reconnect, the browser re-opens the
 * stream automatically (EventSource default); the server sends a snapshot
 * first so each reconnect resyncs the UI without losing data.
 *
 * Returns the latest payload per event name. `connected` reflects the
 * readyState for UI feedback.
 */
export type SseState<T> = {
	connected: boolean;
	data: T | null;
};

export function useSse<T>(url: string): SseState<T> {
	const [connected, setConnected] = useState(false);
	const [data, setData] = useState<T | null>(null);
	const esRef = useRef<EventSource | null>(null);

	useEffect(() => {
		const es = new EventSource(url);
		esRef.current = es;

		const onOpen = () => setConnected(true);
		const onError = () => setConnected(false);
		const onAny = (evt: MessageEvent) => {
			try {
				setData(JSON.parse(evt.data) as T);
			} catch {
				// keep last known good state; a malformed frame is non-fatal
			}
		};

		// Listen to every named event the server emits (snapshot/counts/logs).
		es.addEventListener("snapshot", onAny as EventListener);
		es.addEventListener("counts", onAny as EventListener);
		es.addEventListener("logs", onAny as EventListener);
		es.addEventListener("open", onOpen as EventListener);
		es.addEventListener("error", onError as EventListener);

		return () => {
			es.removeEventListener("snapshot", onAny as EventListener);
			es.removeEventListener("counts", onAny as EventListener);
			es.removeEventListener("logs", onAny as EventListener);
			es.removeEventListener("open", onOpen as EventListener);
			es.removeEventListener("error", onError as EventListener);
			es.close();
			esRef.current = null;
		};
	}, [url]);

	return { connected, data };
}
