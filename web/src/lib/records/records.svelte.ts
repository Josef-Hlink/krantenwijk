/**
 * The in-memory record set. This is the only place uploaded data lives —
 * nothing is persisted anywhere, by design (close the tab, it's gone).
 */

export type GeocodeState = 'n/a' | 'pending' | 'ok' | 'failed';

export interface Rec {
	id: string;
	street?: string;
	houseNumber?: string;
	postcode?: string;
	city?: string;
	lat?: number;
	lon?: number;
	category?: string;
	carrier?: string;
	/** Unmapped upload columns, preserved verbatim for export. */
	extra: Record<string, string>;
	geocode: GeocodeState;
}

export type Bounds = [[number, number], [number, number]]; // [[w,s],[e,n]]

class RecordsStore {
	records = $state<Rec[]>([]);

	located = $derived(this.records.filter((r) => r.lat != null && r.lon != null));
	needGeocode = $derived(
		this.records.filter((r) => (r.lat == null || r.lon == null) && r.geocode !== 'failed')
	);
	failed = $derived(this.records.filter((r) => r.geocode === 'failed'));

	categories = $derived([
		...new Set(this.records.map((r) => r.category).filter((c): c is string => !!c))
	]);

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

	load(records: Rec[]) {
		this.records = records;
	}

	clear() {
		this.records = [];
	}
}

export const recordsStore = new RecordsStore();
