import { useCallback, useEffect, useRef, useState } from "react";
import type { RunDetail } from "./types";

const POLL_MS_PROCESSING = 1500;

/**
 * Load a run detail snapshot and keep it fresh while the request is still
 * pending/processing (poll). Settles to a single fetch when terminal.
 */
export function useRequestRun(requestId: number) {
	const [run, setRun] = useState<RunDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const aliveRef = useRef(true);

	const loadRun = useCallback(async (): Promise<RunDetail> => {
		const res = await fetch(`/app/api/requests/${requestId}`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as RunDetail;
	}, [requestId]);

	useEffect(() => {
		aliveRef.current = true;
		setRun(null);
		setError(null);
		setLoading(true);

		let timer: ReturnType<typeof setTimeout> | undefined;

		const refresh = async () => {
			try {
				const data = await loadRun();
				if (!aliveRef.current) return;
				setRun(data);
				setError(null);
				setLoading(false);
				const status = data.request.status;
				if (status === "pending" || status === "processing") {
					timer = setTimeout(() => {
						void refresh();
					}, POLL_MS_PROCESSING);
				}
			} catch (e: unknown) {
				if (!aliveRef.current) return;
				setError(e instanceof Error ? e.message : String(e));
				setLoading(false);
			}
		};

		void refresh();

		return () => {
			aliveRef.current = false;
			if (timer) clearTimeout(timer);
		};
	}, [loadRun]);

	return { run, error, loading, reload: loadRun };
}
