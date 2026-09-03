/**
 * Fixing the addresses the geocoder gave up on.
 *
 * A failed lookup is nearly always a spelling the map does not know — an
 * export that says `Ruijter` where the street sign says `Ruyter` — and it
 * tends to be the same slip on twenty rows. So the fix screen is a small
 * table you edit in place, with a find-and-replace across the failed rows
 * so twenty slips are one gesture. Only the rows you actually changed go
 * back to the geocoder; the rest stay marked failed rather than being asked
 * again with the same answer.
 *
 * An edit is a *lookup* address, not a correction of the file. `90-022`
 * stays `90-022` on the record, in the export and on the card; only the
 * query to the geocoder says `90`. The file is theirs; we are only trying
 * to find the door.
 */
import type { Address, Rec } from '$lib/records/records.svelte';

export const ADDRESS_FIELDS = ['street', 'houseNumber', 'postcode', 'city'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export const FIELD_LABELS: Record<AddressField, string> = {
	street: 'street',
	houseNumber: 'house number',
	postcode: 'postcode',
	city: 'city'
};

/**
 * One editable row. Fields are plain strings here; blank means unset. A
 * lat/lon typed in wins over the address: that row is placed, not looked up.
 */
export type Draft = { id: string; lat: string; lon: string } & Record<AddressField, string>;

/** The row as it will be looked up: an earlier correction if there is one. */
export function toDraft(r: Rec): Draft {
	const a: Address = r.lookup ?? r;
	return {
		id: r.id,
		street: a.street ?? '',
		houseNumber: a.houseNumber ?? '',
		postcode: a.postcode ?? '',
		city: a.city ?? '',
		lat: '',
		lon: ''
	};
}

/** A coordinate as typed, `51,44` included; undefined when it isn't one. */
function coord(s: string): number | undefined {
	const t = s.trim().replace(',', '.');
	if (!t) return undefined;
	const n = Number(t);
	return isFinite(n) ? n : undefined;
}

/**
 * A pasted "51.4459718828098, 3.581524284657911" — what Google Maps puts
 * on the clipboard when you right-click a pin — split into its two halves.
 * A lone "51,44" is a decimal comma, not a pair, and is left alone.
 */
export function splitPair(s: string): [string, string] | null {
	const t = s.trim();
	// Two decimals with points, or two numbers with a space after the comma:
	// either is unmistakably a pair. "51,4459" is neither.
	const m =
		t.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/) ??
		t.match(/^(-?\d+(?:\.\d+)?),\s+(-?\d+(?:\.\d+)?)$/);
	return m ? [m[1], m[2]] : null;
}

/** Where to look the door up by eye. Sends the address to Google — the user's click, not ours. */
export function googleMapsUrl(d: Draft): string {
	const q = [[d.street, d.houseNumber].filter(Boolean).join(' '), d.postcode, d.city]
		.map((s) => s.trim())
		.filter(Boolean)
		.join(', ');
	return `https://www.google.com/maps/place/${encodeURIComponent(q).replace(/%20/g, '+')}`;
}

/** Whether a draft carries a usable coordinate pair. */
export function hasCoords(d: Draft): boolean {
	return coord(d.lat) != null && coord(d.lon) != null;
}

/** Rows where `find` occurs in `field`. Literal, case-sensitive: what you typed is what changes. */
export function matching(drafts: Draft[], field: AddressField, find: string): Draft[] {
	if (!find) return [];
	return drafts.filter((d) => d[field].includes(find));
}

export function replaceIn(
	drafts: Draft[],
	field: AddressField,
	find: string,
	replacement: string
): Draft[] {
	if (!find) return drafts;
	return drafts.map((d) =>
		d[field].includes(find) ? { ...d, [field]: d[field].replaceAll(find, replacement) } : d
	);
}

const same = (a: Draft, b: Draft) =>
	ADDRESS_FIELDS.every((f) => a[f].trim() === b[f].trim()) && !hasCoords(a);

/** The drafts that differ from what they started as. */
export function changed(drafts: Draft[], originals: Map<string, Draft>): Draft[] {
	return drafts.filter((d) => {
		const o = originals.get(d.id);
		return !o || !same(d, o);
	});
}

/**
 * A draft back onto a record. With a coordinate pair typed in, the record is
 * simply placed there. Otherwise the draft becomes the record's lookup
 * address, coordinates dropped and the record queued again. The record's own
 * fields are never touched; a draft that matches the file's own address
 * again just clears the lookup.
 */
export function applyDraft(r: Rec, d: Draft): Rec {
	if (hasCoords(d)) {
		return { ...r, lat: coord(d.lat), lon: coord(d.lon), geocode: 'manual' };
	}
	const v = (s: string) => (s.trim() === '' ? undefined : s.trim());
	const lookup: Address = {
		street: v(d.street),
		houseNumber: v(d.houseNumber),
		postcode: v(d.postcode),
		city: v(d.city)
	};
	const own = ADDRESS_FIELDS.every((f) => lookup[f] === r[f]);
	const { lookup: _, ...rest } = r;
	return {
		...rest,
		...(own ? {} : { lookup }),
		lat: undefined,
		lon: undefined,
		geocode: 'pending'
	};
}
