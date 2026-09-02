/**
 * Your file back, with the coordinates filled in.
 *
 * Geocoding is the slow, rude step: one address per second to a public
 * OpenStreetMap service, several minutes for a real round, and a third party
 * seeing every address on the way past. Doing it once and keeping the answer
 * turns next year's upload into the fast path the privacy copy already
 * recommends — a CSV that arrives with lat/lon, so nothing leaves the browser
 * at all.
 *
 * Deliberately *not* the sorted export (./sorted.ts). That one is the plan's
 * output: reordered, with bucket, carrier and visit_order prepended. This one
 * is the input, unchanged — same rows, same order, same column names — plus
 * two columns. `straat` stays `straat`.
 */
import Papa from 'papaparse';
import type { Rec } from '$lib/records/records.svelte';
import { recordsStore } from '$lib/records/records.svelte';
import type { Role } from '$lib/csv/mapping.svelte';

/** Six decimals is about 10 cm — far past what a letterbox needs. */
function coord(n: number | undefined): string {
	return n == null ? '' : String(Number(n.toFixed(6)));
}

function roleValue(r: Rec, role: Role): string {
	switch (role) {
		case 'id':
			return r.id;
		case 'street':
			return r.street ?? '';
		case 'house_number':
			return r.houseNumber ?? '';
		case 'postcode':
			return r.postcode ?? '';
		case 'city':
			return r.city ?? '';
		case 'lat':
			return coord(r.lat);
		case 'lon':
			return coord(r.lon);
	}
}

/** A header that isn't taken yet — a file may already have a column called `lat`. */
function freeName(base: string, taken: Set<string>): string {
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) {
		const candidate = `${base}_${i}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Whether there is anything worth saving: coordinates this file did not arrive with. */
export function hasNewCoordinates(): boolean {
	const source = recordsStore.source;
	if (!source) return false;
	// Coordinates in the upload were already the user's; only ones we resolved
	// here are worth handing back.
	return recordsStore.records.some((r) => r.geocode === 'ok');
}

export function buildGeocodedCsv(): string {
	const source = recordsStore.source;
	if (!source) throw new Error('nothing loaded');

	const taken = new Set(source.columns);
	const latCol = source.roles.lat ?? freeName('lat', taken);
	taken.add(latCol);
	const lonCol = source.roles.lon ?? freeName('lon', taken);

	const columns = [...source.columns];
	if (!source.roles.lat) columns.push(latCol);
	if (!source.roles.lon) columns.push(lonCol);

	// Row order is upload order, untouched: this is their file, not our plan.
	const data = recordsStore.records.map((r) => {
		const row: Record<string, string> = { ...r.extra };
		for (const [role, column] of Object.entries(source.roles)) {
			if (column) row[column] = roleValue(r, role as Role);
		}
		row[latCol] = coord(r.lat);
		row[lonCol] = coord(r.lon);
		return columns.map((c) => row[c] ?? '');
	});

	return Papa.unparse({ fields: columns, data });
}

export function downloadGeocodedCsv() {
	const blob = new Blob([buildGeocodedCsv()], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'krantenwijk-with-coordinates.csv';
	a.click();
	URL.revokeObjectURL(url);
}
