<script lang="ts">
	import { goto } from '$app/navigation';
	import MapView from '$lib/map/MapView.svelte';
	import Toolbar from '$lib/map/Toolbar.svelte';
	import GeocodePanel from '$lib/geocode/GeocodePanel.svelte';
	import BucketList from '$lib/buckets/BucketList.svelte';
	import { recordsStore } from '$lib/records/records.svelte';
	import { bucketsStore } from '$lib/buckets/buckets.svelte';

	// Direct navigation to /plan without data → back to upload.
	$effect(() => {
		if (recordsStore.records.length === 0) goto('/');
	});

	function onKeydown(e: KeyboardEvent) {
		const mod = e.metaKey || e.ctrlKey;
		if (!mod || e.key.toLowerCase() !== 'z') return;
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
		e.preventDefault();
		if (e.shiftKey) bucketsStore.redo();
		else bucketsStore.undo();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="workspace">
	<aside class="rail">
		<div class="section">
			<h2>round</h2>
			<p class="stat">
				<span class="mono">{recordsStore.stops.length}</span> doors ·
				<span class="mono">{recordsStore.located.length}</span> cards ·
				<span class="mono">{bucketsStore.doorCounts.values().reduce((a, b) => a + b, 0)}</span>
				bucketed
				{#if recordsStore.needGeocode.length > 0}
					· <span class="mono">{recordsStore.needGeocode.length}</span> to geocode
				{/if}
				{#if recordsStore.skippedStops.length > 0}
					· <span class="muted"
						><span class="mono">{recordsStore.skippedStops.length}</span> skipped</span
					>
				{/if}
			</p>
		</div>
		<hr class="rule-double" />
		<GeocodePanel />
		<BucketList />
	</aside>
	<div class="main">
		<Toolbar />
		<div class="mapwrap">
			<MapView />
		</div>
	</div>
</div>

<style>
	.workspace {
		display: flex;
		height: 100%;
	}

	.rail {
		width: 320px;
		flex-shrink: 0;
		border-right: 1px solid var(--border);
		padding: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		overflow-y: auto;
	}

	.rail h2 {
		font-size: 0.95rem;
		text-transform: lowercase;
	}

	.stat {
		margin: 0.3rem 0 0;
		font-size: 0.9rem;
	}

	.muted {
		color: var(--muted);
	}

	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.mapwrap {
		flex: 1;
		min-height: 0;
	}
</style>
