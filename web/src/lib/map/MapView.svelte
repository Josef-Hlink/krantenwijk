<script lang="ts">
	import { onMount } from 'svelte';
	import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
	import type { FeatureCollection, Point } from 'geojson';
	import { loadMapLibre, flavorName, cssColor } from './basemap';
	import { recordsStore } from '$lib/records/records.svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';

	let {
		onmapready
	}: { onmapready?: (map: MlMap) => void } = $props();

	let el: HTMLDivElement | undefined = $state();
	let map = $state<MlMap | undefined>();
	let styleReady = $state(0); // bumped on every style.load → effects re-add data

	const dotsData = $derived.by<FeatureCollection<Point>>(() => ({
		type: 'FeatureCollection',
		features: recordsStore.located.map((r) => ({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [r.lon!, r.lat!] },
			properties: { id: r.id, category: r.category ?? '' }
		}))
	}));

	function addAppLayers(m: MlMap) {
		if (m.getSource('records')) return;
		m.addSource('records', { type: 'geojson', data: dotsData });
		m.addLayer({
			id: 'record-dots',
			type: 'circle',
			source: 'records',
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 13, 4.5, 16, 8],
				'circle-color': cssColor('--accent', '#ee5f00'),
				'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 1.5],
				'circle-stroke-color': flavorName() === 'dark' ? '#16181d' : '#ffffff'
			}
		});
	}

	// Keep the dots source in sync with the record set (and re-apply after restyles).
	$effect(() => {
		void styleReady;
		const src = map?.getSource('records') as GeoJSONSource | undefined;
		src?.setData(dotsData);
	});

	onMount(() => {
		let observer: MutationObserver | undefined;
		let destroyed = false;

		(async () => {
			const { ml, basemapStyle } = await loadMapLibre();
			if (destroyed || !el) return;

			map = new ml.Map({
				container: el,
				style: basemapStyle(flavorName()),
				bounds: recordsStore.bounds ?? [
					[4.7, 52.25],
					[5.05, 52.45]
				],
				fitBoundsOptions: { padding: 60 }
			});
			map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
			map.addControl(new ml.ScaleControl({}), 'bottom-left');

			// setStyle drops user sources/layers, so everything app-owned is
			// (re)added on every style.load — including the very first one.
			map.on('style.load', () => {
				if (!map) return;
				addAppLayers(map);
				styleReady++;
			});

			map.on('load', () => {
				if (map) onmapready?.(map);
			});

			// Theme flip → full restyle; app layers ride style.load back in.
			observer = new MutationObserver(() => {
				map?.setStyle(basemapStyle(flavorName()));
			});
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme']
			});
		})();

		return () => {
			destroyed = true;
			observer?.disconnect();
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
