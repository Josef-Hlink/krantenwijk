/**
 * The in-memory record set. This is the only place uploaded data lives —
 * nothing is persisted anywhere, by design (close the tab, it's gone).
 */

import { groupStops, type Stop } from './stops';

export type GeocodeState = 'n/a' | 'pending' | 'ok' | 'failed';

export interface Rec {
	id: string;
	street?: string;
	houseNumber?: string;
	postcode?: string;
	city?: string;
	lat?: number;
	lon?: number;
	/** Non-essential upload columns, preserved verbatim for export. */
	extra: Record<string, string>;
	geocode: GeocodeState;
}

/**
 * A non-essential column the user may surface on the map: `label` is the
 * display name (defaults to the column header), `show` puts it in the dot
 * popup. Shown or not, the column itself rides to export via `Rec.extra`.
 */
export interface Detail {
	column: string;
	label: string;
	show: boolean;
}

export type Bounds = [[number, number], [number, number]]; // [[w,s],[e,n]]


class RecordsStore {
	records = $state<Rec[]>([]);
	details = $state<Detail[]>([]);

	located = $derived(this.records.filter((r) => r.lat != null && r.lon != null));
	needGeocode = $derived(
		this.records.filter((r) => (r.lat == null || r.lon == null) && r.geocode !== 'failed')
	);
	failed = $derived(this.records.filter((r) => r.geocode === 'failed'));

	shownDetails = $derived(this.details.filter((d) => d.show));

	/**
	 * The located records grouped into doors. This — not `located` — is the
	 * unit the plan works in: what gets bucketed, clustered, routed, walked
	 * and counted against capacity. Records stay one-per-card so export can
	 * still emit every uploaded row.
	 */
	stops = $derived(groupStops(this.located));

	/** recordId → the key of the door it belongs to. */
	stopOf = $derived.by(() => {
		const m = new Map<string, string>();
		for (const s of this.stops) for (const id of s.recIds) m.set(id, s.key);
		return m;
	});

	byKey = $derived(new Map(this.stops.map((s) => [s.key, s])));

	/** Doors holding more than one card — worth surfacing, easy to miss. */
	multiCard = $derived(this.stops.filter((s) => s.recIds.length > 1));

	/**
	 * Every card at the doors these records belong to. A gesture that catches
	 * one card must take the whole doorstep with it: splitting a household
	 * across buckets would send two of you to the same door.
	 */
	expandToDoors(recIds: Iterable<string>): string[] {
		const keys = new Set<string>();
		for (const id of recIds) {
			const key = this.stopOf.get(id);
			if (key) keys.add(key);
		}
		return [...keys].flatMap((k) => this.byKey.get(k)?.recIds ?? []);
	}

	/**
	 * One point per door, for anything that leaves the browser. The engine
	 * clusters, routes and counts doorsteps — sending it three cards at one
	 * address would spend three of the ~50 waypoints ORS allows on one place
	 * and bill three doorstep visits for one.
	 *
	 * The door is represented by its first card's id, so the engine keeps
	 * seeing nothing but opaque ids and coordinates.
	 */
	doorPoints(recIds?: Iterable<string>): { id: string; lat: number; lon: number }[] {
		const wanted = recIds ? new Set(this.expandToDoors(recIds)) : null;
		return this.stops
			.filter((s) => !wanted || s.recIds.some((id) => wanted.has(id)))
			.map((s) => ({ id: s.recIds[0], lat: s.lat, lon: s.lon }));
	}

	/** The door a record represents, given a representative card's id. */
	doorOf(recId: string): Stop | undefined {
		const key = this.stopOf.get(recId);
		return key ? this.byKey.get(key) : undefined;
	}

	/** Bounding box of located records, for map.fitBounds. */
	bounds = $derived.by<Bounds | null>(() => {
		const pts = this.located;
		if (!pts.length) return null;
		let w = Infinity,
			s = Infinity,
			e = -Infinity,
			n = -Infinity;
		for (const p of pts) {
			w = Math.min(w, p.lon!);
			e = Math.max(e, p.lon!);
			s = Math.min(s, p.lat!);
			n = Math.max(n, p.lat!);
		}
		return [
			[w, s],
			[e, n]
		];
	});

	load(records: Rec[], details: Detail[] = []) {
		this.records = records;
		this.details = details;
	}

	clear() {
		this.records = [];
		this.details = [];
	}
}

export const recordsStore = new RecordsStore();
