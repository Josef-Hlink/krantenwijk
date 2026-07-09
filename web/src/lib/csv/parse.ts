/**
 * CSV parsing — in the browser, via PapaParse. Delimiter and quoting are
 * auto-detected; headers are taken from the first row.
 */
import Papa from 'papaparse';

/** Mirrors the engine's MAX_UPLOAD_ROWS default. */
export const MAX_ROWS = 5000;

export interface ParsedCsv {
	columns: string[];
	rows: Record<string, string>[];
	preview: Record<string, string>[];
	truncated: boolean;
}

export function parseCsv(input: File | string): Promise<ParsedCsv> {
	return new Promise((resolve, reject) => {
		Papa.parse<Record<string, string>>(input as File, {
			header: true,
			skipEmptyLines: 'greedy',
			complete: (result) => {
				const columns = (result.meta.fields ?? []).filter((c) => c.trim() !== '');
				if (!columns.length) {
					reject(new Error('No header row found — the first line must name the columns.'));
					return;
				}
				const truncated = result.data.length > MAX_ROWS;
				const rows = truncated ? result.data.slice(0, MAX_ROWS) : result.data;
				resolve({ columns, rows, preview: rows.slice(0, 5), truncated });
			},
			error: (err: Error) => reject(err)
		});
	});
}
