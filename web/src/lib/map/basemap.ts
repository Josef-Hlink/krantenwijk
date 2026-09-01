/**
 * Shared MapLibre + Protomaps basemap loader (pattern borrowed from forj).
 *
 * Vector tiles, glyphs, and sprites come from the shared self-hosted tile
 * service (tiles.hlink.dev — a static vhost with Range support + open CORS,
 * shared with sibling projects). No third-party map requests. Overridable at
 * build time: VITE_TILES_URL for the .pmtiles archive (e.g. the engine's
 * /api/tiles route with a local extract), VITE_TILES_ASSETS for the
 * glyphs/sprites base. krantenwijk themes map to Protomaps flavors:
 * avond → dark, ochtend → light.
 *
 * Everything heavy loads through dynamic import so pages without a map never
 * pull MapLibre into their chunk.
 */
import type { StyleSpecification } from 'maplibre-gl';

export type Flavor = 'light' | 'dark';

const TILES_URL: string =
	import.meta.env.VITE_TILES_URL ?? 'https://tiles.hlink.dev/europe.pmtiles';
const ASSETS_BASE: string =
	import.meta.env.VITE_TILES_ASSETS ?? 'https://tiles.hlink.dev';

export const flavorName = (): Flavor =>
	document.documentElement.dataset.theme === 'avond' ? 'dark' : 'light';

export const cssColor = (name: string, fallback: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export async function loadMapLibre() {
	const [{ default: ml }, { Protocol }, { layers, namedFlavor }] = await Promise.all([
		import('maplibre-gl'),
		import('pmtiles'),
		import('@protomaps/basemaps')
	]);

	// Registering twice (component remounts) just overwrites — harmless.
	ml.addProtocol('pmtiles', new Protocol().tile);

	const basemapStyle = (flavor: Flavor): StyleSpecification => ({
		version: 8,
		glyphs: `${ASSETS_BASE}/fonts/{fontstack}/{range}.pbf`,
		sprite: `${ASSETS_BASE}/sprites/v4/${flavor}`,
		sources: {
			protomaps: {
				type: 'vector',
				url: `pmtiles://${TILES_URL}`,
				attribution:
					'<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
			}
		},
		layers: layers('protomaps', namedFlavor(flavor), { lang: 'nl' })
	});

	return { ml, basemapStyle };
}
