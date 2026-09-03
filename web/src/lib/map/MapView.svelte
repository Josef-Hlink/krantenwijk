<script lang="ts">
	import { onMount } from 'svelte';
	import type { GeoJSONSource, Map as MlMap, MapMouseEvent, Popup } from 'maplibre-gl';
	import type { FeatureCollection, Point, Polygon, LineString } from 'geojson';
	import { loadMapLibre, flavorName, cssColor } from './basemap';
	import { createDraw, PENCIL_CURSOR, type DrawManager } from './draw';
	import { recordsStore, type Rec } from '$lib/records/records.svelte';
	import { bucketsStore } from '$lib/buckets/buckets.svelte';
	import { routesStore } from '$lib/routes/routes.svelte';
	import { UNASSIGNED_COLOR, DEACTIVATED_COLOR } from '$lib/buckets/palette';
	import { pointInPolygon } from '$lib/geometry/pointInPolygon';
	import { ui } from '$lib/ui.svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';

	let el: HTMLDivElement | undefined = $state();
	let map = $state<MlMap | undefined>();
	let drawManager: DrawManager | undefined;
	let styleReady = $state(0); // bumped on every style.load → effects re-add data
	let hoverPopup: Popup | undefined;
	let pinnedPopup: Popup | undefined;
	let hoverId: string | null = null;

	// ── data derivations ─────────────────────────────────────────────────

	// One dot per door, not per card: a household called up twice is one
	// place you walk to. `id` is the door's first card, which is also how it
	// is represented to the engine. Deactivated doors are drawn too — grey,
	// so a slip is something you see rather than something that vanished.
	const dotsData = $derived.by<FeatureCollection<Point>>(() => ({
		type: 'FeatureCollection',
		features: [
			...recordsStore.stops.map((stop) => {
				const bucketId = bucketsStore.assignment.get(stop.recIds[0]);
				const bucket = bucketId ? bucketsStore.buckets.get(bucketId) : undefined;
				return {
					type: 'Feature' as const,
					geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
					properties: {
						id: stop.recIds[0],
						cards: stop.recIds.length,
						color: bucket?.color ?? UNASSIGNED_COLOR,
						active: bucketId != null && bucketId === bucketsStore.activeId,
						assigned: bucket != null,
						deactivated: false
					}
				};
			}),
			...recordsStore.deactivatedStops.map((stop) => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
				properties: {
					id: stop.recIds[0],
					cards: stop.recIds.length,
					color: DEACTIVATED_COLOR,
					active: false,
					assigned: false,
					deactivated: true
				}
			}))
		]
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
				// A doorstep with several cards reads a shade larger. Like the
				// active boost, the multiplier has to live *inside* each stop:
				// a zoom expression may only be the top-level input to
				// interpolate, so wrapping this in a '*' silently rejects the
				// whole layer.
				'circle-radius': [
					'interpolate',
					['linear'],
					['zoom'],
					10,
					['*', ['case', ['>', ['get', 'cards'], 1], 1.35, 1], ['case', ['get', 'active'], 4, 2.5]],
					13,
					['*', ['case', ['>', ['get', 'cards'], 1], 1.35, 1], ['case', ['get', 'active'], 6, 4.5]],
					16,
					['*', ['case', ['>', ['get', 'cards'], 1], 1.35, 1], ['case', ['get', 'active'], 9.5, 8]]
				],
				// A deactivated door is a hollow ring: still a place on the map,
				// visibly nothing to carry there.
				'circle-color': ['case', ['get', 'deactivated'], halo, ['get', 'color']],
				'circle-opacity': ['case', ['get', 'assigned'], 1, 0.8],
				'circle-stroke-width': [
					'interpolate',
					['linear'],
					['zoom'],
					10,
					['case', ['get', 'active'], 1, ['get', 'deactivated'], 0.8, 0.5],
					16,
					['case', ['get', 'active'], 3, ['get', 'deactivated'], 2, 1.5]
				],
				'circle-stroke-color': [
					'case',
					['get', 'active'],
					cssColor('--fg', '#1a1b1e'),
					['get', 'deactivated'],
					DEACTIVATED_COLOR,
					halo
				]
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

	// ── cursors ──────────────────────────────────────────────────────────
	// Each tool announces itself at the pointer: a pencil while drawing, a
	// cell cross while toggling, a crosshair while picking start/end.
	const toolCursor = $derived(
		ui.placing
			? 'crosshair'
			: ui.drawing
				? PENCIL_CURSOR
				: ui.tool === 'toggle'
					? 'cell'
					: ui.tool === 'pick-start' || ui.tool === 'pick-end'
						? 'crosshair'
						: ''
	);

	// The armed tool decides whether terra-draw is live and the cursor shape.
	// Placing a door suspends drawing so the click reaches us, not terra-draw.
	$effect(() => {
		drawManager?.setShape(ui.drawing && !ui.placing ? ui.drawShape : null);
		if (map) map.getCanvas().style.cursor = toolCursor;
	});

	// ── interactions ─────────────────────────────────────────────────────

	// The lasso previews in the active bucket's color (see createDraw).
	function activeBucketColor(): string {
		return (
			(bucketsStore.activeId
				? bucketsStore.buckets.get(bucketsStore.activeId)?.color
				: undefined) ?? UNASSIGNED_COLOR
		);
	}

	function onShape(polygon: Polygon) {
		// Select doors, then take every card behind each — a lasso edge must
		// never cut a household in half.
		const inside = recordsStore.stops
			.filter((stop) => pointInPolygon(stop.lon, stop.lat, polygon))
			.flatMap((stop) => stop.recIds);
		if (!inside.length) return;
		if (ui.tool === 'draw-assign' && bucketsStore.activeId) {
			bucketsStore.assignToActive(inside);
			ui.tool = 'select';
		}
	}

	// Popup content is user CSV data — built as DOM text nodes, never HTML.
	// `interactive` adds the start/end actions; only the pinned popup can be
	// interacted with (the hover one vanishes on mouseleave).
	function popupContent(r: Rec, interactive = false): HTMLElement {
		const root = document.createElement('div');
		root.className = 'dot-popup';
		const title = document.createElement('div');
		title.className = 'title';
		title.textContent = [r.street, r.houseNumber].filter(Boolean).join(' ') || r.id;
		root.appendChild(title);

		const detailRow = (label: string, value: string, cls = 'drow') => {
			const row = document.createElement('div');
			row.className = cls;
			const lbl = document.createElement('span');
			lbl.className = 'dlbl';
			lbl.textContent = label;
			const val = document.createElement('span');
			val.className = 'dval';
			val.textContent = value;
			row.append(lbl, val);
			root.appendChild(row);
			return row;
		};

		// Every card at this door, not just the one that happens to represent
		// it — otherwise a household of three looks like a single delivery.
		const cardIds = recordsStore.cardsAt(r.id);
		const cards = cardIds
			.map((id) => recordsStore.records.find((rec) => rec.id === id))
			.filter((rec) => rec != null);
		const deactivated = recordsStore.deactivated.has(r.id);

		if (deactivated) {
			const note = document.createElement('div');
			note.className = 'dcount';
			note.textContent = 'deactivated — not in the round';
			root.appendChild(note);
		}

		if (cards.length > 1) {
			const count = document.createElement('div');
			count.className = 'dcount';
			count.textContent = `${cards.length} cards at this door`;
			root.appendChild(count);
		}

		for (const card of cards) {
			if (cards.length > 1) {
				const sep = document.createElement('div');
				sep.className = 'dcard';
				root.appendChild(sep);
			}
			for (const d of recordsStore.shownDetails) {
				const v = card.extra[d.column]?.trim();
				if (v) detailRow(d.label, v);
			}
		}

		// Live plan state: the dot's bucket (and its carrier, if set) —
		// this is where an assigned carrier shows up, not the CSV columns.
		const bucketId = bucketsStore.assignment.get(r.id);
		const bucket = bucketId ? bucketsStore.buckets.get(bucketId) : undefined;
		if (bucket) {
			const row = detailRow('bucket', bucket.name, 'drow brow');
			const chip = document.createElement('span');
			chip.className = 'dchip';
			chip.style.background = bucket.color;
			row.querySelector('.dval')?.prepend(chip);
			if (bucket.carrier) detailRow('carrier', bucket.carrier);

		}

		if (interactive) {
			const actions = document.createElement('div');
			actions.className = 'dactions';
			const refresh = () => pinnedPopup?.setDOMContent(popupContent(r, true));
			if (bucket) {
				for (const [role, key] of [
					['start', 'startId'],
					['end', 'endId']
				] as const) {
					const isSet = bucket[key] === r.id;
					const btn = document.createElement('button');
					btn.textContent = isSet ? `unmark ${role}` : `mark as ${role}`;
					btn.onclick = () => {
						const set = role === 'start' ? 'setStart' : 'setEnd';
						bucketsStore[set](bucket.id, isSet ? undefined : r.id);
						refresh();
					};
					actions.appendChild(btn);
				}
			}
			// The geocoder can be wrong by a street; the next map click says
			// where this door really is.
			const move = document.createElement('button');
			move.textContent = 'move';
			move.title = 'Click the map where this door really is';
			move.onclick = () => {
				ui.placing = { recIds: cardIds, label: title.textContent ?? r.id };
				pinnedPopup?.remove();
			};
			actions.appendChild(move);

			// Out of the round, not out of the file: the door greys out and
			// stops being seeded, bucketed or routed, and one click undoes it.
			const flip = document.createElement('button');
			flip.className = 'ddeactivate';
			flip.textContent = deactivated ? 'reactivate' : 'deactivate';
			flip.onclick = () => {
				if (deactivated) bucketsStore.reactivate(cardIds);
				else bucketsStore.deactivate(cardIds);
				refresh();
			};
			actions.appendChild(flip);
			root.appendChild(actions);
		}
		return root;
	}

	function onHover(m: MlMap, e: MapMouseEvent) {
		if (ui.placing) return; // the crosshair stays; no peeking while aiming
		if (ui.drawing) {
			// terra-draw owns the pointer, but it occasionally unsets the
			// cursor (letting maplibre's grab hand through) — restore the
			// pencil whenever the inline cursor has been cleared.
			const c = m.getCanvas();
			if (!c.style.cursor) c.style.cursor = toolCursor;
			return;
		}
		const recordId = clickedRecordId(m, e);
		// dots are clickable in select mode; other tools keep their cursor
		m.getCanvas().style.cursor =
			recordId && ui.tool === 'select' ? 'pointer' : toolCursor;
		if (!recordId) {
			hoverId = null;
			hoverPopup?.remove();
			return;
		}
		if (pinnedPopup?.isOpen()) return; // a pinned card wins over the peek
		if (recordId === hoverId) return;
		const r = recordsStore.located.find((rec) => rec.id === recordId);
		if (!r) return;
		hoverId = recordId;
		hoverPopup?.setLngLat([r.lon!, r.lat!]).setDOMContent(popupContent(r)).addTo(m);
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
		if (ui.placing) {
			const { recIds } = ui.placing;
			recordsStore.place(recIds, e.lngLat.lat, e.lngLat.lng);
			ui.placing = null;
			return;
		}
		if (ui.drawing) return; // terra-draw owns the pointer
		const recordId = clickedRecordId(m, e);
		if (!recordId) {
			pinnedPopup?.remove(); // click on empty map dismisses the pinned card
			return;
		}
		// A deactivated door only answers to the select tool: it can be
		// inspected and brought back, never toggled or marked into a bucket.
		if (ui.tool !== 'select' && recordsStore.deactivated.has(recordId)) return;
		switch (ui.tool) {
			case 'select': {
				const bucketId = bucketsStore.assignment.get(recordId);
				if (bucketId) bucketsStore.activeId = bucketId;
				const r = recordsStore.located.find((rec) => rec.id === recordId);
				if (r) {
					hoverId = null;
					hoverPopup?.remove();
					pinnedPopup
						?.setLngLat([r.lon!, r.lat!])
						.setDOMContent(popupContent(r, true))
						.addTo(m);
				}
				break;
			}
			case 'toggle':
				bucketsStore.toggleDoor(recordsStore.expandToDoors([recordId]));
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

			// Popups: a cursor-following peek and a click-pinned card. Both are
			// DOM overlays, so they survive theme restyles.
			hoverPopup = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: '260px' });
			pinnedPopup = new ml.Popup({ closeButton: true, closeOnClick: false, offset: 10, maxWidth: '260px' });
			m.on('mousemove', (e) => onHover(m, e));

			// setStyle drops user sources/layers, so everything app-owned is
			// (re)added on every style.load — including the very first one.
			m.on('style.load', () => {
				addAppLayers(m);
				styleReady++;
			});

			m.on('load', () => {
				if (destroyed) return;
				drawManager = createDraw(m, onShape, activeBucketColor);
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
					drawManager = createDraw(m, onShape, activeBucketColor);
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
			hoverPopup?.remove();
			pinnedPopup?.remove();
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

	/* Popups are injected into the map container, outside Svelte's scope. */
	.map :global(.maplibregl-popup-content) {
		background: var(--panel);
		color: var(--fg);
		border: 1px solid var(--border);
		border-radius: 4px;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
		padding: 0.5rem 0.7rem;
		font-family: var(--font-body);
		font-size: 0.82rem;
	}

	.map :global(.maplibregl-popup-anchor-bottom .maplibregl-popup-tip),
	.map :global(.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip),
	.map :global(.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip) {
		border-top-color: var(--panel);
	}

	.map :global(.maplibregl-popup-anchor-top .maplibregl-popup-tip),
	.map :global(.maplibregl-popup-anchor-top-left .maplibregl-popup-tip),
	.map :global(.maplibregl-popup-anchor-top-right .maplibregl-popup-tip) {
		border-bottom-color: var(--panel);
	}

	.map :global(.maplibregl-popup-anchor-left .maplibregl-popup-tip) {
		border-right-color: var(--panel);
	}

	.map :global(.maplibregl-popup-anchor-right .maplibregl-popup-tip) {
		border-left-color: var(--panel);
	}

	.map :global(.maplibregl-popup-close-button) {
		color: var(--muted);
		font-size: 1.1rem;
		padding: 0 0.35rem;
	}

	.map :global(.dot-popup .title) {
		font-family: var(--font-display);
		font-weight: 640;
		font-size: 0.88rem;
		margin-right: 1rem; /* keep clear of the close button when pinned */
	}

	.map :global(.dot-popup .drow) {
		display: flex;
		justify-content: space-between;
		gap: 0.8rem;
		margin-top: 0.2rem;
	}

	.map :global(.dot-popup .dlbl) {
		color: var(--muted);
	}

	.map :global(.dot-popup .dval) {
		font-family: var(--font-mono);
		font-size: 0.78rem;
	}

	.map :global(.dot-popup .dcount) {
		font-size: 0.72rem;
		color: var(--muted);
		margin-top: 0.15rem;
	}

	.map :global(.dot-popup .dcard) {
		border-top: 1px dotted var(--border);
		margin-top: 0.35rem;
		padding-top: 0.1rem;
	}

	.map :global(.dot-popup .brow) {
		margin-top: 0.4rem;
		padding-top: 0.35rem;
		border-top: 1px solid var(--border);
	}

	.map :global(.dot-popup .dchip) {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-right: 0.35rem;
	}

	.map :global(.dot-popup .dactions) {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.45rem;
	}

	.map :global(.dot-popup .dactions button) {
		font-size: 0.72rem;
		padding: 0.15rem 0.5rem;
	}

	.map :global(.dot-popup .ddeactivate) {
		margin-left: auto;
		color: var(--muted);
	}
</style>
