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
 */
import type { Rec } from '$lib/records/records.svelte';

export const ADDRESS_FIELDS = ['street', 'houseNumber', 'postcode', 'city'] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

export const FIELD_LABELS: Record<AddressField, string> = {
	street: 'street',
	houseNumber: 'house number',
	postcode: 'postcode',
	city: 'city'
};

/** One editable row. Fields are plain strings here; blank means unset. */
export type Draft = { id: string } & Record<AddressField, string>;

export function toDraft(r: Rec): Draft {
	return {
		id: r.id,
		street: r.street ?? '',
		houseNumber: r.houseNumber ?? '',
		postcode: r.postcode ?? '',
		city: r.city ?? ''
	};
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

const same = (a: Draft, b: Draft) => ADDRESS_FIELDS.every((f) => a[f].trim() === b[f].trim());

/** The drafts that differ from what they started as. */
export function changed(drafts: Draft[], originals: Map<string, Draft>): Draft[] {
	return drafts.filter((d) => {
		const o = originals.get(d.id);
		return !o || !same(d, o);
	});
}

/** A draft back onto a record: blank → unset, coordinates dropped, queued for lookup. */
export function applyDraft(r: Rec, d: Draft): Rec {
	const v = (s: string) => (s.trim() === '' ? undefined : s.trim());
	return {
		...r,
		street: v(d.street),
		houseNumber: v(d.houseNumber),
		postcode: v(d.postcode),
		city: v(d.city),
		lat: undefined,
		lon: undefined,
		geocode: 'pending'
	};
}
