<script lang="ts">
	import { bucketsStore } from './buckets.svelte';
	import { routesStore } from '$lib/routes/routes.svelte';

	let mergeSelection = $state<Set<string>>(new Set());

	function toggleMerge(id: string) {
		const next = new Set(mergeSelection);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		mergeSelection = next;
	}

	function doMerge() {
		bucketsStore.merge([...mergeSelection]);
		mergeSelection = new Set();
	}

	function fmtDuration(s: number): string {
		const m = Math.round(s / 60);
		return m >= 60 ? `${Math.floor(m / 60)}u${String(m % 60).padStart(2, '0')}` : `${m} min`;
	}

	function fmtKm(m: number): string {
		return `${(m / 1000).toFixed(1)} km`;
	}
</script>

<div class="buckets">
	<div class="head">
		<h2>buckets</h2>
		{#if mergeSelection.size >= 2}
			<button class="primary" onclick={doMerge}>merge {mergeSelection.size}</button>
		{/if}
		<button title="New empty bucket" onclick={() => bucketsStore.createEmpty()}>+</button>
	</div>

	{#if bucketsStore.list.length === 0}
		<p class="empty">
			No buckets yet. Add one with <strong>+</strong> above, then draw dots into it
			with <strong>add to</strong> in the toolbar — or use auto-seed as a starting
			point.
		</p>
	{/if}

	{#each bucketsStore.list as bucket (bucket.id)}
		{@const doors = bucketsStore.doorCounts.get(bucket.id) ?? 0}
		{@const cards = bucketsStore.counts.get(bucket.id) ?? 0}
		{@const over = doors > bucketsStore.maxStops}
		{@const routeResult = routesStore.results.get(bucket.id)}
		{@const status = routesStore.status.get(bucket.id)}
		{@const stale =
			routeResult && routeResult.version !== (bucketsStore.dirty.get(bucket.id) ?? 0)}
		<div
			class="bucket"
			class:activeb={bucket.id === bucketsStore.activeId}
			onclick={() => (bucketsStore.activeId = bucket.id)}
			onkeydown={(e) => e.key === 'Enter' && (bucketsStore.activeId = bucket.id)}
			role="button"
			tabindex="0"
		>
			<div class="row">
				<input
					type="checkbox"
					title="Select for merge"
					checked={mergeSelection.has(bucket.id)}
					onclick={(e) => {
						e.stopPropagation();
						toggleMerge(bucket.id);
					}}
				/>
				<span class="chip" style:background={bucket.color}></span>
				<input
					class="name"
					value={bucket.name}
					onclick={(e) => e.stopPropagation()}
					onchange={(e) => bucketsStore.rename(bucket.id, e.currentTarget.value)}
				/>
				<!-- doors is what capacity is measured in; the card count only
				     shows when a household makes the two differ -->
				<span class="count mono" class:over title="{doors} doors · {cards} cards">
					{doors}{#if cards !== doors}<em>+{cards - doors}</em>{/if}
				</span>
				<button
					class="del"
					title="Delete bucket (points become unassigned)"
					onclick={(e) => {
						e.stopPropagation();
						bucketsStore.remove(bucket.id);
					}}>×</button
				>
			</div>
			<div class="row sub">
				<input
					class="carrier"
					placeholder="carrier"
					value={bucket.carrier ?? ''}
					list="carrier-names"
					onclick={(e) => e.stopPropagation()}
					onchange={(e) =>
						bucketsStore.setCarrier(bucket.id, e.currentTarget.value || undefined)}
				/>
				<span class="marks mono" title="start / end">
					{bucket.startId ? 'S' : '·'}{bucket.endId ? 'E' : '·'}
				</span>
				{#if status?.state === 'computing'}
					<span class="routeinfo">routing…</span>
				{:else if status?.state === 'error'}
					<span class="routeinfo err" title={status.message}>{status.message}</span>
				{:else if routeResult}
					<span class="routeinfo mono" class:stale>
						{fmtKm(routeResult.distance_m)} · {fmtDuration(routeResult.totalS)}
						{#if routeResult.engine === 'fallback'}≈{/if}
						{#if stale}(stale){/if}
					</span>
				{/if}
			</div>
			{#if over}
				<p class="warn">over capacity — split or raise the limit</p>
			{/if}
		</div>
	{/each}

	<datalist id="carrier-names">
		{#each bucketsStore.carriers as c (c)}
			<option value={c}></option>
		{/each}
	</datalist>
</div>

<style>
	.buckets {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.head h2 {
		font-size: 0.95rem;
		flex: 1;
	}

	.empty {
		color: var(--muted);
		font-size: 0.85rem;
	}

	.bucket {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 0.45rem 0.55rem;
		cursor: pointer;
		background: var(--panel);
	}

	.bucket.activeb {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.sub {
		margin-top: 0.25rem;
	}

	.chip {
		width: 0.85rem;
		height: 0.85rem;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.name {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		padding: 0.1rem 0.2rem;
		font-weight: 600;
	}

	.count em {
		font-style: normal;
		font-size: 0.85em;
		color: var(--accent);
		margin-left: 0.05em;
	}

	.count {
		font-size: 0.8rem;
		color: var(--muted);
	}

	.count.over {
		color: var(--warn);
		font-weight: 600;
	}

	.del {
		border: none;
		background: none;
		color: var(--muted);
		padding: 0 0.2rem;
		font-size: 1rem;
	}

	.del:hover {
		color: var(--warn);
	}

	.carrier {
		width: 7rem;
		font-size: 0.8rem;
		padding: 0.15rem 0.35rem;
	}

	.marks {
		font-size: 0.78rem;
		color: var(--muted);
		letter-spacing: 0.15em;
	}

	.routeinfo {
		font-size: 0.75rem;
		color: var(--muted);
		margin-left: auto;
		text-align: right;
	}

	.routeinfo.err {
		color: var(--warn);
		max-width: 10rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.routeinfo.stale {
		opacity: 0.6;
	}

	.warn {
		color: var(--warn);
		font-size: 0.78rem;
		margin: 0.25rem 0 0;
	}
</style>
