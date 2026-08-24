/**
 * Build a saved round from the live planning stores.
 *
 * This is the privacy chokepoint. The planning model keeps every uploaded
 * column verbatim in `Rec.extra` so export can round-trip them; a saved round
 * must not. `detailsOf()` below reads `recordsStore.shownDetails` and nothing
 * else, so a column the user never ticked "show on map" — a BSN, a birthdate —
 * cannot reach the server or a phone screen, however the caller misuses this.
 *
 * If you add a field here, ask what it looks like on a lockscreen in a stolen
 * coat pocket.
 */
import type { Rec } from '$lib/records/records.svelte';
import { recordsStore } from '$lib/records/records.svelte';
import { bucketsStore } from '$lib/buckets/buckets.svelte';
import { routesStore } from '$lib/routes/routes.svelte';
import type { Round, RoundBucket, Stop } from './types';

function detailsOf(r: Rec): Record<string, string> {
	const details: Record<string, string> = {};
	for (const d of recordsStore.shownDetails) {
		const v = r.extra[d.column]?.trim();
		if (v) details[d.label] = v;
	}
	return details;
}

/**
 * Every stop the round's buckets actually visit, plus its bucket walk order.
 * Unbucketed records are left out — nobody is delivering them.
 */
export function buildRound(name: string): Round {
	const located = new Map(recordsStore.located.map((r) => [r.id, r]));

	const buckets: RoundBucket[] = bucketsStore.list.map((b) => {
		const route = routesStore.results.get(b.id);
		// A routed bucket walks in the computed order; an unrouted one still
		// travels, just unsorted, so a half-planned round is never a dead end.
		const order = (route?.order ?? bucketsStore.memberIds(b.id)).filter((id) =>
			located.has(id)
		);
		const routed = route != null && order.length === route.order.length;
		return {
			id: b.id,
			name: b.name,
			color: b.color,
			carrier: b.carrier ?? null,
			order,
			geometry: routed ? route.geometry : [],
			legs: routed ? (route.legs ?? []) : [],
			distance_m: routed ? route.distance_m : 0,
			duration_s: routed ? route.duration_s : 0
		};
	});

	const visited = new Set(buckets.flatMap((b) => b.order));
	const stops: Stop[] = [...visited].map((id) => {
		const r = located.get(id)!;
		return {
			id: r.id,
			street: r.street ?? null,
			house_number: r.houseNumber ?? null,
			postcode: r.postcode ?? null,
			city: r.city ?? null,
			lat: r.lat!,
			lon: r.lon!,
			details: detailsOf(r)
		};
	});

	return { id: '', name, saved_at: '', stops, buckets };
}
