/**
 * The sorted export is the plan's save file. Upload it again and the buckets
 * come back — names, carriers, colors, membership — and export it once more
 * and it still reads as one file, not two stacked on each other.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import Papa from 'papaparse';
import { recordsStore, type Rec } from '$lib/records/records.svelte';
import { bucketsStore } from '$lib/buckets/buckets.svelte';
import { routesStore } from '$lib/routes/routes.svelte';
import { applyMapping, guessMapping, planFromRows, skippedIds } from '$lib/csv/mapping.svelte';
import { buildExport } from './sorted';

const rec = (id: string, n: number): Rec => ({
	id,
	street: 'Badhuisstraat',
	houseNumber: String(n),
	lat: 51.44,
	lon: 3.57 + n / 1000,
	extra: { id, naam: `resident ${n}` },
	geocode: 'ok'
});

function parseBack(csv: string) {
	const out = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: 'greedy' });
	return { columns: out.meta.fields ?? [], rows: out.data };
}

/** Plan a small round by hand: two buckets, a carrier, a chosen color, one skipped door. */
function plan() {
	recordsStore.load([rec('a', 1), rec('b', 2), rec('c', 3), rec('d', 4)]);
	bucketsStore.createEmpty();
	bucketsStore.rename(bucketsStore.activeId!, 'centrum');
	bucketsStore.setCarrier(bucketsStore.activeId!, 'anna');
	bucketsStore.setColor(bucketsStore.activeId!, '#d6409f');
	bucketsStore.assignToActive(['a', 'b']);
	bucketsStore.setStart(bucketsStore.activeId!, 'b');
	bucketsStore.setEnd(bucketsStore.activeId!, 'a');
	bucketsStore.createEmpty();
	bucketsStore.rename(bucketsStore.activeId!, 'boulevard');
	bucketsStore.assignToActive(['c']);
	bucketsStore.skip(['d']);
}

function reload(csv: string) {
	const { columns, rows } = parseBack(csv);
	const mapping = guessMapping(columns);
	const records = applyMapping(rows, columns, mapping);
	const skipped = skippedIds(rows, records, mapping.roles);
	routesStore.clear();
	recordsStore.load(records, [], { columns, ...mapping }, skipped);
	bucketsStore.restore(planFromRows(rows, records, mapping.roles, skipped));
	return mapping;
}

beforeEach(() => {
	recordsStore.clear();
	bucketsStore.clear();
	routesStore.clear();
});

describe('uploading the export again', () => {
	it('maps its own plan columns without being told', () => {
		plan();
		const mapping = reload(buildExport());
		expect(mapping.roles).toMatchObject({
			bucket: 'bucket',
			carrier: 'carrier',
			color: 'color',
			mark: 'mark',
			visit_order: 'visit_order',
			skip: 'skip',
			lat: 'lat',
			lon: 'lon'
		});
		expect(mapping.idColumns).toEqual(['id']);
	});

	it('brings the buckets back as they were', () => {
		plan();
		reload(buildExport());
		const [centrum, boulevard] = bucketsStore.list;
		expect(bucketsStore.list.map((b) => b.name)).toEqual(['centrum', 'boulevard']);
		expect(centrum.carrier).toBe('anna');
		expect(centrum.color).toBe('#d6409f');
		expect(centrum.startId).toBe('b');
		expect(centrum.endId).toBe('a');
		expect(bucketsStore.memberIds(centrum.id).sort()).toEqual(['a', 'b']);
		expect(bucketsStore.memberIds(boulevard.id)).toEqual(['c']);
		expect(recordsStore.skipped.has('d')).toBe(true);
		expect(bucketsStore.assignment.has('d')).toBe(false);
	});

	it('starts with a clean slate, no undo into the previous file', () => {
		plan();
		reload(buildExport());
		expect(bucketsStore.undo()).toBeNull();
	});

	it('exports again as one file: every header once, details intact', () => {
		plan();
		reload(buildExport());
		const { columns, rows } = parseBack(buildExport());
		expect(new Set(columns).size).toBe(columns.length);
		expect(columns).toEqual([
			'id',
			'bucket',
			'carrier',
			'color',
			'mark',
			'visit_order',
			'skip',
			'street',
			'house_number',
			'lat',
			'lon',
			'naam'
		]);
		expect(rows.find((r) => r.id === 'a')).toMatchObject({
			bucket: 'centrum',
			carrier: 'anna',
			color: '#d6409f',
			mark: 'E',
			naam: 'resident 1'
		});
		expect(rows.find((r) => r.id === 'b')?.mark).toBe('S');
		expect(rows.find((r) => r.id === 'd')).toMatchObject({ bucket: '', skip: '1' });
	});
});
