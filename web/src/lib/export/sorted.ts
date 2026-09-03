/**
 * Sorted-CSV export: every uploaded row comes back out, keyed by id, with
 * bucket / carrier / visit_order prepended — the file the private side
 * joins on id to print from. Passthrough columns survive verbatim.
 */
import Papa from 'papaparse';
import type { Rec } from '$lib/records/records.svelte';
import { recordsStore } from '$lib/records/records.svelte';
import { bucketsStore } from '$lib/buckets/buckets.svelte';
import { routesStore } from '$lib/routes/routes.svelte';
import { SKIP_MARK } from '$lib/csv/mapping.svelte';

function baseColumns(records: Rec[]): string[] {
	const cols = ['id', 'bucket', 'carrier', 'visit_order', 'skip'];
	const has = (k: keyof Rec) => records.some((r) => r[k] != null);
	if (has('street')) cols.push('street');
	if (has('houseNumber')) cols.push('house_number');
	if (has('postcode')) cols.push('postcode');
	if (has('city')) cols.push('city');
	if (has('lat')) cols.push('lat', 'lon');
	return cols;
}

export function buildExport(): string {
	const records = recordsStore.records;
	const extraCols = [...new Set(records.flatMap((r) => Object.keys(r.extra)))];
	const columns = [...baseColumns(records), ...extraCols];

	// visit order per record: bucket routes first, in visit order
	const visitOrder = new Map<string, number>();
	// `order` holds one id per door; every card behind it shares that place in
	// the walk, so the printed list keeps a household together.
	for (const [bucketId, result] of routesStore.results) {
		if (!bucketsStore.buckets.has(bucketId)) continue;
		result.order.forEach((id, i) => {
			for (const cardId of recordsStore.expandToDoors([id])) {
				visitOrder.set(cardId, i + 1);
			}
		});
	}

	const bucketRank = new Map(bucketsStore.list.map((b, i) => [b.id, i]));
	const rows = [...records].sort((a, b) => {
		const ba = bucketsStore.assignment.get(a.id);
		const bb = bucketsStore.assignment.get(b.id);
		// bucketed rows first, grouped in rail order, routed order within
		const ra = ba != null ? (bucketRank.get(ba) ?? 0) : Infinity;
		const rb = bb != null ? (bucketRank.get(bb) ?? 0) : Infinity;
		if (ra !== rb) return ra - rb;
		return (visitOrder.get(a.id) ?? Infinity) - (visitOrder.get(b.id) ?? Infinity);
	});

	const data = rows.map((r) => {
		const bucketId = bucketsStore.assignment.get(r.id);
		const bucket = bucketId ? bucketsStore.buckets.get(bucketId) : undefined;
		const row: Record<string, string | number> = {
			id: r.id,
			bucket: bucket?.name ?? '',
			carrier: bucket?.carrier ?? '',
			visit_order: visitOrder.get(r.id) ?? '',
			skip: recordsStore.deactivated.has(r.id) ? SKIP_MARK : '',
			street: r.street ?? '',
			house_number: r.houseNumber ?? '',
			postcode: r.postcode ?? '',
			city: r.city ?? '',
			lat: r.lat ?? '',
			lon: r.lon ?? ''
		};
		for (const c of extraCols) row[c] = r.extra[c] ?? '';
		return columns.map((c) => row[c] ?? '');
	});

	return Papa.unparse({ fields: columns, data });
}

export function downloadExport() {
	const csv = buildExport();
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'krantenwijk-ordering.csv';
	a.click();
	URL.revokeObjectURL(url);
}
