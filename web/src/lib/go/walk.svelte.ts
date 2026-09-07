/**
 * The state of walking one bucket of one round.
 *
 * Deliberately separate from recordsStore / bucketsStore / routesStore. Those
 * model an *editable* plan — an undo stack, dirty counters, an inverted
 * assignment map — and their records carry every uploaded column in `extra`.
 * This one consumes a finished, minimal server payload and persists progress,
 * which is the opposite lifecycle contract on both counts. Keeping the types
 * apart is what stops "render all the details" from ever meaning "render the
 * whole file".
 *
 * `/plan` plans a round; this walks one.
 */
import { SvelteSet } from 'svelte/reactivity';
import { NAMEISH } from '$lib/csv/mapping.svelte';
import type { Round, RoundBucket, Stop } from '$lib/rounds/types';
import { readProgress, writeProgress } from './progress';

const WALKING_SPEED_M_S = 1.33; // ~4.8 km/h, the engine's figure
const SERVICE_TIME_S = 45; // reaching the door and dropping the card

/** How much of the round the list shows around where you are. */
export const BEHIND = 3;
export const AHEAD = 6;

export interface WalkStop extends Stop {
	/** 1-based position in the walk. */
	seq: number;
	/** Distance/duration to the next stop; null on the last one. */
	legToNext: { distance_m: number; duration_s: number } | null;
	/**
	 * Who lives here, deduplicated. Cards are not people: a resident called
	 * up for both krant and folder holds two cards at one address, and you
	 * still only want to read one name off the screen.
	 */
	names: string[];
	/** How many cards to post here — what is actually in your hand. */
	cardCount: number;
}

/** The name on a card, if one of the shown columns looks like a name. */
function nameOf(details: Record<string, string>): string | null {
	const entries = Object.entries(details);
	const hit = entries.find(([label]) => NAMEISH.includes(label.trim().toLowerCase()));
	// Fall back to the only shown column: if the user ticked exactly one it is
	// overwhelmingly likely to be the name they deliver by.
	const pick = hit ?? (entries.length === 1 ? entries[0] : undefined);
	return pick?.[1]?.trim() || null;
}

/**
 * How a doorstep's residents read on one line. Two names both show — that is
 * the case worth seeing, a couple at one address. Beyond that the line would
 * wrap and stop being scannable, so it collapses to a count.
 */
export function nameLine(names: string[]): string {
	if (names.length === 0) return '';
	if (names.length <= 2) return names.join(', ');
	return `${names[0]} + ${names.length - 1} more`;
}

class WalkStore {
	round = $state<Round | null>(null);
	bucketId = $state<string | null>(null);
	delivered = $state(new SvelteSet<string>());
	/** When progress was last written, so the UI can say so. 0 = never. */
	updatedAt = $state(0);

	bucket = $derived<RoundBucket | null>(
		this.round?.buckets.find((b) => b.id === this.bucketId) ?? null
	);

	stops = $derived.by<WalkStop[]>(() => {
		const round = this.round;
		const bucket = this.bucket;
		if (!round || !bucket) return [];
		const byId = new Map(round.stops.map((s) => [s.id, s]));
		return bucket.order.flatMap((id, i) => {
			const stop = byId.get(id);
			if (!stop) return [];
			return [
				{
					...stop,
					seq: i + 1,
					legToNext: bucket.legs[i] ?? null,
					names: [
						...new Set(
							(stop.cards ?? []).map(nameOf).filter((x) => x != null)
						)
					],
					cardCount: (stop.cards ?? []).length
				}
			];
		});
	});

	total = $derived(this.stops.length);
	/** Cards, not doors — what you are actually carrying. */
	totalCards = $derived(this.stops.reduce((n, s) => n + Math.max(s.cardCount, 1), 0));
	doneCount = $derived(this.stops.filter((s) => this.delivered.has(s.id)).length);

	/**
	 * The first stop not yet delivered — not a counter. Houses get skipped and
	 * come back to, so position has to be derived from what is actually done.
	 * -1 once the whole bucket is walked.
	 */
	nextIndex = $derived(this.stops.findIndex((s) => !this.delivered.has(s.id)));
	next = $derived(this.nextIndex >= 0 ? this.stops[this.nextIndex] : null);
	complete = $derived(this.total > 0 && this.nextIndex < 0);

	/** The rolling window the list shows: a few behind, several ahead. */
	window = $derived.by<WalkStop[]>(() => {
		if (!this.total) return [];
		// Once complete, show the tail rather than slicing from a negative index.
		const anchor = this.nextIndex >= 0 ? this.nextIndex : this.total;
		const from = Math.max(0, anchor - BEHIND);
		return this.stops.slice(from, anchor + AHEAD);
	});

	/** Metres still to walk, from the next stop onward. */
	remainingM = $derived.by(() => {
		if (this.nextIndex < 0) return 0;
		return this.stops
			.slice(this.nextIndex)
			.reduce((m, s) => m + (s.legToNext?.distance_m ?? 0), 0);
	});

	/**
	 * Seconds still to go: the remaining walk plus a fixed cost per door.
	 * Matches the engine's estimate model (see estimate.py) rather than
	 * prorating the bucket total, so skipping ahead doesn't skew it.
	 */
	remainingS = $derived.by(() => {
		if (this.nextIndex < 0) return 0;
		const left = this.total - this.doneCount;
		return this.remainingM / WALKING_SPEED_M_S + left * SERVICE_TIME_S;
	});

	/**
	 * The single entry point. Resets everything and reloads progress, so a
	 * client-side navigation between rounds or buckets can never leave one
	 * walk's delivered ids attached to another.
	 */
	open(round: Round, bucketId: string) {
		this.round = round;
		this.bucketId = bucketId;
		const saved = readProgress(round.id, bucketId);
		this.delivered = new SvelteSet(saved?.delivered ?? []);
		this.updatedAt = saved?.updatedAt ?? 0;
	}

	close() {
		this.round = null;
		this.bucketId = null;
		this.delivered = new SvelteSet();
		this.updatedAt = 0;
	}

	private persist() {
		if (!this.round || !this.bucketId) return;
		this.updatedAt = writeProgress(this.round.id, this.bucketId, this.delivered);
	}

	/** One-way on purpose: a fat-fingered double tap must not undeliver. */
	markDelivered(stopId: string) {
		if (this.delivered.has(stopId)) return;
		this.delivered.add(stopId);
		this.persist();
	}

	/** Undo lives only on rows you can see are already ticked. */
	undeliver(stopId: string) {
		if (!this.delivered.delete(stopId)) return;
		this.persist();
	}

	resetProgress() {
		this.delivered = new SvelteSet();
		this.persist();
	}
}

export const walkStore = new WalkStore();

/** Metres, as you'd say them out loud. */
export function fmtM(m: number): string {
	if (m < 1000) return `${Math.round(m)} m`;
	return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** Coarse walking time. */
export function fmtMin(s: number): string {
	const min = Math.round(s / 60);
	if (min < 60) return `${min} min`;
	return `${Math.floor(min / 60)} u ${min % 60}`;
}
