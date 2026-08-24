/**
 * Doors, not cards.
 *
 * One uploaded row is one card. A household can hold several — two parents
 * called up in the same round, a couple of flats behind one entrance — and
 * every one of them is a separate row with its own opaque id. But you walk to
 * the door once, so a *stop* is a door, and it carries the cards delivered
 * there.
 *
 * Grouping is on the normalised address, not the coordinate: it is what you
 * read off the card, and it survives geocoding jitter nudging two rows a few
 * metres apart. The trade is that flats numbered separately (`18-G9`,
 * `18-G10`) stay separate stops even behind one entrance — deliberate, since
 * they are separate letterboxes.
 *
 * Records that cannot be addressed — a coords-only upload — each become their
 * own stop, so nothing is ever silently merged on a missing key.
 */
import type { Rec } from './records.svelte';

export interface Stop {
	/** Grouping key; stable across reloads of the same file. */
	key: string;
	/** Every card at this door, in upload order. At least one. */
	recIds: string[];
	lat: number;
	lon: number;
	street?: string;
	houseNumber?: string;
	postcode?: string;
	city?: string;
}

const norm = (s: string | undefined) =>
	(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The door a record belongs to. Unaddressable records get a key of their own. */
export function stopKey(r: Rec): string {
	const street = norm(r.street);
	const number = norm(r.houseNumber);
	if (!street || !number) return `#${r.id}`;
	return `${street}|${number}|${norm(r.postcode)}`;
}

/**
 * Group located records into doors, preserving upload order both of the doors
 * and of the cards within each. The first card's coordinate wins — rows at one
 * address can differ by a metre or two after geocoding, and picking one beats
 * averaging into a point that matches nothing.
 */
export function groupStops(records: Rec[]): Stop[] {
	const byKey = new Map<string, Stop>();
	for (const r of records) {
		if (r.lat == null || r.lon == null) continue;
		const key = stopKey(r);
		const existing = byKey.get(key);
		if (existing) {
			existing.recIds.push(r.id);
			continue;
		}
		byKey.set(key, {
			key,
			recIds: [r.id],
			lat: r.lat,
			lon: r.lon,
			street: r.street,
			houseNumber: r.houseNumber,
			postcode: r.postcode,
			city: r.city
		});
	}
	return [...byKey.values()];
}

/** The address as it reads on a card. */
export function stopAddress(s: {
	street?: string;
	houseNumber?: string;
	key?: string;
}): string {
	return [s.street, s.houseNumber].filter(Boolean).join(' ') || (s.key ?? '');
}
