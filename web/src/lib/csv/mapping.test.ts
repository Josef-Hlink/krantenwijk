/**
 * Identity is the user's choice per import, and the one thing that must
 * never silently go wrong: a colliding id is a record gone. So: the mapper
 * counts collisions up front, and applying the mapping never produces two
 * records with the same id whatever the columns say.
 */
import { describe, expect, it } from 'vitest';
import {
	applyMapping,
	guessMapping,
	identity,
	isSkipped,
	planFromRows,
	uniqueCounts,
	withNewRoles,
	type Mapping
} from './mapping.svelte';

const columns = ['klantnr', 'Bron', 'straat', 'huisnr'];
const row = (klantnr: string, bron: string, huisnr = '1') => ({
	klantnr,
	Bron: bron,
	straat: 'Badhuisstraat',
	huisnr
});

/** The merged paper + flyer shape: customer numbers repeat, only the source differs. */
const merged = [row('100', 'krant'), row('101', 'krant'), row('100', 'folder'), row('102', 'folder')];

describe('identity', () => {
	it('says how many distinct ids the chosen columns spell for the rows', () => {
		expect(identity(merged, ['klantnr'])).toEqual({
			rows: 4,
			unique: 3,
			blank: 0,
			duplicates: 1
		});
	});

	it('is satisfied once the combination is unique', () => {
		expect(identity(merged, ['klantnr', 'Bron'])).toMatchObject({ unique: 4, duplicates: 0 });
	});

	it('counts every extra copy, not every row involved', () => {
		const rows = [row('1', 'a'), row('1', 'a'), row('1', 'a')];
		expect(identity(rows, ['klantnr']).duplicates).toBe(2);
	});

	it('treats a row with all id columns empty as blank, not as a duplicate', () => {
		const rows = [row('', ''), row('', ''), row('7', 'krant')];
		expect(identity(rows, ['klantnr', 'Bron'])).toEqual({
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
		const recs = applyMapping(merged, columns, { roles, idColumns: ['klantnr', 'Bron'] });
		expect(recs.map((r) => r.id)).toEqual(['100|krant', '101|krant', '100|folder', '102|folder']);
	});

	it('keeps a single id column as the bare value', () => {
		const recs = applyMapping([row('100', 'krant')], columns, { roles, idColumns: ['klantnr'] });
		expect(recs[0].id).toBe('100');
	});

	it('numbers colliding ids rather than losing a record', () => {
		const recs = applyMapping(merged, columns, { roles, idColumns: ['klantnr'] });
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
			idColumns: ['klantnr']
		});
		expect(recs[0].id).not.toBe(recs[1].id);
		expect(recs[0].id).not.toBe('');
	});

	it('keeps the id columns in extra so the export still carries them', () => {
		const recs = applyMapping(merged, columns, { roles, idColumns: ['klantnr', 'Bron'] });
		expect(recs[2].extra).toEqual({ klantnr: '100', Bron: 'folder' });
	});
});

describe('guessMapping', () => {
	it('picks an id-looking column as the single id', () => {
		expect(guessMapping(['id', 'straat', 'huisnr']).idColumns).toEqual(['id']);
	});

	it('leaves the id empty when nothing looks like one', () => {
		expect(guessMapping(['klantnr', 'straat', 'huisnr']).idColumns).toEqual([]);
	});
});

describe('uniqueCounts', () => {
	it('counts distinct non-blank values per column', () => {
		const rows = [row('1', 'krant'), row('2', 'krant'), row('', 'folder')];
		expect(uniqueCounts(rows, ['klantnr', 'Bron', 'straat'])).toEqual({
			klantnr: 2,
			Bron: 2,
			straat: 1
		});
	});
});

describe('the skip column', () => {
	it('reads anything but an obvious no as skipped', () => {
		expect(isSkipped('1')).toBe(true);
		expect(isSkipped('ja')).toBe(true);
		expect(isSkipped('')).toBe(false);
		expect(isSkipped('0')).toBe(false);
		expect(isSkipped('nee')).toBe(false);
	});
});

describe('the plan a saved file carries', () => {
	const roles = { bucket: 'bucket', carrier: 'carrier', color: 'color', mark: 'mark' } as const;
	const rows = [
		{ bucket: 'centrum', carrier: 'anna', color: '#d6409f', mark: 'E' },
		{ bucket: 'boulevard', carrier: '', color: 'reddish', mark: '' },
		{ bucket: 'centrum', carrier: 'anna', color: '#d6409f', mark: 'S' },
		{ bucket: '', carrier: '', color: '', mark: '' },
		{ bucket: 'oud-west', carrier: 'josef', color: '', mark: 'SE' }
	];
	const records = rows.map((_, i) => ({ id: `r${i}`, extra: {}, geocode: 'n/a' as const }));

	it('lists buckets in order of first appearance, each with its carrier and color', () => {
		const plan = planFromRows(rows, records, roles);
		expect(plan.buckets).toEqual([
			{ name: 'centrum', carrier: 'anna', color: '#d6409f', startId: 'r2', endId: 'r0' },
			{ name: 'boulevard' },
			{ name: 'oud-west', carrier: 'josef', startId: 'r4', endId: 'r4' }
		]);
		expect(plan.assignments).toEqual([
			{ id: 'r0', bucket: 'centrum' },
			{ id: 'r1', bucket: 'boulevard' },
			{ id: 'r2', bucket: 'centrum' },
			{ id: 'r4', bucket: 'oud-west' }
		]);
	});

	it('leaves a skipped row out of its bucket', () => {
		const plan = planFromRows(rows, records, roles, ['r4']);
		expect(plan.buckets.map((b) => b.name)).toEqual(['centrum', 'boulevard']);
		expect(plan.assignments.some((a) => a.id === 'r4')).toBe(false);
	});

	it('is empty when no column is the bucket', () => {
		expect(planFromRows(rows, records, {})).toEqual({ buckets: [], assignments: [] });
	});
});

describe('a remembered mapping', () => {
	const columns = ['id', 'bucket', 'carrier', 'street', 'house_number', 'lat', 'lon'];

	it('picks up roles that did not exist when it was saved', () => {
		const saved = {
			roles: { street: 'street', house_number: 'house_number', lat: 'lat', lon: 'lon' },
			idColumns: ['id']
		};
		expect(withNewRoles(saved, columns).roles).toMatchObject({
			bucket: 'bucket',
			carrier: 'carrier'
		});
	});

	it('never overrides a column the user already placed', () => {
		const saved: Mapping = { roles: { street: 'street', city: 'bucket' }, idColumns: ['carrier'] };
		const { roles, idColumns } = withNewRoles(saved, columns);
		expect(roles.city).toBe('bucket');
		expect(roles.bucket).toBeUndefined();
		expect(roles.carrier).toBeUndefined();
		expect(idColumns).toEqual(['carrier']);
	});
});
