/** Shape mirrors of the JSON the backend ships over SSE/JSON (src/dashboardApi.ts). */

export type RequestStatus = "pending" | "processing" | "done" | "failed";

export type QueueSummaryRow = {
	id: number;
	requestId: number;
	status: RequestStatus;
	attempts: number;
	lastError: string | null;
	nextRunAt: number;
	createdAt: number;
	updatedAt: number;
	bodyHash: string | null;
	repo: string | null;
	requesterName: string | null;
	issueNumber: number | null;
	issueUrl: string | null;
};

export type LlmLogRow = {
	id: number;
	requestId: number;
	iteration: number | null;
	event: string;
	toolName: string | null;
	data: Record<string, unknown> | null;
	createdAt: number;
};

export type Counts = Record<RequestStatus, number>;
