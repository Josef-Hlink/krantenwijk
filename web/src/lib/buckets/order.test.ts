/**
 * Rail order is round order: it ranks the export and the list a phone picks
 * from. Moving a bucket is one undo step, and undoing a delete puts the
 * bucket back in its slot, not at the bottom.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { recordsStore } from '$lib/records/records.svelte';
import { bucketsStore } from './buckets.svelte';

const names = () => bucketsStore.list.map((b) => b.name);
const idOf = (name: string) => bucketsStore.list.find((b) => b.name === name)!.id;

beforeEach(() => {
	recordsStore.clear();
	bucketsStore.clear();
	for (const n of ['a', 'b', 'c', 'd']) {
		bucketsStore.createEmpty();
		bucketsStore.rename(bucketsStore.activeId!, n);
	}
});

describe('reordering', () => {
	it('moves a bucket down into the slot it was dropped on', () => {
		bucketsStore.move(idOf('a'), 2);
		expect(names()).toEqual(['b', 'c', 'a', 'd']);
	});

	it('moves a bucket up into the slot it was dropped on', () => {
		bucketsStore.move(idOf('d'), 1);
		expect(names()).toEqual(['a', 'd', 'b', 'c']);
	});

	it('is one undo step and keeps the buckets themselves', () => {
		const d = idOf('d');
		bucketsStore.setCarrier(d, 'josef');
		bucketsStore.move(d, 0);
		expect(names()).toEqual(['d', 'a', 'b', 'c']);
		expect(bucketsStore.buckets.get(d)?.carrier).toBe('josef');
		expect(bucketsStore.undo()).toBe('reorder buckets');
		expect(names()).toEqual(['a', 'b', 'c', 'd']);
		bucketsStore.redo();
		expect(names()).toEqual(['d', 'a', 'b', 'c']);
	});

	it('does nothing (and records nothing) when dropped on itself', () => {
		bucketsStore.move(idOf('b'), 1);
		expect(names()).toEqual(['a', 'b', 'c', 'd']);
		expect(bucketsStore.undo()).toBe('rename bucket');
	});

	it('undoing a delete puts the bucket back where it was', () => {
		bucketsStore.remove(idOf('b'));
		expect(names()).toEqual(['a', 'c', 'd']);
		bucketsStore.undo();
		expect(names()).toEqual(['a', 'b', 'c', 'd']);
	});
});
