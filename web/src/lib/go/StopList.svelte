<script lang="ts">
	/**
	 * The rolling window: a few stops behind you, several ahead. Not the whole
	 * bucket — fifty rows is a scroll hunt, and the only rows that matter are
	 * the ones around where you are.
	 *
	 * This view is also the offline fallback. Tiles need the network and GPS
	 * needs a secure context; the name, the address, the leg distance and the
	 * checkbox need neither. If the map dies mid-round, this still delivers it.
	 */
	import { walkStore, fmtM, type WalkStop } from './walk.svelte';
	import { addressOf } from '$lib/rounds/types';

	let {
		onpick,
		ondelivered
	}: { onpick?: (stop: WalkStop) => void; ondelivered?: () => void } = $props();

	const nextId = $derived(walkStore.next?.id ?? null);

	function tick(stop: WalkStop, done: boolean) {
		if (done) {
			// Undoing is a correction, not progress — it must not move the map.
			walkStore.undeliver(stop.id);
			return;
		}
		walkStore.markDelivered(stop.id);
		ondelivered?.();
	}
</script>

<ol class="stops">
	{#each walkStore.window as stop, i (stop.id)}
		{@const done = walkStore.delivered.has(stop.id)}
		<li class="row" class:done class:next={stop.id === nextId}>
			<button
				class="seq"
				title="Show on the map"
				onclick={() => onpick?.(stop)}
			>
				{stop.seq}
			</button>
			<button class="what" onclick={() => onpick?.(stop)}>
				{#each stop.people as person, p (p)}
					{#if person.name}
						<span class="name">{person.name}</span>
					{/if}
					{#if person.rest.length}
						<span class="rest">
							{#each person.rest as [label, value] (label)}
								<span class="bit"><em>{label}</em> {value}</span>
							{/each}
						</span>
					{/if}
				{/each}
				<span class="addr">
					{addressOf(stop)}
					{#if stop.people.length > 1}
						<em class="cards">{stop.people.length} cards</em>
					{/if}
				</span>
			</button>
			<button
				class="tick"
				aria-pressed={done}
				aria-label={done ? `Undo ${addressOf(stop)}` : `Mark ${addressOf(stop)} delivered`}
				onclick={() => tick(stop, done)}
			>
				{done ? '✓' : ''}
			</button>
		</li>
		{#if stop.legToNext && i < walkStore.window.length - 1}
			<li class="leg" aria-hidden="true">
				<span>↓ {fmtM(stop.legToNext.distance_m)}</span>
			</li>
		{/if}
	{/each}
</ol>

{#if walkStore.complete}
	<p class="done-all">
		Bucket walked — all {walkStore.total} delivered.
	</p>
{/if}

<style>
	.stops {
		list-style: none;
		margin: 0;
		padding: 0.4rem 0 1.5rem;
	}

	.row {
		display: flex;
		align-items: stretch;
		gap: 0.6rem;
		padding: 0.15rem 0.75rem;
	}

	.row.next .what {
		border-left: 3px solid var(--accent);
		padding-left: 0.6rem;
	}

	.row.done .name,
	.row.done .addr {
		text-decoration: line-through;
	}

	.row.done {
		opacity: 0.5;
	}

	.seq {
		flex-shrink: 0;
		width: 2.4rem;
		border: none;
		background: none;
		padding: 0;
		font-family: var(--font-mono);
		font-size: 0.95rem;
		color: var(--muted);
		text-align: right;
	}

	.row.next .seq {
		color: var(--accent);
		font-weight: 600;
	}

	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.05rem;
		border: none;
		background: none;
		padding: 0.45rem 0;
		text-align: left;
	}

	.name {
		font-family: var(--font-display);
		font-weight: 640;
		font-size: 1.15rem;
		line-height: 1.2;
	}

	.addr {
		font-size: 1rem;
		color: var(--muted);
	}

	/* A household is one doorstep and one tick, but you post several cards —
	   say how many so a hand full of them is accounted for. */
	.cards {
		font-style: normal;
		font-size: 0.75rem;
		color: var(--accent);
		font-weight: 600;
		margin-left: 0.35rem;
	}

	.rest {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: var(--muted);
	}

	.bit em {
		font-style: normal;
		opacity: 0.7;
	}

	.tick {
		flex-shrink: 0;
		width: 3rem;
		min-height: 3rem;
		align-self: center;
		border: 2px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		font-size: 1.4rem;
		line-height: 1;
		color: var(--accent-ink);
	}

	.row.done .tick {
		background: var(--accent);
		border-color: var(--accent);
	}

	.leg {
		margin: 0 0 0 3rem;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--muted);
	}

	.done-all {
		text-align: center;
		color: var(--muted);
		padding: 0 1rem 2rem;
	}

	/* Fast taps must not zoom the page. */
	button {
		touch-action: manipulation;
	}
</style>
