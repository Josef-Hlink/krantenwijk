/**
 * The in-memory record set. This is the only place uploaded data lives —
 * nothing is persisted anywhere, by design (close the tab, it's gone).
 */

import { SvelteSet } from 'svelte/reactivity';
import { groupStops, type Stop } from './stops';
// Type-only, so the cycle with mapping.svelte.ts is erased at compile time.
import type { Role } from '$lib/csv/mapping.svelte';

/** `manual`: put on the map by hand — a street too new for the geocoder. */
export type GeocodeState = 'n/a' | 'pending' | 'ok' | 'failed' | 'manual';

/** The address fields of a record, as a unit. */
export interface Address {
	street?: string;
	houseNumber?: string;
	postcode?: string;
	city?: string;
}

export interface Rec extends Address {
	id: string;
	lat?: number;
	lon?: number;
	/**
	 * The address to look up instead of the record's own, when the file's
	 * spelling is one the map does not know. The record's own fields stay
	 * what the file said — that is what the export hands back and what the
	 * carrier reads off the card — this only steers the geocoder.
	 */
	lookup?: Address;
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

/**
 * The uploaded file's own shape: its column headers, in their original order,
 * and which of them the user mapped onto each role.
 *
 * Kept so the file can be handed back as *theirs* — `straat` staying `straat`
 * — rather than reissued under our canonical names. See $lib/export/geocoded.
 */
export interface Source {
	columns: string[];
	roles: Partial<Record<Role, string>>;
	/** The columns that together identify a row; empty when ids were generated. */
	idColumns: string[];
}

export type Bounds = [[number, number], [number, number]]; // [[w,s],[e,n]]


class RecordsStore {
	records = $state<Rec[]>([]);
	details = $state<Detail[]>([]);
	source = $state<Source | null>(null);
	/**
	 * Cards taken out of the round without being deleted: a door that moved
	 * away, a card that came back, an entry you are not walking this year.
	 * They stay on the map, greyed, so a slip is visible and undoable — a dot
	 * that vanishes is a dot you cannot get back. Always whole doors.
	 */
	skipped = $state(new SvelteSet<string>());

	located = $derived(this.records.filter((r) => r.lat != null && r.lon != null));
	needGeocode = $derived(
		this.records.filter((r) => (r.lat == null || r.lon == null) && r.geocode !== 'failed')
	);
	failed = $derived(this.records.filter((r) => r.geocode === 'failed'));

	shownDetails = $derived(this.details.filter((d) => d.show));

	/** Every located door, whether or not it is in the round. */
	allStops = $derived(groupStops(this.located));

	/**
	 * The doors in the round. This — not `located` — is the unit the plan
	 * works in: what gets bucketed, clustered, routed, walked and counted
	 * against capacity. Records stay one-per-card so export can still emit
	 * every uploaded row. A skipped door is not here, so nothing
	 * downstream can seed, bucket or route it.
	 */
	stops = $derived(this.allStops.filter((s) => !this.isSkippedDoor(s)));

	/** The doors taken out — drawn grey, still clickable to bring back. */
	skippedStops = $derived(this.allStops.filter((s) => this.isSkippedDoor(s)));

	/** recordId → the key of the door it belongs to, live doors only. */
	stopOf = $derived.by(() => {
		const m = new Map<string, string>();
		for (const s of this.stops) for (const id of s.recIds) m.set(id, s.key);
		return m;
	});

	/** recordId → door key, every door. For looking a dot up, not for acting on it. */
	private doorKey = $derived.by(() => {
		const m = new Map<string, string>();
		for (const s of this.allStops) for (const id of s.recIds) m.set(id, s.key);
		return m;
	});

	byKey = $derived(new Map(this.allStops.map((s) => [s.key, s])));

	private isSkippedDoor(s: Stop): boolean {
		return s.recIds.some((id) => this.skipped.has(id));
	}

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

	/** The door a record belongs to, in the round or not. */
	doorOf(recId: string): Stop | undefined {
		const key = this.doorKey.get(recId);
		return key ? this.byKey.get(key) : undefined;
	}

	/** Every card at a record's door, in the round or not. */
	cardsAt(recId: string): string[] {
		return this.doorOf(recId)?.recIds ?? [recId];
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

	/** Put cards at a point by hand. Every card at a door moves together. */
	place(recIds: string[], lat: number, lon: number) {
		const ids = new Set(recIds);
		this.records = this.records.map((r) =>
			ids.has(r.id) ? { ...r, lat, lon, geocode: 'manual' as const } : r
		);
	}

	/**
	 * Replace records by id — how a corrected address gets back in. Records
	 * are plain objects in a state array, so a fresh array is what makes the
	 * derived views notice.
	 */
	replace(updated: Rec[]) {
		const byId = new Map(updated.map((r) => [r.id, r]));
		this.records = this.records.map((r) => byId.get(r.id) ?? r);
	}

	load(
		records: Rec[],
		details: Detail[] = [],
		source: Source | null = null,
		skipped: Iterable<string> = []
	) {
		this.records = records;
		this.details = details;
		this.source = source;
		this.skipped = new SvelteSet(skipped);
	}

	clear() {
		this.records = [];
		this.details = [];
		this.source = null;
		this.skipped = new SvelteSet();
	}
}

export const recordsStore = new RecordsStore();
