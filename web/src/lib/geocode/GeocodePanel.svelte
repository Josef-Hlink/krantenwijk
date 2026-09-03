<script lang="ts">
	import { recordsStore } from '$lib/records/records.svelte';
	import { geocodeAll, uncachedCount, type GeocodeProgress } from './nominatim';
	import FixAddresses from './FixAddresses.svelte';

	// Only "running" is a stage of its own: any other time there are pending
	// rows, the consent panel shows — including after a fix puts rows back.
	let running = $state(false);
	let fixing = $state(false);
	let progress = $state<GeocodeProgress>({ done: 0, total: 0, failed: 0 });
	let controller: AbortController | undefined;

	const pending = $derived(recordsStore.needGeocode);
	const fresh = $derived(uncachedCount(pending));

	async function start() {
		running = true;
		controller = new AbortController();
		const batch = pending;
		progress = { done: 0, total: batch.length, failed: 0 };
		await geocodeAll(batch, (p) => (progress = p), controller.signal);
		// reassign to trigger derived state on mutated records
		recordsStore.records = [...recordsStore.records];
		running = false;
	}

	function cancel() {
		controller?.abort();
		running = false;
	}

	const eta = $derived(Math.ceil(((progress.total - progress.done) * 1.1) / 60));
</script>

{#if pending.length > 0 || running}
	<div class="panel">
		{#if !running}
			<p>
				<strong>{pending.length}</strong> addresses have no coordinates. Look them up
				via <strong>OpenStreetMap Nominatim</strong> (a public third-party service)?
				Each address is sent one per second; {fresh} of them
				{fresh === 1 ? 'is' : 'are'} not in your local cache yet.
			</p>
			<p class="fine">
				Prefer zero third-party exposure? Add lat/lon columns to your CSV instead.
			</p>
			<div class="actions">
				<button class="primary" onclick={start}>Geocode {pending.length} addresses</button>
			</div>
		{:else}
			<p>
				Geocoding <span class="mono">{progress.done}/{progress.total}</span>
				{#if progress.failed > 0}
					· <span class="failed">{progress.failed} not found</span>
				{/if}
				{#if eta > 0}
					· ~{eta} min left
				{/if}
			</p>
			<progress value={progress.done} max={progress.total}></progress>
			<div class="actions">
				<button onclick={cancel}>Stop</button>
			</div>
		{/if}
	</div>
{:else if recordsStore.failed.length > 0}
	<div class="panel">
		<p class="failed">
			{recordsStore.failed.length}
			{recordsStore.failed.length === 1 ? 'address' : 'addresses'} could not be
			geocoded and won't appear on the map:
		</p>
		<ul class="mono">
			{#each recordsStore.failed.slice(0, 8) as r (r.id)}
				<li>{[r.street, r.houseNumber, r.city].filter(Boolean).join(' ')}</li>
			{/each}
			{#if recordsStore.failed.length > 8}
				<li>… and {recordsStore.failed.length - 8} more</li>
			{/if}
		</ul>
		<div class="actions">
			<button onclick={() => (fixing = true)}>fix these addresses</button>
		</div>
	</div>
{/if}

{#if fixing}
	<FixAddresses onclose={() => (fixing = false)} />
{/if}

<style>
	.panel {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.8rem 1rem;
		font-size: 0.9rem;
	}

	.panel p {
		margin: 0 0 0.5rem;
	}

	.fine {
		color: var(--muted);
		font-size: 0.82rem;
	}

	.failed {
		color: var(--warn);
	}

	progress {
		width: 100%;
		accent-color: var(--accent);
	}

	.actions {
		margin-top: 0.5rem;
		display: flex;
		gap: 0.5rem;
	}

	ul {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.8rem;
		color: var(--muted);
	}
</style>
