/**
 * The /go map layers, kept out of the component so the specs stay readable.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 * 1. THE ARROWS ARE A DRAWN IMAGE, not a text glyph. Every filled triangle
 *    you would reach for — '▸' U+25B8, '►' U+25BA, '▶' U+25B6 — is absent
 *    from the Noto Sans fontstack on the tile host (the whole Geometric
 *    Shapes range ships one glyph: a dotted circle), and a missing codepoint
 *    renders *nothing at all* — no tofu box, no console error, no `error`
 *    event. '›' U+203A does exist, but it is a 6x11 hairline: on a 10px route
 *    line it reads as a tick, not a direction. So the arrowhead is painted
 *    into an ImageData at runtime and added with `map.addImage`. No font
 *    dependency, solid ink, and exact control of size.
 *
 * 2. THE ARROWS ARE A CUTOUT, not tinted. Drawn in the bucket colour they
 *    would be invisible against the bucket-coloured line, and several of the
 *    12 bucket colours (slate, ochre) are already marginal outdoors. So the
 *    route gets a background-coloured casing underneath, and the arrowheads
 *    are painted in that same background colour on top — legible in both
 *    themes and in sunlight, whatever colour the bucket happens to be.
 *
 * `addImage` is per-style, so a theme flip's `setStyle` drops it along with
 * the layers; both are re-added together here. A `styleimagemissing` handler
 * in GoMap covers the ordering race.
 */
import type { Map as MlMap } from 'maplibre-gl';
import { cssColor } from '$lib/map/basemap';

export const SOURCE_ROUTE = 'go-route';
export const SOURCE_LEG = 'go-leg';
export const SOURCE_STOPS = 'go-stops';
export const LAYER_STOPS = 'go-stop-dot';
export const LAYER_ROUTE = 'go-route-line';
export const ARROW_IMAGE = 'go-arrow';

/** How many stops ahead of the next one keep an always-visible number. */
export const FOCUS_AHEAD = 2;

/**
 * A right-pointing arrowhead as raw pixels. Drawn at 2x and declared with
 * `pixelRatio: 2`, so it stays crisp on a phone screen.
 */
export function arrowImage(color: string): ImageData {
	const size = 28; // device px at pixelRatio 2 → 14 CSS px
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const inset = size * 0.16;
	ctx.beginPath();
	ctx.moveTo(inset, inset);
	ctx.lineTo(size - inset, size / 2);
	ctx.lineTo(inset, size - inset);
	ctx.closePath();
	ctx.fillStyle = color;
	// A slightly rounded join keeps the tip from looking chipped when scaled.
	ctx.lineJoin = 'round';
	ctx.lineWidth = size * 0.12;
	ctx.strokeStyle = color;
	ctx.stroke();
	ctx.fill();
	return ctx.getImageData(0, 0, size, size);
}

export function addGoLayers(m: MlMap, routeColor: string) {
	if (m.getSource(SOURCE_ROUTE)) return;

	const bg = cssColor('--bg', '#fafaf7');
	const fg = cssColor('--fg', '#1a1b1e');
	const muted = cssColor('--muted', '#6e6d66');
	const panel = cssColor('--panel', '#ffffff');
	const ink = cssColor('--accent-ink', '#fbfaf6');

	m.addSource(SOURCE_ROUTE, {
		type: 'geojson',
		data: { type: 'FeatureCollection', features: [] }
	});

	// Casing first: a wider halo in the page background, so the line reads
	// against roofs, parks and water regardless of the bucket colour.
	m.addLayer({
		id: 'go-route-casing',
		type: 'line',
		source: SOURCE_ROUTE,
		layout: { 'line-cap': 'round', 'line-join': 'round' },
		paint: {
			'line-color': bg,
			'line-width': ['interpolate', ['linear'], ['zoom'], 13, 7, 18, 15],
			'line-opacity': 0.9
		}
	});

	m.addLayer({
		id: 'go-route-line',
		type: 'line',
		source: SOURCE_ROUTE,
		layout: { 'line-cap': 'round', 'line-join': 'round' },
		paint: {
			'line-color': routeColor,
			'line-width': ['interpolate', ['linear'], ['zoom'], 13, 4, 18, 10],
			// a straight-line fallback route is an approximation — show it
			'line-dasharray': [
				'case',
				['get', 'approximate'],
				['literal', [2, 1.5]],
				['literal', [1, 0]]
			]
		}
	});

	// The stretch to the next stop, emphasised by weight and opacity rather
	// than a colour of its own — the bucket palette is categorical, so any hue
	// picked here would clash with some bucket and read as a third route on
	// another. Contrast works whatever colour the bucket happens to be.
	m.addSource(SOURCE_LEG, {
		type: 'geojson',
		data: { type: 'FeatureCollection', features: [] }
	});
	m.addLayer({
		id: 'go-route-next',
		type: 'line',
		source: SOURCE_LEG,
		layout: { 'line-cap': 'round', 'line-join': 'round' },
		paint: {
			'line-color': routeColor,
			'line-width': ['interpolate', ['linear'], ['zoom'], 13, 7, 18, 14]
		}
	});

	if (!m.hasImage(ARROW_IMAGE)) {
		m.addImage(ARROW_IMAGE, arrowImage(bg), { pixelRatio: 2 });
	}

	m.addLayer({
		id: 'go-route-arrows',
		type: 'symbol',
		source: SOURCE_ROUTE,
		layout: {
			'symbol-placement': 'line',
			'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 14, 60, 18, 110],
			'icon-image': ARROW_IMAGE,
			'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.45, 16, 0.7, 19, 1],
			'icon-rotation-alignment': 'map',
			'icon-pitch-alignment': 'map',
			// Without this the arrowheads flip on westward legs and point backwards.
			'icon-keep-upright': false,
			'icon-allow-overlap': true,
			'icon-ignore-placement': true
		}
	});

	m.addSource(SOURCE_STOPS, {
		type: 'geojson',
		data: { type: 'FeatureCollection', features: [] }
	});

	m.addLayer({
		id: LAYER_STOPS,
		type: 'circle',
		source: SOURCE_STOPS,
		layout: {
			// next on top, then upcoming, delivered underneath
			'circle-sort-key': ['case', ['get', 'next'], 2, ['get', 'done'], 0, 1]
		},
		paint: {
			'circle-radius': [
				'interpolate',
				['linear'],
				['zoom'],
				13,
				['case', ['get', 'next'], 8, 4],
				16,
				['case', ['get', 'next'], 14, 9],
				19,
				['case', ['get', 'next'], 20, 13]
			],
			'circle-color': [
				'case',
				['get', 'next'],
				routeColor,
				['get', 'done'],
				muted,
				panel
			],
			'circle-opacity': ['case', ['get', 'done'], 0.35, 1],
			'circle-stroke-width': ['case', ['get', 'next'], 3, 1.5],
			'circle-stroke-color': ['case', ['get', 'next'], fg, routeColor]
		}
	});

	// Numbers come in two layers because text-allow-overlap is data-constant —
	// it takes zoom expressions but not ['get', …], so "always show the next
	// few" cannot be one data-driven property.
	m.addLayer({
		id: 'go-stop-num',
		type: 'symbol',
		source: SOURCE_STOPS,
		// Below walking zoom the numbers are mush and there is nothing to read;
		// the line and the emphasized next dot carry the overview on their own.
		minzoom: 16,
		filter: ['!', ['get', 'focus']],
		layout: {
			// a raw number fails style validation — coerce it
			'text-field': ['to-string', ['get', 'n']],
			'text-font': ['Noto Sans Medium'],
			'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 19, 14],
			'text-allow-overlap': false,
			// don't crowd out the basemap's street labels, but do de-conflict
			// against each other; lower visit numbers win
			'text-ignore-placement': true,
			'symbol-sort-key': ['get', 'n'],
			'text-padding': 1
		},
		paint: {
			'text-color': ['case', ['get', 'done'], bg, fg],
			'text-halo-color': bg,
			'text-halo-width': 1
		}
	});

	m.addLayer({
		id: 'go-stop-num-focus',
		type: 'symbol',
		source: SOURCE_STOPS,
		filter: ['get', 'focus'],
		layout: {
			'text-field': ['to-string', ['get', 'n']],
			'text-font': ['Noto Sans Medium'],
			'text-size': ['interpolate', ['linear'], ['zoom'], 13, 11, 19, 15],
			'text-allow-overlap': true,
			'text-ignore-placement': true
		},
		paint: {
			'text-color': ink,
			'text-halo-color': routeColor,
			'text-halo-width': 1.5
		}
	});
}
