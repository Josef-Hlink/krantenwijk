<script lang="ts">
	import { onMount } from 'svelte';
	import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
	import type { FeatureCollection, Point, Polygon, LineString } from 'geojson';
	import { loadMapLibre, flavorName, cssColor } from './basemap';
	import { createDraw, type DrawManager } from './draw';
	import { recordsStore } from '$lib/records/records.svelte';
	import { bucketsStore } from '$lib/buckets/buckets.svelte';
	import { routesStore } from '$lib/routes/routes.svelte';
	import { UNASSIGNED_COLOR } from '$lib/buckets/palette';
	import { pointInPolygon } from '$lib/geometry/pointInPolygon';
	import { ui } from '$lib/ui.svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';

	let el: HTMLDivElement | undefined = $state();
	let map = $state<MlMap | undefined>();
	let drawManager: DrawManager | undefined;
	let styleReady = $state(0); // bumped on every style.load → effects re-add data

	// ── data derivations ─────────────────────────────────────────────────

	const dotsData = $derived.by<FeatureCollection<Point>>(() => ({
		type: 'FeatureCollection',
		features: recordsStore.located.map((r) => {
			const bucketId = bucketsStore.assignment.get(r.id);
			const bucket = bucketId ? bucketsStore.buckets.get(bucketId) : undefined;
			return {
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [r.lon!, r.lat!] },
				properties: {
					id: r.id,
					color: bucket?.color ?? UNASSIGNED_COLOR,
					active: bucketId != null && bucketId === bucketsStore.activeId,
					assigned: bucket != null
				}
			};
		})
	}));

	const markersData = $derived.by<FeatureCollection<Point>>(() => {
		const byId = new Map(recordsStore.located.map((r) => [r.id, r]));
		const features: FeatureCollection<Point>['features'] = [];
		for (const b of bucketsStore.list) {
			for (const [role, recId] of [
				['S', b.startId],
				['E', b.endId]
			] as const) {
				const r = recId ? byId.get(recId) : undefined;
				if (r) {
					features.push({
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [r.lon!, r.lat!] },
						properties: { label: role, color: b.color }
					});
				}
			}
		}
		return { type: 'FeatureCollection', features };
	});

	const routesData = $derived.by<FeatureCollection<LineString>>(() => ({
		type: 'FeatureCollection',
		features: [...routesStore.results.entries()]
			.filter(([bucketId]) => bucketsStore.buckets.has(bucketId))
			.map(([bucketId, result]) => ({
				type: 'Feature',
				geometry: { type: 'LineString', coordinates: result.geometry },
				properties: {
					color: bucketsStore.buckets.get(bucketId)!.color,
					approximate: result.engine === 'fallback'
				}
			}))
	}));

	// ── layers ───────────────────────────────────────────────────────────

	function addAppLayers(m: MlMap) {
		if (m.getSource('records')) return;
		const halo = flavorName() === 'dark' ? '#16181d' : '#ffffff';

		m.addSource('routes', { type: 'geojson', data: routesData });
		m.addLayer({
			id: 'route-lines',
			type: 'line',
			source: 'routes',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-width': 3,
				'line-opacity': 0.75,
				// fallback routes are straight-line approximations — show it
				'line-dasharray': ['case', ['get', 'approximate'], ['literal', [2, 1.5]], ['literal', [1, 0]]]
			}
		});

		m.addSource('records', { type: 'geojson', data: dotsData });
		m.addLayer({
			id: 'record-dots',
			type: 'circle',
			source: 'records',
			paint: {
				// zoom expressions must be top-level, so the active-bucket size
				// boost lives inside each interpolation stop
				'circle-radius': [
					'interpolate',
					['linear'],
					['zoom'],
					10,
					['case', ['get', 'active'], 4, 2.5],
					13,
					['case', ['get', 'active'], 6, 4.5],
					16,
					['case', ['get', 'active'], 9.5, 8]
				],
				'circle-color': ['get', 'color'],
				'circle-opacity': ['case', ['get', 'assigned'], 1, 0.8],
				'circle-stroke-width': [
					'interpolate',
					['linear'],
					['zoom'],
					10,
					['case', ['get', 'active'], 1, 0.5],
					16,
					['case', ['get', 'active'], 3, 1.5]
				],
				'circle-stroke-color': ['case', ['get', 'active'], cssColor('--fg', '#1a1b1e'), halo]
			}
		});

		m.addSource('markers', { type: 'geojson', data: markersData });
		m.addLayer({
			id: 'start-end-markers',
			type: 'circle',
			source: 'markers',
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 12],
				'circle-color': ['get', 'color'],
				'circle-stroke-width': 2,
				'circle-stroke-color': halo
			}
		});
		m.addLayer({
			id: 'start-end-labels',
			type: 'symbol',
			source: 'markers',
			layout: {
				'text-field': ['get', 'label'],
				'text-font': ['Noto Sans Medium'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 13],
				'text-allow-overlap': true
			},
			paint: { 'text-color': halo }
		});
	}

	// Keep sources in sync with the stores (and re-apply after restyles).
	$effect(() => {
		void styleReady;
		(map?.getSource('records') as GeoJSONSource | undefined)?.setData(dotsData);
	});
	$effect(() => {
		void styleReady;
		(map?.getSource('markers') as GeoJSONSource | undefined)?.setData(markersData);
	});
	$effect(() => {
		void styleReady;
		(map?.getSource('routes') as GeoJSONSource | undefined)?.setData(routesData);
	});

	// The armed tool decides whether terra-draw is live and the cursor shape.
	$effect(() => {
		drawManager?.setShape(ui.drawing ? ui.drawShape : null);
		if (map) {
			const c = map.getCanvas();
			c.style.cursor = ui.drawing ? 'crosshair' : '';
		}
	});

	// ── interactions ─────────────────────────────────────────────────────

	function onShape(polygon: Polygon) {
		const inside = recordsStore.located
			.filter((r) => pointInPolygon(r.lon!, r.lat!, polygon))
			.map((r) => r.id);
		if (!inside.length) return;
		if (ui.tool === 'draw-new') {
			bucketsStore.createWithPoints(inside);
		} else if (ui.tool === 'draw-assign' && bucketsStore.activeId) {
			bucketsStore.assignToActive(inside);
		}
	}

	function clickedRecordId(m: MlMap, e: MapMouseEvent): string | null {
		const hits = m.queryRenderedFeatures(
			[
				[e.point.x - 6, e.point.y - 6],
				[e.point.x + 6, e.point.y + 6]
			],
			{ layers: ['record-dots'] }
		);
		return (hits[0]?.properties?.id as string | undefined) ?? null;
	}

	function onClick(m: MlMap, e: MapMouseEvent) {
		if (ui.drawing) return; // terra-draw owns the pointer
		const recordId = clickedRecordId(m, e);
		if (!recordId) return;
		switch (ui.tool) {
			case 'select': {
				const bucketId = bucketsStore.assignment.get(recordId);
				if (bucketId) bucketsStore.activeId = bucketId;
				break;
			}
			case 'toggle':
				bucketsStore.togglePoint(recordId);
				break;
			case 'pick-start':
				if (bucketsStore.activeId) {
					bucketsStore.setStart(bucketsStore.activeId, recordId);
					ui.tool = 'select';
				}
				break;
			case 'pick-end':
				if (bucketsStore.activeId) {
					bucketsStore.setEnd(bucketsStore.activeId, recordId);
					ui.tool = 'select';
				}
				break;
		}
	}

	onMount(() => {
		let observer: MutationObserver | undefined;
		let destroyed = false;

		(async () => {
			const { ml, basemapStyle } = await loadMapLibre();
			if (destroyed || !el) return;

			const m = new ml.Map({
				container: el,
				style: basemapStyle(flavorName()),
				bounds: recordsStore.bounds ?? [
					[3.53, 51.42],
					[3.64, 51.49]
				],
				fitBoundsOptions: { padding: 60 }
			});
			map = m;
			m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
			m.addControl(new ml.ScaleControl({}), 'bottom-left');

			// setStyle drops user sources/layers, so everything app-owned is
			// (re)added on every style.load — including the very first one.
			m.on('style.load', () => {
				addAppLayers(m);
				styleReady++;
			});

			m.on('load', () => {
				if (destroyed) return;
				drawManager = createDraw(m, onShape);
				drawManager.setShape(ui.drawing ? ui.drawShape : null);
			});

			m.on('click', (e) => onClick(m, e));

			// Theme flip → full restyle; app layers ride style.load back in.
			// terra-draw's own layers don't survive a restyle, so rebuild it.
			observer = new MutationObserver(() => {
				drawManager?.destroy();
				drawManager = undefined;
				m.setStyle(basemapStyle(flavorName()));
				m.once('idle', () => {
					if (destroyed) return;
					drawManager = createDraw(m, onShape);
					drawManager.setShape(ui.drawing ? ui.drawShape : null);
				});
			});
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme']
			});
		})();

		return () => {
			destroyed = true;
			observer?.disconnect();
			drawManager?.destroy();
			drawManager = undefined;
			map?.remove();
			map = undefined;
		};
	});
</script>

<div class="map" bind:this={el}></div>

<style>
	.map {
		width: 100%;
		height: 100%;
	}
</style>
