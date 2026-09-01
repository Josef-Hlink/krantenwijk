/**
 * Thin typed client for the engine. Always relative /api — the vite proxy
 * (dev) or same-origin host (prod) resolves it; no hardcoded hosts.
 *
 * Only ids and coordinates travel through the planning endpoints (/cluster,
 * /route, /estimate). The /rounds endpoints at the bottom are the deliberate
 * exception — they carry addresses and names, exist only on an instance
 * configured to store rounds, and 404 everywhere else. See $lib/rounds/types.
 */
import type { Round, RoundSummary } from "$lib/rounds/types";

export interface ApiPoint {
  id: string;
  lat: number;
  lon: number;
}

export interface Assignment {
  id: string;
  bucket: string;
}

export interface Leg {
  distance_m: number;
  duration_s: number;
}

export interface RouteResult {
  order: string[];
  geometry: [number, number][]; // [lon, lat]
  duration_s: number;
  distance_m: number;
  engine: "ors" | "fallback";
  /** One per consecutive pair in `order`, so `legs.length === order.length - 1`. */
  legs: Leg[];
}

export interface EstimateResult {
  total_s: number;
  per_stop_s: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
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

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
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

export interface Status {
  status: string;
  routing: "ors" | "fallback";
  /** Whether an account could be used here at all — false on a storage-less instance. */
  accounts: boolean;
  /** Whether *this caller* can reach saved rounds: signed in, on an instance that stores. */
  rounds: boolean;
  /** Who is signed in, or null. */
  user: string | null;
}

export async function status(): Promise<Status> {
  return get<Status>("/status");
}

export async function cluster(
  points: ApiPoint[],
  maxStops: number,
  nCarriers?: number,
): Promise<Assignment[]> {
  const data = await post<{ assignments: Assignment[] }>("/cluster", {
    points,
    max_stops: maxStops,
    n_carriers: nCarriers ?? null,
  });
  return data.assignments;
}

export async function route(
  points: ApiPoint[],
  startId?: string,
  endId?: string,
): Promise<RouteResult> {
  return post<RouteResult>("/route", {
    points,
    start_id: startId ?? null,
    end_id: endId ?? null,
    optimize: true,
  });
}

export async function estimate(
  durationS: number,
  nStops: number,
  serviceTimeS = 45,
): Promise<EstimateResult> {
  return post<EstimateResult>("/estimate", {
    duration_s: durationS,
    n_stops: nStops,
    service_time_s: serviceTimeS,
  });
}

// ── accounts ──────────────────────────────────────────────────────────
// There is no `register` here because there is no such endpoint. Accounts are
// made by hand with `krantenwijk useradd` on the box; see the engine's auth.py.

export async function login(
  username: string,
  password: string,
): Promise<{ username: string }> {
  return post<{ username: string }>("/login", { username, password });
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST" });
}

// ── saved rounds ──────────────────────────────────────────────────────
// Unlike everything above, these carry addresses and names. They only exist
// on an instance configured to store rounds; elsewhere they 404. See the
// engine's rounds.py for why that fence is where it is.

export async function listRounds(): Promise<RoundSummary[]> {
  return get<RoundSummary[]>("/rounds");
}

export async function getRound(id: string): Promise<Round> {
  return get<Round>(`/rounds/${encodeURIComponent(id)}`);
}

export async function createRound(round: Round): Promise<Round> {
  return post<Round>("/rounds", round);
}
