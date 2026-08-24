/**
 * Recovering individual legs from the bucket's single densified polyline.
 *
 * The route arrives as one continuous [lon, lat] line with no waypoint
 * indices — ORS returns `way_points` alongside `segments`, but the engine
 * keeps only the distances. Rather than change the payload (and force every
 * saved round to be re-saved), each stop is snapped onto its nearest vertex.
 *
 * The search is *monotone*: stop N+1 is only ever looked for at or after where
 * stop N landed. Without that, a round that doubles back down the same street
 * snaps two different stops to the same vertex and the slice comes out empty
 * or reversed. For the keyless fallback engine the geometry IS the stop list,
 * so the snap is exact.
 */
import type { WalkStop } from './walk.svelte';

export type Coord = [number, number];

/** Index into `geometry` of the vertex nearest each stop, in visit order. */
export function snapIndices(geometry: Coord[], stops: WalkStop[]): number[] {
	if (geometry.length === 0) return [];
	const out: number[] = [];
	let from = 0;
	for (const s of stops) {
		let best = from;
		let bestD = Infinity;
		for (let i = from; i < geometry.length; i++) {
			// squared degrees is monotonic with distance at this scale, and
			// this runs per bucket — no need for haversine here
			const dx = geometry[i][0] - s.lon;
			const dy = geometry[i][1] - s.lat;
			const d = dx * dx + dy * dy;
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		out.push(best);
		from = best;
	}
	return out;
}

/**
 * The stretch of route walked to reach `index` — i.e. from the stop before it.
 * Empty for the first stop: nothing has been walked yet.
 */
export function legTo(geometry: Coord[], snapped: number[], index: number): Coord[] {
	if (index <= 0 || index >= snapped.length) return [];
	const from = snapped[index - 1];
	const to = snapped[index];
	if (to <= from) return [];
	return geometry.slice(from, to + 1);
}
