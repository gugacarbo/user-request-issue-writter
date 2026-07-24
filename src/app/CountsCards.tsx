import type { Counts, RequestStatus } from "./types";

const ORDER: RequestStatus[] = ["pending", "processing", "done", "failed"];

export function CountsCards({ counts }: { counts: Counts }) {
	return (
		<section className="cards">
			{ORDER.map((k) => (
				<div key={k} className={`card card-${k}`}>
					<div className="card-value">{counts[k] ?? 0}</div>
					<div className="card-label">{k}</div>
				</div>
			))}
		</section>
	);
}
