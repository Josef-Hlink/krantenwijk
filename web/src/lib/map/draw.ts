/**
 * terra-draw wrapper. Drawn shapes are transient selection gestures: the
 * moment a shape is finished it's handed to the caller for point-in-polygon
 * assignment and deleted — membership lives per point in the bucket store,
 * never as geometry.
 */
import type { Map as MlMap } from 'maplibre-gl';
import type { Polygon } from 'geojson';
import {
	TerraDraw,
	TerraDrawPolygonMode,
	TerraDrawRectangleMode,
	TerraDrawFreehandMode,
	type HexColor,
	type SetCursor
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { DrawShape } from '$lib/ui.svelte';

// The drawing cursor: a pencil, paper-white with an ink outline so it reads
// on any basemap. Terra-draw's modes re-assert their configured cursor as
// they handle events (stomping anything set from outside), so the pencil is
// wired into the modes below rather than only set on the canvas.
const pencilSvg =
	'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
	'<path d="M3 21l2.2-6.2L16.8 3.2l4 4L9.2 18.8z" fill="#fbfaf6" stroke="#1a1b1e" stroke-width="1.6" stroke-linejoin="round"/>' +
	'<path d="M5.2 14.8l4 4M14.5 5.5l4 4" stroke="#1a1b1e" stroke-width="1.6"/>' +
	'</svg>';
export const PENCIL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(pencilSvg)}") 3 21, crosshair`;

// terra-draw types cursors as a fixed union of CSS keywords, but its
// maplibre adapter assigns the string verbatim, so url(…) cursors work.
const pencil = PENCIL_CURSOR as Parameters<SetCursor>[0];

export interface DrawManager {
	setShape(shape: DrawShape | null): void;
	destroy(): void;
}

export function createDraw(
	map: MlMap,
	onShape: (polygon: Polygon) => void,
	getColor: () => string
): DrawManager {
	// The in-progress shape paints in the active bucket's color — the lasso
	// previews where its points will land. Function-valued styles are
	// re-evaluated as the shape updates, so the getter stays live.
	const color = () => getColor() as HexColor;
	const shape = {
		fillColor: color,
		fillOpacity: 0.12,
		outlineColor: color,
		outlineWidth: 2
	};
	const closing = {
		closingPointColor: color
	};
	const draw = new TerraDraw({
		adapter: new TerraDrawMapLibreGLAdapter({ map }),
		modes: [
			new TerraDrawPolygonMode({ cursors: { start: pencil }, styles: { ...shape, ...closing } }),
			new TerraDrawRectangleMode({ cursors: { start: pencil }, styles: shape }),
			new TerraDrawFreehandMode({ cursors: { start: pencil }, styles: { ...shape, ...closing } })
		]
	});
	draw.start();

	draw.on('finish', (id, context) => {
		if (context.action !== 'draw') return;
		const feature = draw.getSnapshotFeature(id);
		if (feature?.geometry.type === 'Polygon') {
			onShape(feature.geometry as Polygon);
		}
		draw.removeFeatures([id]);
	});

	return {
		setShape(shape: DrawShape | null) {
			// 'static' is terra-draw's built-in inert mode — no tool armed.
			draw.setMode(shape ?? 'static');
		},
		destroy() {
			if (draw.enabled) draw.stop();
		}
	};
}
