/**
 * Client-side geocoding via public Nominatim — only used when the upload
 * lacks coordinates. Sequential queue at ~1 req/s (the OSM usage policy),
 * results cached in localStorage so re-uploads don't re-ask. The consent
 * dialog (GeocodePanel) must run before the first uncached request.
 */
import type { Rec } from '$lib/records/records.svelte';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const SPACING_MS = 1100;
const CACHE_KEY = 'krantenwijk.geocache.v1';

type Coords = { lat: number; lon: number };

function loadCache(): Record<string, Coords | null> {
	try {
		return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
	} catch {
		return {};
	}
}

function saveCache(cache: Record<string, Coords | null>) {
	try {
		localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
	} catch {
		// cache full — geocoding still works, just uncached
	}
}

export function cacheKey(r: Rec): string {
	return [r.street, r.houseNumber, r.postcode, r.city]
		.map((s) => (s ?? '').trim().toLowerCase())
		.join('|');
}

/** How many of these records would actually hit the network? */
export function uncachedCount(records: Rec[]): number {
	const cache = loadCache();
	return records.filter((r) => cache[cacheKey(r)] === undefined).length;
}

export interface GeocodeProgress {
	done: number;
	total: number;
	failed: number;
}

/**
 * Geocode records in place (mutating lat/lon/geocode). Reports progress and
 * honors an AbortSignal between requests.
 */
export async function geocodeAll(
	records: Rec[],
	onProgress: (p: GeocodeProgress) => void,
	signal: AbortSignal
): Promise<void> {
	const cache = loadCache();
	let done = 0;
	let failed = 0;
	let lastRequest = 0;

	for (const rec of records) {
		if (signal.aborted) return;

		const key = cacheKey(rec);
		let coords = cache[key];

		if (coords === undefined) {
			const wait = lastRequest + SPACING_MS - Date.now();
			if (wait > 0) await new Promise((r) => setTimeout(r, wait));
			if (signal.aborted) return;
			lastRequest = Date.now();
			coords = await geocodeOne(rec, signal);
			cache[key] = coords;
			saveCache(cache);
		}

		if (coords) {
			rec.lat = coords.lat;
			rec.lon = coords.lon;
			rec.geocode = 'ok';
		} else {
			rec.geocode = 'failed';
			failed++;
		}
		done++;
		onProgress({ done, total: records.length, failed });
	}
}

async function geocodeOne(rec: Rec, signal: AbortSignal): Promise<Coords | null> {
	const params = new URLSearchParams({ format: 'jsonv2', limit: '1' });
	// Structured query — much better hit rate than free-text.
	params.set('street', [rec.houseNumber, rec.street].filter(Boolean).join(' '));
	if (rec.postcode) params.set('postalcode', rec.postcode);
	if (rec.city) params.set('city', rec.city);
	params.set('countrycodes', 'nl');

	try {
		// Browsers set Referer themselves, which identifies us to the service;
		// User-Agent can't be set from client-side JS.
		const res = await fetch(`${ENDPOINT}?${params}`, { signal });
		if (!res.ok) return null;
		const hits: { lat: string; lon: string }[] = await res.json();
		if (!hits.length) return null;
		return { lat: Number(hits[0].lat), lon: Number(hits[0].lon) };
	} catch {
		return null;
	}
}
