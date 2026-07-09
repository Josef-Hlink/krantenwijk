/**
 * Shared MapLibre + Protomaps basemap loader (pattern borrowed from okai).
 *
 * Vector tiles come from a single self-hosted .pmtiles archive — by default
 * the one the engine serves with range requests, overridable at build time
 * via VITE_TILES_URL to point at a shared tile host instead. Glyphs and
 * sprites are vendored under /static/basemaps — no third-party requests.
 * krantenwijk themes map to Protomaps flavors: avond → dark, ochtend → light.
 *
 * Everything heavy loads through dynamic import so pages without a map never
 * pull MapLibre into their chunk.
 */
import type { StyleSpecification } from 'maplibre-gl';

export type Flavor = 'light' | 'dark';

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
		glyphs: `${location.origin}/basemaps/fonts/{fontstack}/{range}.pbf`,
		sprite: `${location.origin}/basemaps/sprites/v4/${flavor}`,
		sources: {
			protomaps: {
				type: 'vector',
				url: `pmtiles://${import.meta.env.VITE_TILES_URL ?? `${location.origin}/api/tiles/basemap.pmtiles`}`,
				attribution:
					'<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
			}
		},
		layers: layers('protomaps', namedFlavor(flavor), { lang: 'nl' })
	});

	return { ml, basemapStyle };
}
