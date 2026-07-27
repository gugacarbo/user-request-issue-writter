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
		const onSnapshot = (evt: MessageEvent) => {
			try {
				setData(JSON.parse(evt.data) as T);
			} catch {
				// keep last known good state; a malformed frame is non-fatal
			}
		};
		// Counts ticks only ship status tallies — merge so we keep the last queue
		// snapshot instead of wiping `queue` from state.
		const onCounts = (evt: MessageEvent) => {
			try {
				const counts = JSON.parse(evt.data) as Record<string, unknown>;
				setData((prev) => ({ ...(prev ?? {}), counts }) as T);
			} catch {
				// keep last known good state
			}
		};
		const onLogs = (evt: MessageEvent) => {
			try {
				setData(JSON.parse(evt.data) as T);
			} catch {
				// keep last known good state
			}
		};

		es.addEventListener("snapshot", onSnapshot as EventListener);
		es.addEventListener("counts", onCounts as EventListener);
		es.addEventListener("logs", onLogs as EventListener);
		es.addEventListener("open", onOpen as EventListener);
		es.addEventListener("error", onError as EventListener);

		return () => {
			es.removeEventListener("snapshot", onSnapshot as EventListener);
			es.removeEventListener("counts", onCounts as EventListener);
			es.removeEventListener("logs", onLogs as EventListener);
			es.removeEventListener("open", onOpen as EventListener);
			es.removeEventListener("error", onError as EventListener);
			es.close();
			esRef.current = null;
		};
	}, [url]);

	return { connected, data };
}
