/**
 * Column→role mapping. krantenwijk never assumes a schema: the user maps
 * their CSV's columns onto the essential roles (an id plus a location —
 * either street + house number or coordinates); every other column is a
 * "detail" they can name and surface in the map popup. Mappings are
 * remembered per column-set fingerprint in localStorage so next year's
 * identical export maps itself.
 */
import type { Rec, Detail } from '$lib/records/records.svelte';

export const ROLES = [
	'id',
	'street',
	'house_number',
	'postcode',
	'city',
	'lat',
	'lon'
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
	id: 'id',
	street: 'street',
	house_number: 'house number',
	postcode: 'postcode',
	city: 'city',
	lat: 'latitude',
	lon: 'longitude'
};

/** Case-insensitive aliases used to guess a mapping from column names. */
const ALIASES: Record<Role, string[]> = {
	id: ['id', 'nr', 'key', 'code'],
	street: ['street', 'straat', 'straatnaam', 'adres', 'address'],
	house_number: ['house_number', 'housenumber', 'huisnr', 'huisnummer', 'nummer', 'no'],
	postcode: ['postcode', 'postal_code', 'zip', 'zipcode', 'pc'],
	city: ['city', 'plaats', 'woonplaats', 'stad', 'town', 'gemeente'],
	lat: ['lat', 'latitude', 'breedtegraad', 'y'],
	lon: ['lon', 'lng', 'longitude', 'lengtegraad', 'x']
};

/** Detail columns that look like a person's name start out shown. */
export const NAMEISH = ['naam', 'name', 'ontvanger', 'bewoner', 'recipient'];

const STORAGE_PREFIX = 'krantenwijk.mapping.v2.';

export function fingerprint(columns: string[]): string {
	return [...columns].sort().join(' ');
}

export function guessMapping(columns: string[]): Partial<Record<Role, string>> {
	const mapping: Partial<Record<Role, string>> = {};
	const taken = new Set<string>();
	for (const role of ROLES) {
		const hit = columns.find(
			(c) => !taken.has(c) && ALIASES[role].includes(c.trim().toLowerCase())
		);
		if (hit) {
			mapping[role] = hit;
			taken.add(hit);
		}
	}
	return mapping;
}

export function defaultDetail(column: string): Detail {
	return {
		column,
		label: column,
		show: NAMEISH.includes(column.trim().toLowerCase())
	};
}

export interface SavedMapping {
	roles: Partial<Record<Role, string>>;
	details: Detail[];
}

export function savedMapping(columns: string[]): SavedMapping | null {
	try {
		const raw = localStorage.getItem(STORAGE_PREFIX + fingerprint(columns));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || !parsed.roles) return null;
		return { roles: parsed.roles, details: Array.isArray(parsed.details) ? parsed.details : [] };
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
	idOk: boolean;
	location: LocationStatus;
	ok: boolean;
}

export function mappingStatus(roles: Partial<Record<Role, string>>): MappingStatus {
	const idOk = !!roles.id;
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
	return { idOk, location, ok: idOk && (hasCoords || hasAddress) };
}

/** Apply a role mapping to parsed rows, producing records. */
export function applyMapping(
	rows: Record<string, string>[],
	columns: string[],
	roles: Partial<Record<Role, string>>
): Rec[] {
	const roleCols = new Set(Object.values(roles).filter(Boolean) as string[]);
	const extraCols = columns.filter((c) => !roleCols.has(c));
	const get = (row: Record<string, string>, role: Role): string | undefined => {
		const col = roles[role];
		const v = col ? row[col]?.trim() : undefined;
		return v === '' ? undefined : v;
	};

	return rows.map((row, i) => {
		const latRaw = get(row, 'lat');
		const lonRaw = get(row, 'lon');
		const lat = latRaw != null ? Number(latRaw.replace(',', '.')) : undefined;
		const lon = lonRaw != null ? Number(lonRaw.replace(',', '.')) : undefined;
		const located = lat != null && lon != null && isFinite(lat) && isFinite(lon);
		return {
			id: get(row, 'id') ?? `row-${i}`,
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
