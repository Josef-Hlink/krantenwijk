/**
 * Thin typed client for the engine. Always relative /api — the vite proxy
 * (dev) or same-origin host (prod) resolves it; no hardcoded hosts. Only
 * ids and coordinates ever travel through here.
 */

export interface ApiPoint {
	id: string;
	lat: number;
	lon: number;
}

export interface Assignment {
	id: string;
	bucket: string;
}

export interface RouteResult {
	order: string[];
	geometry: [number, number][]; // [lon, lat]
	duration_s: number;
	distance_m: number;
	engine: 'ors' | 'fallback';
}

export interface EstimateResult {
	total_s: number;
	per_stop_s: number;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

async function post<T>(path: string, body: unknown): Promise<T> {
	const res = await fetch(`/api${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		let detail = res.statusText;
		try {
			detail = (await res.json()).detail ?? detail;
		} catch {
			// non-JSON error body — keep statusText
		}
		throw new ApiError(res.status, detail);
	}
	return res.json();
}

export async function cluster(
	points: ApiPoint[],
	maxStops: number,
	nCarriers?: number
): Promise<Assignment[]> {
	const data = await post<{ assignments: Assignment[] }>('/cluster', {
		points,
		max_stops: maxStops,
		n_carriers: nCarriers ?? null
	});
	return data.assignments;
}

export async function route(
	points: ApiPoint[],
	startId?: string,
	endId?: string
): Promise<RouteResult> {
	return post<RouteResult>('/route', {
		points,
		start_id: startId ?? null,
		end_id: endId ?? null,
		optimize: true
	});
}

export async function estimate(
	durationS: number,
	nStops: number,
	serviceTimeS = 45
): Promise<EstimateResult> {
	return post<EstimateResult>('/estimate', {
		duration_s: durationS,
		n_stops: nStops,
		service_time_s: serviceTimeS
	});
}
