/**
 * Auto-seed is a starting point you can take twice. The second run must
 * leave exactly the buckets it made — not those plus the first run's,
 * emptied — and one undo must give the first run back.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { recordsStore, type Rec } from '$lib/records/records.svelte';
import { bucketsStore } from './buckets.svelte';

const rec = (id: string, n: number): Rec => ({
	id,
	street: 'Badhuisstraat',
	houseNumber: String(n),
	lat: 51.44,
	lon: 3.57 + n / 1000,
	extra: {},
	geocode: 'ok'
});

beforeEach(() => {
	recordsStore.clear();
	bucketsStore.clear();
	recordsStore.load([rec('a', 1), rec('b', 2), rec('c', 3), rec('d', 4)]);
});

const seedA = [
	{ id: 'a', bucket: 'bucket-1' },
	{ id: 'b', bucket: 'bucket-1' },
	{ id: 'c', bucket: 'bucket-2' },
	{ id: 'd', bucket: 'bucket-2' }
];
const seedB = [
	{ id: 'a', bucket: 'bucket-1' },
	{ id: 'b', bucket: 'bucket-2' },
	{ id: 'c', bucket: 'bucket-3' },
	{ id: 'd', bucket: 'bucket-3' }
];

describe('seeding again', () => {
	it('replaces the buckets it empties instead of leaving them at zero', () => {
		bucketsStore.applySeed(seedA);
		bucketsStore.applySeed(seedB);
		expect(bucketsStore.list.map((b) => b.name)).toEqual(['bucket-1', 'bucket-2', 'bucket-3']);
		expect(bucketsStore.list.map((b) => bucketsStore.doorCounts.get(b.id))).toEqual([1, 1, 2]);
	});

	it('keeps a hand-made bucket that still has points of its own', () => {
		bucketsStore.createEmpty();
		bucketsStore.assignToActive(['d']);
		bucketsStore.rename(bucketsStore.activeId!, 'mine');
		bucketsStore.applySeed(seedA.slice(0, 3)); // a, b, c — d stays mine
		expect(bucketsStore.list.map((b) => b.name)).toEqual(['mine', 'bucket-1', 'bucket-2']);
	});

	it('is one undo step, first run included', () => {
		bucketsStore.applySeed(seedA);
		bucketsStore.applySeed(seedB);
		bucketsStore.undo();
		expect(bucketsStore.list.map((b) => b.name)).toEqual(['bucket-1', 'bucket-2']);
		expect(bucketsStore.list.map((b) => bucketsStore.doorCounts.get(b.id))).toEqual([2, 2]);
	});
});
