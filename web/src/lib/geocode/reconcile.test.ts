import { describe, expect, it } from 'vitest';
import type { Rec } from '$lib/records/records.svelte';
import { applyDraft, changed, matching, replaceIn, toDraft, type Draft } from './reconcile';

const draft = (id: string, street: string, houseNumber = '1'): Draft => ({
	id,
	street,
	houseNumber,
	postcode: '',
	city: 'Vlissingen'
});

const failed = [
	draft('a', 'Boulevard de Ruijter', '30'),
	draft('b', 'Boulevard de Ruijter', '72'),
	draft('c', 'Badhuisstraat', '12')
];

describe('find and replace', () => {
	it('finds the rows the text occurs in', () => {
		expect(matching(failed, 'street', 'Ruijter').map((d) => d.id)).toEqual(['a', 'b']);
	});

	it('matches nothing on an empty needle', () => {
		expect(matching(failed, 'street', '')).toEqual([]);
	});

	it('replaces in the chosen field only, leaving other rows alone', () => {
		const out = replaceIn(failed, 'street', 'Ruijter', 'Ruyter');
		expect(out.map((d) => d.street)).toEqual([
			'Boulevard de Ruyter',
			'Boulevard de Ruyter',
			'Badhuisstraat'
		]);
		expect(out[2]).toBe(failed[2]); // untouched rows keep their identity
	});

	it('is literal and case-sensitive', () => {
		expect(replaceIn(failed, 'street', 'ruijter', 'x')).toEqual(failed);
	});
});

describe('what goes back to the geocoder', () => {
	const originals = new Map(failed.map((d) => [d.id, d]));

	it('is only the rows that differ from how they started', () => {
		const edited = replaceIn(failed, 'street', 'Ruijter', 'Ruyter');
		expect(changed(edited, originals).map((d) => d.id)).toEqual(['a', 'b']);
	});

	it('ignores whitespace-only edits', () => {
		const edited = failed.map((d) => ({ ...d, city: ' Vlissingen ' }));
		expect(changed(edited, originals)).toEqual([]);
	});

	it('drops the coordinates and queues the record again', () => {
		const rec: Rec = {
			id: 'a',
			street: 'Boulevard de Ruijter',
			houseNumber: '30',
			city: 'Vlissingen',
			extra: { naam: 'X' },
			geocode: 'failed'
		};
		const out = applyDraft(rec, { ...toDraft(rec), street: 'Boulevard de Ruyter', postcode: ' ' });
		expect(out).toMatchObject({
			street: 'Boulevard de Ruyter',
			postcode: undefined,
			geocode: 'pending',
			extra: { naam: 'X' }
		});
	});
});
