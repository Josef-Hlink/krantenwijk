import { describe, expect, it } from 'vitest';
import { legTo, snapIndices, type Coord } from './legpath';
import type { WalkStop } from './walk.svelte';

/** Only lat/lon are read; the rest is scaffolding. */
const at = (lon: number, lat: number): WalkStop =>
	({ lon, lat, id: `${lon},${lat}` }) as WalkStop;

describe('snapIndices', () => {
	it('finds each stop on the line', () => {
		const geom: Coord[] = [
			[0, 0],
			[1, 0],
			[2, 0],
			[3, 0]
		];
		expect(snapIndices(geom, [at(0, 0), at(2, 0), at(3, 0)])).toEqual([0, 2, 3]);
	});

	it('snaps to the nearest vertex when the stop sits off the line', () => {
		// a real door is set back from the centre of the street
		const geom: Coord[] = [
			[0, 0],
			[1, 0],
			[2, 0]
		];
		expect(snapIndices(geom, [at(1.02, 0.0001)])).toEqual([1]);
	});

	it('never goes backwards when the route doubles back', () => {
		// down a street and back up it: without a forward-only search the
		// second stop snaps to the outbound half and the leg comes out empty
		const geom: Coord[] = [
			[0, 0],
			[1, 0],
			[2, 0],
			[1, 0],
			[0, 0]
		];
		const idx = snapIndices(geom, [at(0, 0), at(2, 0), at(1, 0), at(0, 0)]);
		expect(idx).toEqual([...idx].sort((a, b) => a - b));
		expect(idx[2]).toBeGreaterThan(idx[1]);
	});

	it('gives consecutive indices to two cards at one door', () => {
		const geom: Coord[] = [
			[0, 0],
			[1, 0],
			[2, 0]
		];
		// identical coordinates: monotonicity must not collapse or reorder them
		const idx = snapIndices(geom, [at(0, 0), at(1, 0), at(1, 0), at(2, 0)]);
		expect(idx).toEqual([0, 1, 1, 2]);
	});

	it('copes with an empty geometry', () => {
		expect(snapIndices([], [at(0, 0)])).toEqual([]);
	});

	it('copes with no stops', () => {
		expect(snapIndices([[0, 0]], [])).toEqual([]);
	});
});

describe('legTo', () => {
	const geom: Coord[] = [
		[0, 0],
		[1, 0],
		[2, 0],
		[3, 0]
	];

	it('returns the stretch walked to reach a stop, ends included', () => {
		expect(legTo(geom, [0, 2, 3], 1)).toEqual([
			[0, 0],
			[1, 0],
			[2, 0]
		]);
	});

	it('is empty for the first stop — nothing has been walked yet', () => {
		expect(legTo(geom, [0, 2, 3], 0)).toEqual([]);
	});

	it('is empty when the round is complete', () => {
		// nextIndex is -1 once every stop is delivered
		expect(legTo(geom, [0, 2, 3], -1)).toEqual([]);
	});

	it('is empty past the end rather than throwing', () => {
		expect(legTo(geom, [0, 2, 3], 9)).toEqual([]);
	});

	it('is empty between two stops that snapped to the same vertex', () => {
		// a second card at one door has no walk of its own to draw
		expect(legTo(geom, [0, 1, 1, 3], 2)).toEqual([]);
	});
});
