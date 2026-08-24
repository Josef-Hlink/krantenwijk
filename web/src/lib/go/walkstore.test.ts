/**
 * The walking state machine: which doorstep is next, what the rolling window
 * shows, and what a tick does. This is what you are actually looking at on a
 * dark street, so its edges matter more than its happy path.
 *
 * Runs without localStorage (node), which incidentally exercises the private
 * browsing path: progress must degrade to in-memory, never throw.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AHEAD, BEHIND, walkStore } from './walk.svelte';
import type { Round } from '$lib/rounds/types';

/** `n` doors 10m apart, the 2nd holding a couple, the 4th one repeat call-up. */
function round(n: number): Round {
	const stops = Array.from({ length: n }, (_, i) => ({
		id: `s${i}`,
		street: 'Teststraat',
		house_number: `${i + 1}`,
		postcode: null,
		city: 'Vlissingen',
		lat: 51.44 + i * 1e-4,
		lon: 3.57,
		cards:
			i === 1
				? [{ naam: 'Roos Smits' }, { naam: 'Teun Smits' }]
				: i === 3
					? [{ naam: 'Lieke de Vries' }, { naam: 'Lieke de Vries' }]
					: [{ naam: `Bewoner ${i}` }]
	}));
	return {
		id: 'r1',
		name: 'Test',
		saved_at: '2026-08-24T10:00:00+00:00',
		stops,
		buckets: [
			{
				id: 'b1',
				name: 'bucket 1',
				color: '#1f6feb',
				carrier: null,
				order: stops.map((s) => s.id),
				geometry: [],
				legs: stops.slice(1).map(() => ({ distance_m: 10, duration_s: 8 })),
				distance_m: 10 * (n - 1),
				duration_s: 8 * (n - 1)
			}
		]
	};
}

beforeEach(() => {
	walkStore.close();
	walkStore.open(round(20), 'b1');
	walkStore.resetProgress();
});

describe('reading a door', () => {
	it('deduplicates names, because cards are not people', () => {
		// one resident due both griep and pneum holds two cards at one address
		expect(walkStore.stops[3].names).toEqual(['Lieke de Vries']);
		expect(walkStore.stops[3].cardCount).toBe(2);
	});

	it('keeps two residents at one address distinct', () => {
		expect(walkStore.stops[1].names).toEqual(['Roos Smits', 'Teun Smits']);
		expect(walkStore.stops[1].cardCount).toBe(2);
	});

	it('numbers doors from one', () => {
		expect(walkStore.stops.map((s) => s.seq).slice(0, 3)).toEqual([1, 2, 3]);
	});

	it('counts cards, not doors, for what you carry', () => {
		expect(walkStore.total).toBe(20);
		expect(walkStore.totalCards).toBe(22);
	});
});

describe('where you are', () => {
	it('starts at the first door', () => {
		expect(walkStore.nextIndex).toBe(0);
		expect(walkStore.next?.id).toBe('s0');
	});

	it('advances as doors are delivered', () => {
		walkStore.markDelivered('s0');
		expect(walkStore.next?.id).toBe('s1');
	});

	it('stays put when you skip ahead — next is the first *undelivered*', () => {
		// nobody home at door 1, so you post door 5 and come back
		walkStore.markDelivered('s4');
		expect(walkStore.next?.id).toBe('s0');
		expect(walkStore.doneCount).toBe(1);
	});

	it('steps over an already-delivered door when you reach it', () => {
		walkStore.markDelivered('s1');
		walkStore.markDelivered('s0');
		expect(walkStore.next?.id).toBe('s2');
	});

	it('reports completion once every door is done', () => {
		for (const s of walkStore.stops) walkStore.markDelivered(s.id);
		expect(walkStore.complete).toBe(true);
		expect(walkStore.nextIndex).toBe(-1);
		expect(walkStore.next).toBeNull();
	});
});

describe('the rolling window', () => {
	it('shows only what is ahead at the start', () => {
		expect(walkStore.window.map((s) => s.seq)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('keeps a few delivered doors behind you once you are underway', () => {
		for (let i = 0; i < 8; i++) walkStore.markDelivered(`s${i}`);
		const seqs = walkStore.window.map((s) => s.seq);
		expect(seqs[0]).toBe(9 - BEHIND);
		expect(seqs).toContain(9);
		expect(seqs.length).toBeLessThanOrEqual(BEHIND + AHEAD);
	});

	it('never slices from a negative index when the round is complete', () => {
		// nextIndex is -1 here; a naive slice would return the whole round
		for (const s of walkStore.stops) walkStore.markDelivered(s.id);
		expect(walkStore.window.length).toBe(BEHIND);
		expect(walkStore.window.at(-1)?.seq).toBe(20);
	});
});

describe('ticking', () => {
	it('is one-way: delivering twice changes nothing', () => {
		walkStore.markDelivered('s0');
		walkStore.markDelivered('s0');
		expect(walkStore.doneCount).toBe(1);
	});

	it('can be undone deliberately', () => {
		walkStore.markDelivered('s0');
		walkStore.undeliver('s0');
		expect(walkStore.doneCount).toBe(0);
		expect(walkStore.next?.id).toBe('s0');
	});

	it('ignores an undo of something never delivered', () => {
		walkStore.undeliver('s5');
		expect(walkStore.doneCount).toBe(0);
	});

	it('ticks a whole doorstep at once, however many cards', () => {
		walkStore.markDelivered('s1');
		expect(walkStore.doneCount).toBe(1);
		expect(walkStore.next?.id).toBe('s0');
	});
});

describe('distance left', () => {
	it('counts only what is still ahead', () => {
		expect(walkStore.remainingM).toBe(190);
		walkStore.markDelivered('s0');
		expect(walkStore.remainingM).toBe(180);
	});

	it('is zero once complete', () => {
		for (const s of walkStore.stops) walkStore.markDelivered(s.id);
		expect(walkStore.remainingM).toBe(0);
		expect(walkStore.remainingS).toBe(0);
	});
});

describe('switching rounds', () => {
	it('does not carry progress across', () => {
		walkStore.markDelivered('s0');
		walkStore.open(round(5), 'b1');
		expect(walkStore.doneCount).toBe(0);
		expect(walkStore.total).toBe(5);
	});

	it('survives a round whose stops carry no shown columns', () => {
		const bare = round(3);
		bare.stops.forEach((s) => (s.cards = []));
		walkStore.open(bare, 'b1');
		expect(walkStore.stops[0].names).toEqual([]);
		expect(walkStore.stops[0].cardCount).toBe(0);
	});

	it('ignores a bucket that is not in the round', () => {
		walkStore.open(round(3), 'nope');
		expect(walkStore.stops).toEqual([]);
		expect(walkStore.complete).toBe(false);
	});
});
