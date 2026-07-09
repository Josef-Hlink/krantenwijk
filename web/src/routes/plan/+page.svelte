<script lang="ts">
	import { goto } from '$app/navigation';
	import MapView from '$lib/map/MapView.svelte';
	import GeocodePanel from '$lib/geocode/GeocodePanel.svelte';
	import { recordsStore } from '$lib/records/records.svelte';

	// Direct navigation to /plan without data → back to upload.
	$effect(() => {
		if (recordsStore.records.length === 0) goto('/');
	});
</script>

<div class="workspace">
	<aside class="rail">
		<div class="section">
			<h2>round</h2>
			<p class="stat">
				<span class="mono">{recordsStore.located.length}</span> on the map
				{#if recordsStore.needGeocode.length > 0}
					· <span class="mono">{recordsStore.needGeocode.length}</span> to geocode
				{/if}
			</p>
			{#if recordsStore.categories.length > 0}
				<p class="stat muted">
					{#each recordsStore.categories as cat, i (cat)}
						{i > 0 ? ' · ' : ''}{cat}
						<span class="mono"
							>{recordsStore.records.filter((r) => r.category === cat).length}</span
						>
					{/each}
				</p>
			{/if}
		</div>
		<hr class="rule-double" />
		<GeocodePanel />
		<div class="section muted">
			<p>Buckets arrive in the next step — draw tools land here.</p>
		</div>
	</aside>
	<div class="mapwrap">
		<MapView />
	</div>
</div>

<style>
	.workspace {
		display: flex;
		height: 100%;
	}

	.rail {
		width: 300px;
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
		font-size: 0.85rem;
	}

	.mapwrap {
		flex: 1;
		min-width: 0;
	}
</style>
