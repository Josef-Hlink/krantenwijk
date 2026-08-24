<script lang="ts">
	/**
	 * The walking map. A fork of MapView's structure, not a reuse of it: the
	 * planning map is built on hover popups, a pencil cursor and terra-draw,
	 * none of which mean anything to a thumb. What is copied deliberately is
	 * the style.load → re-add-layers + styleReady counter idiom, because a
	 * theme flip calls setStyle and drops every app-owned source.
	 */
	import { onMount } from 'svelte';
	import type { GeoJSONSource, Map as MlMap, MapMouseEvent, Marker } from 'maplibre-gl';
	import type { FeatureCollection, LineString, Point } from 'geojson';
	import { loadMapLibre, flavorName, cssColor } from '$lib/map/basemap';
	import { walkStore, type WalkStop } from './walk.svelte';
	import { geo } from './geolocation.svelte';
	import {
		addGoLayers,
		arrowImage,
		ARROW_IMAGE,
		FOCUS_AHEAD,
		LAYER_ROUTE,
		LAYER_STOPS,
		SOURCE_LEG,
		SOURCE_ROUTE,
		SOURCE_STOPS
	} from './layers';
	import { legTo, snapIndices, type Coord } from './legpath';
	import 'maplibre-gl/dist/maplibre-gl.css';

	let { onpick }: { onpick: (stop: WalkStop) => void } = $props();

	let el: HTMLDivElement | undefined = $state();
	let map = $state<MlMap | undefined>();
	let styleReady = $state(0);
	let userMarker: Marker | undefined;
	let following = $state(true);

	const routeColor = $derived(walkStore.bucket?.color ?? '#1f6feb');

	const routeData = $derived.by<FeatureCollection<LineString>>(() => {
		const b = walkStore.bucket;
		if (!b || b.geometry.length < 2) {
			return { type: 'FeatureCollection', features: [] };
		}
		return {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					geometry: { type: 'LineString', coordinates: b.geometry },
					properties: { approximate: b.legs.length === 0 }
				}
			]
		};
	});

	// Snapping is O(stops x vertices), so it is keyed on the bucket only —
	// not on which stops are delivered.
	const snapped = $derived.by(() => {
		const b = walkStore.bucket;
		if (!b || b.geometry.length === 0) return [];
		return snapIndices(b.geometry as Coord[], walkStore.stops);
	});

	const legData = $derived.by<FeatureCollection<LineString>>(() => {
		const b = walkStore.bucket;
		const coords =
			b && snapped.length
				? legTo(b.geometry as Coord[], snapped, walkStore.nextIndex)
				: [];
		return coords.length < 2
			? { type: 'FeatureCollection', features: [] }
			: {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							geometry: { type: 'LineString', coordinates: coords },
							properties: {}
						}
					]
				};
	});

	const stopsData = $derived.by<FeatureCollection<Point>>(() => {
		const nextIdx = walkStore.nextIndex;
		return {
			type: 'FeatureCollection',
			features: walkStore.stops.map((s, i) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
				properties: {
					id: s.id,
					n: s.seq,
					done: walkStore.delivered.has(s.id),
					next: i === nextIdx,
					// the next stop and the couple after it keep their numbers at
					// every zoom; the rest yield to each other above z16
					focus: nextIdx >= 0 && i >= nextIdx && i <= nextIdx + FOCUS_AHEAD
				}
			}))
		};
	});

	$effect(() => {
		void styleReady;
		(map?.getSource(SOURCE_ROUTE) as GeoJSONSource | undefined)?.setData(routeData);
	});
	$effect(() => {
		void styleReady;
		(map?.getSource(SOURCE_STOPS) as GeoJSONSource | undefined)?.setData(stopsData);
	});
	$effect(() => {
		void styleReady;
		(map?.getSource(SOURCE_LEG) as GeoJSONSource | undefined)?.setData(legData);
	});

	// Fade the rest of the route back only while a leg is actually picked out,
	// so a round you have not started yet still reads at full strength.
	$effect(() => {
		void styleReady;
		if (!map?.getLayer(LAYER_ROUTE)) return;
		const highlighting = legData.features.length > 0;
		map.setPaintProperty(LAYER_ROUTE, 'line-opacity', highlighting ? 0.4 : 1);
	});

	// The position dot is a DOM Marker, not a layer: markers survive setStyle
	// on a theme flip for free, and a 1 Hz fix must never rebuild the stops
	// FeatureCollection or re-run label collision.
	$effect(() => {
		const fix = geo.fix;
		if (!map || !userMarker || !fix) return;
		userMarker.setLngLat([fix.lon, fix.lat]);
		userMarker.getElement().style.display = '';
		if (following) map.easeTo({ center: [fix.lon, fix.lat], duration: 600 });
	});

	export function resize() {
		map?.resize();
	}

	export function recenter() {
		const fix = geo.fix;
		following = true;
		if (fix && map) {
			map.easeTo({ center: [fix.lon, fix.lat], zoom: Math.max(map.getZoom(), 17) });
		} else {
			frameRoute();
		}
	}

	export function frameRoute() {
		const b = walkStore.bucket;
		if (!map || !b) return;
		const pts = walkStore.stops;
		if (!pts.length) return;
		let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
		for (const p of pts) {
			w = Math.min(w, p.lon); e = Math.max(e, p.lon);
			s = Math.min(s, p.lat); n = Math.max(n, p.lat);
		}
		map.fitBounds([[w, s], [e, n]], { padding: 48, duration: 600 });
	}

	/** Look at one stop, and stop chasing the walker while they do. */
	export function goTo(stop: WalkStop) {
		following = false;
		map?.easeTo({ center: [stop.lon, stop.lat], zoom: Math.max(map.getZoom(), 17.5) });
	}

	/**
	 * Frame the walk ahead: your position and the next stop together, so the
	 * gap between them is the thing on screen.
	 *
	 * Without a fix — no GPS permission, or testing away from the round — it
	 * falls back to framing the leg itself (previous stop to next), which is
	 * still "how do I get there" and is the same shape on screen.
	 */
	export function showWayToNext() {
		const next = walkStore.next;
		if (!map || !next) return;
		const pts: [number, number][] = [[next.lon, next.lat]];
		const fix = geo.fix;
		if (fix) {
			pts.push([fix.lon, fix.lat]);
		} else {
			const prev = walkStore.stops[walkStore.nextIndex - 1];
			if (prev) pts.push([prev.lon, prev.lat]);
		}
		following = false;
		if (pts.length === 1) {
			map.easeTo({ center: pts[0], zoom: Math.max(map.getZoom(), 17.5), duration: 600 });
			return;
		}
		let w = Infinity, s2 = Infinity, e = -Infinity, n2 = -Infinity;
		for (const [lon, lat] of pts) {
			w = Math.min(w, lon); e = Math.max(e, lon);
			s2 = Math.min(s2, lat); n2 = Math.max(n2, lat);
		}
		map.fitBounds(
			[
				[w, s2],
				[e, n2]
			],
			// maxZoom matters: standing 15 m from the door would otherwise
			// fit to z22 and you would lose all surrounding context.
			{ padding: 80, maxZoom: 18, duration: 700 }
		);
	}

	/**
	 * Back to walking: follow the position again if we have one, otherwise
	 * put the next stop in the middle. Either way the camera is live again.
	 */
	export function resume(next: WalkStop | null) {
		following = true;
		const fix = geo.fix;
		const target = fix ? ([fix.lon, fix.lat] as [number, number]) : next ? [next.lon, next.lat] as [number, number] : null;
		if (target && map) {
			map.easeTo({ center: target, zoom: Math.max(map.getZoom(), 17), duration: 600 });
		}
	}

	/** Nearest hit inside a thumb-sized box — draw order is not proximity. */
	function tappedStop(m: MlMap, e: MapMouseEvent): WalkStop | null {
		const R = 16;
		const hits = m.queryRenderedFeatures(
			[
				[e.point.x - R, e.point.y - R],
				[e.point.x + R, e.point.y + R]
			],
			{ layers: [LAYER_STOPS] }
		);
		let bestId: string | null = null;
		let bestD = Infinity;
		for (const f of hits) {
			const [lon, lat] = (f.geometry as Point).coordinates as [number, number];
			const p = m.project([lon, lat]);
			const d = (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
			if (d < bestD) {
				bestD = d;
				bestId = f.properties?.id as string;
			}
		}
		return walkStore.stops.find((s) => s.id === bestId) ?? null;
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
				center: [3.57, 51.44],
				zoom: 14,
				// One-handed pinching almost always injects rotation, and a
				// rotated north breaks "numbers upright, chevrons forward".
				dragRotate: false,
				pitchWithRotate: false,
				touchPitch: false,
				keyboard: false,
				maxPitch: 0,
				clickTolerance: 6, // default 3px — a thumb moves further than that
				fadeDuration: 0,
				attributionControl: { compact: true }
			});
			map = m;
			m.touchZoomRotate.disableRotation();

			const dot = document.createElement('div');
			dot.className = 'go-user-dot';
			dot.style.display = 'none';
			userMarker = new ml.Marker({ element: dot }).setLngLat([3.57, 51.44]).addTo(m);

			// Belt and braces for the add-image/add-layer ordering: if the
			// symbol layer ever renders before the image exists, MapLibre asks.
			m.on('styleimagemissing', (e) => {
				if (e.id === ARROW_IMAGE && !m.hasImage(ARROW_IMAGE)) {
					m.addImage(ARROW_IMAGE, arrowImage(cssColor('--bg', '#fafaf7')), {
						pixelRatio: 2
					});
				}
			});

			m.on('style.load', () => {
				addGoLayers(m, routeColor);
				styleReady++;
			});

			m.on('load', () => {
				if (!destroyed) frameRoute();
			});

			// Any manual pan means the walker wants to look ahead; stop chasing
			// them with the camera until they tap recenter.
			m.on('dragstart', () => (following = false));

			m.on('click', (e) => {
				const stop = tappedStop(m, e);
				if (stop) {
					following = false;
					onpick(stop);
				}
			});

			observer = new MutationObserver(() => {
				m.setStyle(basemapStyle(flavorName()));
			});
			observer.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['data-theme']
			});
		})();

		return () => {
			destroyed = true;
			observer?.disconnect();
			userMarker?.remove();
			userMarker = undefined;
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

	/* The position dot is injected outside Svelte's scope. */
	.map :global(.go-user-dot) {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #1d7fe0;
		border: 3px solid var(--bg);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
	}

	.map :global(.maplibregl-ctrl-attrib) {
		font-size: 0.68rem;
	}
</style>
