/**
 * The saved-round payload — the one shape in this app that deliberately
 * carries personal data.
 *
 * Everything else the engine sees is coordinates keyed by an opaque id. A
 * round is different by necessity: a phone out on the round has to show the
 * street, the house number and the resident's name so the carrier can match
 * the screen against the card in their hand.
 *
 * The fence is `cards`. Each holds *only* the columns the user ticked "show
 * on map" during column mapping, already resolved to the labels they chose —
 * never the full `Rec.extra` bag. That is what keeps a `bsn` column in the
 * upload from ever reaching a phone screen. `buildRound()` in ./serialize.ts
 * is the single place that rule is applied; keep it that way.
 */

export interface Stop {
	id: string;
	street?: string | null;
	house_number?: string | null;
	postcode?: string | null;
	city?: string | null;
	lat: number;
	lon: number;
	/**
	 * One entry per card delivered at this door — a household called up twice
	 * is one stop with two cards. Each holds the shown detail columns only,
	 * keyed by the label the user chose.
	 */
	cards: Record<string, string>[];
}

export interface RoundLeg {
	distance_m: number;
	duration_s: number;
}

export interface RoundBucket {
	id: string;
	name: string;
	color: string;
	carrier?: string | null;
	/** Stop ids in visit order. */
	order: string[];
	/** [lon, lat] pairs, GeoJSON axis order. */
	geometry: [number, number][];
	/** One per consecutive pair in `order`, so `length === order.length - 1`. */
	legs: RoundLeg[];
	distance_m: number;
	duration_s: number;
}

export interface Round {
	id: string;
	name: string;
	saved_at: string;
	stops: Stop[];
	buckets: RoundBucket[];
}

/** Listing shape: enough to pick a round, with no address or name in it. */
export interface RoundSummary {
	id: string;
	name: string;
	saved_at: string;
	n_stops: number;
	n_buckets: number;
}

/** The address line as it should read on a card. */
export function addressOf(stop: Stop): string {
	return [stop.street, stop.house_number].filter(Boolean).join(' ') || stop.id;
}
