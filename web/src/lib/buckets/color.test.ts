/** Recoloring a bucket is one undo step like any other edit. */
import { describe, expect, it, beforeEach } from 'vitest';
import { recordsStore } from '$lib/records/records.svelte';
import { bucketsStore } from './buckets.svelte';
import { BUCKET_COLORS } from './palette';

beforeEach(() => {
	recordsStore.clear();
	bucketsStore.clear();
	bucketsStore.createEmpty();
});

describe('recoloring', () => {
	it('changes the color and undoes back', () => {
		const id = bucketsStore.activeId!;
		expect(bucketsStore.buckets.get(id)?.color).toBe(BUCKET_COLORS[0]);
		bucketsStore.setColor(id, BUCKET_COLORS[5]);
		expect(bucketsStore.buckets.get(id)?.color).toBe(BUCKET_COLORS[5]);
		expect(bucketsStore.undo()).toBe('recolor bucket');
		expect(bucketsStore.buckets.get(id)?.color).toBe(BUCKET_COLORS[0]);
	});
});
