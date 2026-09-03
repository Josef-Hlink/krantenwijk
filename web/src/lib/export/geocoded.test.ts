/**
 * The saved file has one job: upload it again next year and geocode nothing.
 * So the tests here are mostly round trips — build the CSV, parse it back
 * through the real mapping code, and check every record arrives located.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import Papa from 'papaparse';
import { recordsStore, type Rec, type Source } from '$lib/records/records.svelte';
import { applyMapping, guessMapping } from '$lib/csv/mapping.svelte';
import { buildGeocodedCsv, hasChangesToSave } from './geocoded';
import { skippedIds } from '$lib/csv/mapping.svelte';

/** A file whose columns are Dutch and whose coordinates we resolved here. */
function dutchUpload() {
	const source: Source = {
		columns: ['nr', 'straat', 'huisnr', 'plaats', 'naam'],
		roles: { street: 'straat', house_number: 'huisnr', city: 'plaats' },
		idColumns: ['nr']
	};
	const records: Rec[] = [
		{
			id: 'a1',
			street: 'Badhuisstraat',
			houseNumber: '12',
			city: 'Vlissingen',
			lat: 51.4426123456,
			lon: 3.5736987654,
			extra: { nr: 'a1', naam: 'J. de Vries' },
			geocode: 'ok'
		},
		{
			id: 'a2',
			street: 'Badhuisstraat',
			houseNumber: '14',
			city: 'Vlissingen',
			lat: 51.4428,
			lon: 3.5739,
			extra: { nr: 'a2', naam: 'M. Jansen' },
			geocode: 'ok'
		}
	];
	return { source, records };
}

function parseBack(csv: string) {
	const out = Papa.parse<Record<string, string>>(csv, {
		header: true,
		skipEmptyLines: 'greedy'
	});
	return { columns: out.meta.fields ?? [], rows: out.data };
}

beforeEach(() => recordsStore.clear());

describe('saving the file back', () => {
	it('keeps the uploader’s own column names', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(records, [], source);
		const { columns } = parseBack(buildGeocodedCsv());
		expect(columns).toEqual(['nr', 'straat', 'huisnr', 'plaats', 'naam', 'lat', 'lon', 'skip']);
	});

	it('keeps every row, in upload order', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(records, [], source);
		const { rows } = parseBack(buildGeocodedCsv());
		expect(rows.map((r) => r.nr)).toEqual(['a1', 'a2']);
	});

	it('carries passthrough columns through untouched', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(records, [], source);
		const { rows } = parseBack(buildGeocodedCsv());
		expect(rows[0].naam).toBe('J. de Vries');
	});

	it('re-imports with every record located, geocoding nothing', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(records, [], source);
		const { columns, rows } = parseBack(buildGeocodedCsv());

		// The real path a returning file takes: guess the mapping, apply it.
		const again = applyMapping(rows, columns, guessMapping(columns));
		expect(again).toHaveLength(2);
		expect(again.every((r) => r.lat != null && r.lon != null)).toBe(true);
		expect(again.every((r) => r.geocode === 'n/a')).toBe(true);
		expect(again[0].street).toBe('Badhuisstraat');
		expect(again[0].extra.naam).toBe('J. de Vries');
	});

	it('rounds coordinates to something a letterbox needs', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(records, [], source);
		const { rows } = parseBack(buildGeocodedCsv());
		expect(rows[0].lat).toBe('51.442612');
		expect(rows[0].lon).toBe('3.573699');
	});

	it('writes back into the file’s own lat/lon columns when it had them', () => {
		const source: Source = {
			columns: ['id', 'straat', 'huisnr', 'breedtegraad', 'lengtegraad'],
			roles: {
				street: 'straat',
				house_number: 'huisnr',
				lat: 'breedtegraad',
				lon: 'lengtegraad'
			},
			idColumns: ['id']
		};
		recordsStore.load(
			[
				{
					id: 'a1',
					street: 'Badhuisstraat',
					houseNumber: '12',
					lat: 51.4426,
					lon: 3.5736,
					extra: { id: 'a1' },
					geocode: 'ok'
				}
			],
			[],
			source
		);
		const { columns, rows } = parseBack(buildGeocodedCsv());
		expect(columns).toEqual(['id', 'straat', 'huisnr', 'breedtegraad', 'lengtegraad', 'skip']);
		expect(rows[0].breedtegraad).toBe('51.4426');
	});

	it('does not collide with a column that is already called lat', () => {
		const source: Source = {
			columns: ['id', 'straat', 'huisnr', 'lat'],
			roles: { street: 'straat', house_number: 'huisnr' },
			idColumns: ['id']
		};
		recordsStore.load(
			[
				{
					id: 'a1',
					street: 'Badhuisstraat',
					houseNumber: '12',
					lat: 51.4426,
					lon: 3.5736,
					extra: { id: 'a1', lat: 'iets anders' },
					geocode: 'ok'
				}
			],
			[],
			source
		);
		const { columns, rows } = parseBack(buildGeocodedCsv());
		expect(columns).toEqual(['id', 'straat', 'huisnr', 'lat', 'lat_2', 'lon', 'skip']);
		expect(rows[0].lat).toBe('iets anders');
		expect(rows[0].lat_2).toBe('51.4426');
	});

	it('leaves a row that could not be geocoded blank rather than dropping it', () => {
		const { source, records } = dutchUpload();
		records.push({
			id: 'a3',
			street: 'Nergensstraat',
			houseNumber: '1',
			extra: { nr: 'a3', naam: 'P. Pietersen' },
			geocode: 'failed'
		});
		recordsStore.load(records, [], source);
		const { rows } = parseBack(buildGeocodedCsv());
		expect(rows).toHaveLength(3);
		expect(rows[2].lat).toBe('');
		expect(rows[2].naam).toBe('P. Pietersen');
	});
});

describe('doors taken out of the round', () => {
	it('are marked in a skip column and come back skipped on re-import', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(records, [], source, ['a2']);
		const { columns, rows } = parseBack(buildGeocodedCsv());
		expect(rows.map((r) => r.skip)).toEqual(['', '1']);

		const mapping = guessMapping(columns);
		expect(mapping.roles.skip).toBe('skip');
		const again = applyMapping(rows, columns, mapping);
		expect(skippedIds(rows, again, mapping.roles)).toEqual(['a2']);
	});

	it('write back into the file’s own skip column when it had one', () => {
		const source: Source = {
			columns: ['id', 'straat', 'huisnr', 'overslaan'],
			roles: { street: 'straat', house_number: 'huisnr', skip: 'overslaan' },
			idColumns: ['id']
		};
		recordsStore.load(
			[
				{ id: 'a1', street: 'Badhuisstraat', houseNumber: '12', lat: 51.44, lon: 3.57, extra: { id: 'a1' }, geocode: 'ok' },
				{ id: 'a2', street: 'Badhuisstraat', houseNumber: '14', lat: 51.44, lon: 3.57, extra: { id: 'a2' }, geocode: 'ok' }
			],
			[],
			source,
			['a1']
		);
		const { columns, rows } = parseBack(buildGeocodedCsv());
		expect(columns).toEqual(['id', 'straat', 'huisnr', 'overslaan', 'lat', 'lon']);
		expect(rows.map((r) => r.overslaan)).toEqual(['1', '']);
	});
});

describe('when to offer it', () => {
	it('is offered once something has actually been geocoded', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(records, [], source);
		expect(hasChangesToSave()).toBe(true);
	});

	it('is not offered for a file that already arrived with coordinates', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(
			records.map((r) => ({ ...r, geocode: 'n/a' as const })),
			[],
			source
		);
		expect(hasChangesToSave()).toBe(false);
	});

	it('is offered once a door has been taken out, even with nothing geocoded', () => {
		const { source, records } = dutchUpload();
		recordsStore.load(
			records.map((r) => ({ ...r, geocode: 'n/a' as const })),
			[],
			source,
			['a1']
		);
		expect(hasChangesToSave()).toBe(true);
	});

	it('is not offered when nothing is loaded', () => {
		expect(hasChangesToSave()).toBe(false);
	});
});
