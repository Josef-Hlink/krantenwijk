/**
 * A deactivated door leaves the round but not the map. It must drop out of
 * everything the plan computes over — doors, bucket membership, the points
 * sent to the engine — and one undo must bring all of that back at once.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { recordsStore, type Rec } from '$lib/records/records.svelte';
import { bucketsStore } from './buckets.svelte';

const rec = (id: string, houseNumber: string): Rec => ({
	id,
	street: 'Badhuisstraat',
	houseNumber,
	lat: 51.44,
	lon: 3.57 + Number(houseNumber) / 1000,
	extra: {},
	geocode: 'ok'
});

beforeEach(() => {
	recordsStore.clear();
	bucketsStore.clear();
	// two cards at number 12, one at 14
	recordsStore.load([rec('a', '12'), rec('b', '12'), rec('c', '14')]);
	bucketsStore.createEmpty();
	bucketsStore.assignToActive(['a', 'b', 'c']);
});

describe('deactivating a door', () => {
	it('takes the whole door out of the round', () => {
		bucketsStore.deactivate(recordsStore.cardsAt('a'));
		expect(recordsStore.stops.map((s) => s.houseNumber)).toEqual(['14']);
		expect(recordsStore.deactivatedStops.map((s) => s.houseNumber)).toEqual(['12']);
	});

	it('leaves its bucket', () => {
		const bucketId = bucketsStore.activeId!;
		bucketsStore.deactivate(recordsStore.cardsAt('a'));
		expect(bucketsStore.memberIds(bucketId)).toEqual(['c']);
		expect(bucketsStore.doorCounts.get(bucketId)).toBe(1);
	});

	it('is not among the points sent to the engine', () => {
		bucketsStore.deactivate(recordsStore.cardsAt('c'));
		expect(recordsStore.doorPoints().map((p) => p.id)).toEqual(['a']);
	});

	it('cannot be toggled back into a bucket by accident', () => {
		bucketsStore.deactivate(recordsStore.cardsAt('c'));
		bucketsStore.toggleDoor(recordsStore.expandToDoors(['c']));
		expect(bucketsStore.assignment.has('c')).toBe(false);
	});

	it('keeps the record itself, so export still has the row', () => {
		bucketsStore.deactivate(recordsStore.cardsAt('c'));
		expect(recordsStore.records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
		expect(recordsStore.doorOf('c')?.houseNumber).toBe('14');
	});
});

describe('bringing it back', () => {
	it('reactivates unassigned', () => {
		bucketsStore.deactivate(recordsStore.cardsAt('a'));
		bucketsStore.reactivate(recordsStore.cardsAt('a'));
		expect(recordsStore.stops).toHaveLength(2);
		expect(bucketsStore.assignment.has('a')).toBe(false);
	});

	it('undo restores the door and its bucket in one step', () => {
		const bucketId = bucketsStore.activeId!;
		bucketsStore.deactivate(recordsStore.cardsAt('a'));
		expect(bucketsStore.undo()).toBe('deactivate door');
		expect(recordsStore.stops).toHaveLength(2);
		expect(bucketsStore.memberIds(bucketId).sort()).toEqual(['a', 'b', 'c']);
	});

	it('is forgotten when a new file is loaded', () => {
		bucketsStore.deactivate(recordsStore.cardsAt('a'));
		recordsStore.load([rec('x', '1')]);
		expect(recordsStore.deactivatedStops).toHaveLength(0);
	});
});
