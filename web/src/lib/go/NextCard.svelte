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
	import { walkStore, fmtM, nameLine, type WalkStop } from './walk.svelte';
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
			<span class="addr">
				{addressOf(stop)}
				{#if stop.cardCount > 1}
					<em class="cards">{stop.cardCount} cards</em>
				{/if}
			</span>
			{#if stop.names.length}
				<span class="names">{nameLine(stop.names)}</span>
			{/if}
		</div>
		{#if away != null}
			<span class="away" class:live={geo.fix != null}>{fmtM(away)}</span>
		{/if}
	</div>

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

	/* Address leads: it is what you match against the house in front of you.
	   The names confirm it once you are at the letterbox. */
	.addr {
		font-family: var(--font-display);
		font-weight: 640;
		font-size: 1.35rem;
		line-height: 1.2;
	}

	.names {
		font-size: 1rem;
		color: var(--muted);
		line-height: 1.25;
	}

	.cards {
		font-style: normal;
		font-size: 0.8rem;
		color: var(--accent);
		font-weight: 600;
		margin-left: 0.4rem;
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
