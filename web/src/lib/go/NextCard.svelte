<script lang="ts">
	/**
	 * The bottom card in map mode: who is next, how far, and one big button.
	 *
	 * The button is one-way on purpose. A fat-fingered double tap on a toggle
	 * would deliver and then undeliver, and you would walk on believing it was
	 * done. Undo lives on the list rows, where you can see the tick first.
	 *
	 * Because delivering advances the card to the next stop, one-way alone is
	 * not enough: a genuine double tap would deliver two houses, and you would
	 * walk past the second. Hence the settle window below — a second press
	 * inside it is a slip, not an intent.
	 */
	import { walkStore, fmtM, type WalkStop } from './walk.svelte';
	import { geo, haversineM } from './geolocation.svelte';
	import { addressOf } from '$lib/rounds/types';

	let { stop, ondelivered }: { stop: WalkStop; ondelivered?: () => void } = $props();

	// Distance from where you actually are, when we know — otherwise the
	// planned walk from the previous stop.
	const away = $derived.by(() => {
		if (geo.fix) return haversineM(geo.fix, stop);
		const i = walkStore.stops.findIndex((s) => s.id === stop.id);
		return i > 0 ? (walkStore.stops[i - 1].legToNext?.distance_m ?? null) : null;
	});

	const done = $derived(walkStore.delivered.has(stop.id));

	/** Two taps this close together are one fumbled tap. */
	const SETTLE_MS = 700;
	let lastDeliverAt = 0;

	function deliver() {
		const now = Date.now();
		if (now - lastDeliverAt < SETTLE_MS) return;
		lastDeliverAt = now;
		walkStore.markDelivered(stop.id);
		ondelivered?.();
	}
</script>

<div class="card">
	<div class="top">
		<span class="seq">{stop.seq}<em>/{walkStore.total}</em></span>
		<div class="who">
			{#if stop.name}<span class="name">{stop.name}</span>{/if}
			<span class="addr">{addressOf(stop)}</span>
		</div>
		{#if away != null}
			<span class="away" class:live={geo.fix != null}>{fmtM(away)}</span>
		{/if}
	</div>

	{#if stop.rest.length}
		<div class="rest">
			{#each stop.rest as [label, value] (label)}
				<span><em>{label}</em> {value}</span>
			{/each}
		</div>
	{/if}

	<div class="actions">
		{#if done}
			<button class="ghost" onclick={() => walkStore.undeliver(stop.id)}>
				delivered ✓ — undo
			</button>
		{:else}
			<button class="big" onclick={deliver}> delivered </button>
		{/if}
	</div>
</div>

<style>
	.card {
		background: var(--panel);
		border-top: 1px solid var(--fg);
		padding: 0.7rem 1rem calc(0.7rem + env(safe-area-inset-bottom));
		padding-left: calc(1rem + env(safe-area-inset-left));
		padding-right: calc(1rem + env(safe-area-inset-right));
	}

	.top {
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
	}

	.seq {
		font-family: var(--font-mono);
		font-size: 1.1rem;
		color: var(--accent);
		font-weight: 600;
		flex-shrink: 0;
	}

	.seq em {
		font-style: normal;
		font-size: 0.75rem;
		color: var(--muted);
		font-weight: 400;
	}

	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.name {
		font-family: var(--font-display);
		font-weight: 640;
		font-size: 1.35rem;
		line-height: 1.15;
	}

	.addr {
		font-size: 1.05rem;
		color: var(--muted);
	}

	.away {
		font-family: var(--font-mono);
		font-size: 0.95rem;
		color: var(--muted);
		flex-shrink: 0;
	}

	/* A live GPS distance is a different claim from a planned leg — say so. */
	.away.live {
		color: var(--fg);
	}

	.rest {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.3rem;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.rest em {
		font-style: normal;
		opacity: 0.7;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}

	.big {
		flex: 1;
		min-height: 3.4rem;
		font-size: 1.15rem;
		font-weight: 600;
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
		border-radius: 8px;
	}

	.ghost {
		flex: 1;
		min-height: 3.4rem;
		border-radius: 8px;
		color: var(--muted);
	}

	button {
		touch-action: manipulation;
	}
</style>
