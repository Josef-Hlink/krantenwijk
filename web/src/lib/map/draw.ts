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
	TerraDrawFreehandMode
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { DrawShape } from '$lib/ui.svelte';

export interface DrawManager {
	setShape(shape: DrawShape | null): void;
	destroy(): void;
}

export function createDraw(map: MlMap, onShape: (polygon: Polygon) => void): DrawManager {
	const draw = new TerraDraw({
		adapter: new TerraDrawMapLibreGLAdapter({ map }),
		modes: [
			new TerraDrawPolygonMode(),
			new TerraDrawRectangleMode(),
			new TerraDrawFreehandMode()
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
