/**
 * Identity is the user's choice per import, and the one thing that must
 * never silently go wrong: a colliding id is a record gone. So: the mapper
 * counts collisions up front, and applying the mapping never produces two
 * records with the same id whatever the columns say.
 */
import { describe, expect, it } from 'vitest';
import { applyMapping, guessMapping, identity, uniqueCounts } from './mapping.svelte';

const columns = ['patientnr', 'Bron', 'straat', 'huisnr'];
const row = (patientnr: string, bron: string, huisnr = '1') => ({
	patientnr,
	Bron: bron,
	straat: 'Badhuisstraat',
	huisnr
});

/** The merged griep + pneumo shape: patient numbers repeat, only the source differs. */
const merged = [row('100', 'griep'), row('101', 'griep'), row('100', 'pneumo'), row('102', 'pneumo')];

describe('identity', () => {
	it('says how many distinct ids the chosen columns spell for the rows', () => {
		expect(identity(merged, ['patientnr'])).toEqual({
			rows: 4,
			unique: 3,
			blank: 0,
			duplicates: 1
		});
	});

	it('is satisfied once the combination is unique', () => {
		expect(identity(merged, ['patientnr', 'Bron'])).toMatchObject({ unique: 4, duplicates: 0 });
	});

	it('counts every extra copy, not every row involved', () => {
		const rows = [row('1', 'a'), row('1', 'a'), row('1', 'a')];
		expect(identity(rows, ['patientnr']).duplicates).toBe(2);
	});

	it('treats a row with all id columns empty as blank, not as a duplicate', () => {
		const rows = [row('', ''), row('', ''), row('7', 'griep')];
		expect(identity(rows, ['patientnr', 'Bron'])).toEqual({
			rows: 3,
			unique: 1,
			blank: 2,
			duplicates: 0
		});
	});

	it('is all blank when no id column is chosen', () => {
		expect(identity(merged, [])).toEqual({ rows: 4, unique: 0, blank: 4, duplicates: 0 });
	});
});

describe('applyMapping', () => {
	const roles = { street: 'straat', house_number: 'huisnr' } as const;

	it('builds the id from several columns', () => {
		const recs = applyMapping(merged, columns, { roles, idColumns: ['patientnr', 'Bron'] });
		expect(recs.map((r) => r.id)).toEqual(['100|griep', '101|griep', '100|pneumo', '102|pneumo']);
	});

	it('keeps a single id column as the bare value', () => {
		const recs = applyMapping([row('100', 'griep')], columns, { roles, idColumns: ['patientnr'] });
		expect(recs[0].id).toBe('100');
	});

	it('numbers colliding ids rather than losing a record', () => {
		const recs = applyMapping(merged, columns, { roles, idColumns: ['patientnr'] });
		expect(recs).toHaveLength(4);
		expect(recs.map((r) => r.id)).toEqual(['100', '101', '100#2', '102']);
	});

	it('generates a distinct id for every row when none is chosen', () => {
		const recs = applyMapping(merged, columns, { roles, idColumns: [] });
		expect(new Set(recs.map((r) => r.id)).size).toBe(4);
	});

	it('generates an id for a row whose id columns are empty', () => {
		const recs = applyMapping([row('', ''), row('', '')], columns, {
			roles,
			idColumns: ['patientnr']
		});
		expect(recs[0].id).not.toBe(recs[1].id);
		expect(recs[0].id).not.toBe('');
	});

	it('keeps the id columns in extra so the export still carries them', () => {
		const recs = applyMapping(merged, columns, { roles, idColumns: ['patientnr', 'Bron'] });
		expect(recs[2].extra).toEqual({ patientnr: '100', Bron: 'pneumo' });
	});
});

describe('guessMapping', () => {
	it('picks an id-looking column as the single id', () => {
		expect(guessMapping(['id', 'straat', 'huisnr']).idColumns).toEqual(['id']);
	});

	it('leaves the id empty when nothing looks like one', () => {
		expect(guessMapping(['patientnr', 'straat', 'huisnr']).idColumns).toEqual([]);
	});
});

describe('uniqueCounts', () => {
	it('counts distinct non-blank values per column', () => {
		const rows = [row('1', 'griep'), row('2', 'griep'), row('', 'pneumo')];
		expect(uniqueCounts(rows, ['patientnr', 'Bron', 'straat'])).toEqual({
			patientnr: 2,
			Bron: 2,
			straat: 1
		});
	});
});
