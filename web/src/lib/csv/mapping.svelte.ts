/**
 * Column→role mapping. krantenwijk never assumes a schema: the user maps
 * their CSV's columns onto the essential roles (a location — either street +
 * house number or coordinates) and, separately, onto the record's identity;
 * every other column is a "detail" they can name and surface in the map
 * popup. Mappings are remembered per column-set fingerprint in localStorage
 * so next year's identical export maps itself.
 *
 * Identity is its own thing rather than a role because it is not one column.
 * A merged export can reuse the same customer number across two lists with
 * only a source column telling them apart, so the id is whatever set of
 * columns the user says makes a row unique — and if they pick nothing, every
 * row gets a generated one rather than a collision.
 */
import type { Rec, Detail } from '$lib/records/records.svelte';

export const ROLES = [
	'street',
	'house_number',
	'postcode',
	'city',
	'lat',
	'lon',
	'skip',
	'bucket',
	'carrier',
	'color',
	'mark',
	'visit_order'
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
	street: 'street',
	house_number: 'house number',
	postcode: 'postcode',
	city: 'city',
	lat: 'latitude',
	lon: 'longitude',
	skip: 'skip (not in the round)',
	bucket: 'bucket (earlier plan)',
	carrier: 'carrier (earlier plan)',
	color: 'bucket color (earlier plan)',
	mark: 'start / end (earlier plan)',
	visit_order: 'walk order (earlier plan)'
};

/** Case-insensitive aliases used to guess a mapping from column names. */
const ALIASES: Record<Role, string[]> = {
	street: ['street', 'straat', 'straatnaam', 'adres', 'address'],
	house_number: ['house_number', 'housenumber', 'huisnr', 'huisnummer', 'nummer', 'no'],
	postcode: ['postcode', 'postal_code', 'zip', 'zipcode', 'pc'],
	city: ['city', 'plaats', 'woonplaats', 'stad', 'town', 'gemeente'],
	lat: ['lat', 'latitude', 'breedtegraad', 'y'],
	lon: ['lon', 'lng', 'longitude', 'lengtegraad', 'x'],
	skip: ['skip', 'overslaan', 'inactive', 'deactivated'],
	bucket: ['bucket', 'wijk', 'cluster'],
	carrier: ['carrier', 'loper', 'bezorger'],
	color: ['color', 'colour', 'kleur'],
	mark: ['mark', 'start_end'],
	visit_order: ['visit_order', 'walk_order', 'volgorde']
};

/** A skip cell that means "yes". Anything non-empty counts, bar the obvious noes. */
export function isSkipped(value: string | undefined): boolean {
	const v = (value ?? '').trim().toLowerCase();
	return v !== '' && !['0', 'no', 'nee', 'false', 'n'].includes(v);
}

/** What the saved CSV writes in the skip column for a door taken out. */
export const SKIP_MARK = '1';

const ID_ALIASES = ['id', 'nr', 'key', 'code'];

/** Detail columns that look like a person's name start out shown. */
export const NAMEISH = ['naam', 'name', 'ontvanger', 'bewoner', 'recipient'];

const STORAGE_PREFIX = 'krantenwijk.mapping.v3.';

/** Which columns play which role, and which together identify a row. */
export interface Mapping {
	roles: Partial<Record<Role, string>>;
	/** In file order. Empty means every row gets a generated id. */
	idColumns: string[];
}

export function fingerprint(columns: string[]): string {
	return [...columns].sort().join(' ');
}

export function guessMapping(columns: string[]): Mapping {
	const roles: Partial<Record<Role, string>> = {};
	const taken = new Set<string>();
	const idHit = columns.find((c) => ID_ALIASES.includes(c.trim().toLowerCase()));
	if (idHit) taken.add(idHit);
	for (const role of ROLES) {
		const hit = columns.find(
			(c) => !taken.has(c) && ALIASES[role].includes(c.trim().toLowerCase())
		);
		if (hit) {
			roles[role] = hit;
			taken.add(hit);
		}
	}
	return { roles, idColumns: idHit ? [idHit] : [] };
}

/**
 * A remembered mapping, topped up with guesses for roles it leaves open. A
 * mapping saved before a role existed would otherwise pin that role's column
 * to "extra detail" forever — the plan columns of last week's export, say.
 * Columns the saved mapping already uses stay as they are.
 */
export function withNewRoles<M extends Mapping>(saved: M, columns: string[]): M {
	const guess = guessMapping(columns);
	const taken = new Set([...saved.idColumns, ...Object.values(saved.roles).filter(Boolean)]);
	const roles = { ...saved.roles };
	for (const role of ROLES) {
		const col = guess.roles[role];
		if (!roles[role] && col && !taken.has(col)) {
			roles[role] = col;
			taken.add(col);
		}
	}
	return { ...saved, roles };
}

export function defaultDetail(column: string): Detail {
	return {
		column,
		label: column,
		show: NAMEISH.includes(column.trim().toLowerCase())
	};
}

export interface SavedMapping extends Mapping {
	details: Detail[];
}

export function savedMapping(columns: string[]): SavedMapping | null {
	try {
		const raw = localStorage.getItem(STORAGE_PREFIX + fingerprint(columns));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || !parsed.roles) return null;
		return {
			roles: parsed.roles,
			idColumns: Array.isArray(parsed.idColumns) ? parsed.idColumns : [],
			details: Array.isArray(parsed.details) ? parsed.details : []
		};
	} catch {
		return null;
	}
}

export function saveMapping(columns: string[], saved: SavedMapping) {
	try {
		localStorage.setItem(STORAGE_PREFIX + fingerprint(columns), JSON.stringify(saved));
	} catch {
		// storage full or unavailable — mapping just won't be remembered
	}
}

export type LocationStatus = 'coords' | 'address' | 'partial' | 'missing';

export interface MappingStatus {
	location: LocationStatus;
	ok: boolean;
}

export function mappingStatus(roles: Partial<Record<Role, string>>): MappingStatus {
	const hasCoords = !!(roles.lat && roles.lon);
	const hasAddress = !!(roles.street && roles.house_number);
	const anyLocation = !!(roles.lat || roles.lon || roles.street || roles.house_number);
	const location: LocationStatus = hasCoords
		? 'coords'
		: hasAddress
			? 'address'
			: anyLocation
				? 'partial'
				: 'missing';
	return { location, ok: hasCoords || hasAddress };
}

/**
 * Whether the chosen id columns cover the rows: how many distinct ids they
 * spell against how many rows there are. Shown live in the mapper as
 * "203 unique ids for 294 rows", so a collision is something the user is
 * told about, not something they discover later by counting dots.
 */
export interface Identity {
	rows: number;
	/** Distinct ids among the rows that have one. */
	unique: number;
	/** Rows whose id columns are all empty. They get a generated id. */
	blank: number;
	/** Rows that would collide: rows with an id minus `unique`. */
	duplicates: number;
}

/**
 * Distinct non-blank values per column. Shown beside every column in the
 * mapper so you can see which ones could identify a row before picking:
 * a column with 294 unique values in 294 rows covers it, one with 203
 * does not.
 */
export function uniqueCounts(
	rows: Record<string, string>[],
	columns: string[]
): Record<string, number> {
	const sets = new Map(columns.map((c) => [c, new Set<string>()]));
	for (const row of rows) {
		for (const c of columns) {
			const v = row[c]?.trim();
			if (v) sets.get(c)!.add(v);
		}
	}
	return Object.fromEntries([...sets].map(([c, set]) => [c, set.size]));
}

/** The id a row's chosen columns spell, or undefined when they are all empty. */
function keyOf(row: Record<string, string>, idColumns: string[]): string | undefined {
	if (!idColumns.length) return undefined;
	const parts = idColumns.map((c) => row[c]?.trim() ?? '');
	if (parts.every((p) => p === '')) return undefined;
	return parts.join('|');
}

export function identity(rows: Record<string, string>[], idColumns: string[]): Identity {
	let blank = 0;
	const seen = new Set<string>();
	for (const row of rows) {
		const key = keyOf(row, idColumns);
		if (key == null) blank++;
		else seen.add(key);
	}
	return {
		rows: rows.length,
		unique: seen.size,
		blank,
		duplicates: rows.length - blank - seen.size
	};
}

/**
 * The ids of rows the skip column marks — skipped doors from an earlier
 * session, saved into the CSV so next year's upload starts where this one
 * left off. Index-aligned with `applyMapping`'s output.
 */
export function skippedIds(
	rows: Record<string, string>[],
	records: Rec[],
	roles: Partial<Record<Role, string>>
): string[] {
	const col = roles.skip;
	if (!col) return [];
	return records.filter((r, i) => isSkipped(rows[i][col])).map((r) => r.id);
}

/**
 * The plan a saved CSV carries: the buckets it names, in order of first
 * appearance (which is the rail order the file was written in), and which
 * row went in which. Carrier and color ride along per bucket when the file
 * has them. A skipped row's bucket cell is ignored — a door is in the round
 * or out of it, never both.
 */
export interface PlanBucket {
	name: string;
	carrier?: string;
	color?: string;
	startId?: string;
	endId?: string;
}

export interface Plan {
	buckets: PlanBucket[];
	assignments: { id: string; bucket: string }[];
}

/** What the saved CSV writes in the mark column: S, E, or both, for a bucket's ends. */
export function markOf(start: boolean, end: boolean): string {
	return (start ? 'S' : '') + (end ? 'E' : '');
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function planFromRows(
	rows: Record<string, string>[],
	records: Rec[],
	roles: Partial<Record<Role, string>>,
	skipped: Iterable<string> = []
): Plan {
	const col = roles.bucket;
	const plan: Plan = { buckets: [], assignments: [] };
	if (!col) return plan;
	const out = new Set(skipped);
	const seen = new Map<string, PlanBucket>();
	records.forEach((r, i) => {
		const row = rows[i];
		const name = row[col]?.trim();
		if (!name || out.has(r.id)) return;
		let bucket = seen.get(name);
		const mark = (roles.mark ? row[roles.mark] : '')?.trim().toUpperCase() ?? '';
		if (!bucket) {
			bucket = { name };
			const carrier = roles.carrier ? row[roles.carrier]?.trim() : '';
			const color = roles.color ? row[roles.color]?.trim() : '';
			if (carrier) bucket.carrier = carrier;
			if (color && HEX_COLOR.test(color)) bucket.color = color.toLowerCase();
			seen.set(name, bucket);
			plan.buckets.push(bucket);
		}
		// First one wins: a file with two starts is a file with one start.
		if (mark.includes('S') && !bucket.startId) bucket.startId = r.id;
		if (mark.includes('E') && !bucket.endId) bucket.endId = r.id;
		plan.assignments.push({ id: r.id, bucket: name });
	});
	return plan;
}

/** A fresh id for a row that has none. Falls back when not in a secure context. */
function generatedId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
	return Array.from({ length: 4 }, () =>
		Math.floor(Math.random() * 0x10000)
			.toString(16)
			.padStart(4, '0')
	).join('-');
}

/**
 * Apply a mapping to parsed rows, producing records.
 *
 * Every record ends up with a distinct id: a blank one is generated, and a
 * repeated one is numbered `#2`, `#3`… rather than swallowing the row. The
 * id columns themselves stay in `extra` untouched, so whatever the export is
 * joined on, the original values are in it.
 */
export function applyMapping(
	rows: Record<string, string>[],
	columns: string[],
	mapping: Mapping
): Rec[] {
	const { roles, idColumns } = mapping;
	const roleCols = new Set(Object.values(roles).filter(Boolean) as string[]);
	const extraCols = columns.filter((c) => !roleCols.has(c));
	const get = (row: Record<string, string>, role: Role): string | undefined => {
		const col = roles[role];
		const v = col ? row[col]?.trim() : undefined;
		return v === '' ? undefined : v;
	};

	const seen = new Map<string, number>();
	const uniqueId = (row: Record<string, string>): string => {
		const key = keyOf(row, idColumns);
		if (key == null) return generatedId();
		const n = (seen.get(key) ?? 0) + 1;
		seen.set(key, n);
		return n === 1 ? key : `${key}#${n}`;
	};

	return rows.map((row) => {
		const latRaw = get(row, 'lat');
		const lonRaw = get(row, 'lon');
		const lat = latRaw != null ? Number(latRaw.replace(',', '.')) : undefined;
		const lon = lonRaw != null ? Number(lonRaw.replace(',', '.')) : undefined;
		const located = lat != null && lon != null && isFinite(lat) && isFinite(lon);
		return {
			id: uniqueId(row),
			street: get(row, 'street'),
			houseNumber: get(row, 'house_number'),
			postcode: get(row, 'postcode'),
			city: get(row, 'city'),
			lat: located ? lat : undefined,
			lon: located ? lon : undefined,
			extra: Object.fromEntries(extraCols.map((c) => [c, row[c] ?? ''])),
			geocode: located ? ('n/a' as const) : ('pending' as const)
		};
	});
}
