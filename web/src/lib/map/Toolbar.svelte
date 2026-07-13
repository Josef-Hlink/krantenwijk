<script lang="ts">
	import { ui, type Tool, type DrawShape } from '$lib/ui.svelte';
	import { bucketsStore } from '$lib/buckets/buckets.svelte';
	import { recordsStore } from '$lib/records/records.svelte';
	import { routesStore } from '$lib/routes/routes.svelte';
	import { cluster } from '$lib/api/client';
	import { downloadExport } from '$lib/export/sorted';

	const TOOLS: { id: Tool; label: string; title: string; needsActive?: boolean }[] = [
		{ id: 'select', label: 'select', title: 'Click a dot to activate its bucket' },
		{ id: 'draw-new', label: '+ bucket', title: 'Draw a shape — points inside become a new bucket' },
		{
			id: 'draw-assign',
			label: 'add to',
			title: 'Draw a shape — points inside join the active bucket',
			needsActive: true
		},
		{
			id: 'toggle',
			label: 'toggle',
			title: 'Click dots to add/remove them from the active bucket',
			needsActive: true
		},
		{ id: 'pick-start', label: 'start', title: 'Click a dot to mark the route start', needsActive: true },
		{ id: 'pick-end', label: 'end', title: 'Click a dot to mark the route end', needsActive: true }
	];

	const SHAPES: DrawShape[] = ['freehand', 'polygon', 'rectangle'];

	let seedBusy = $state(false);
	let seedError = $state<string | null>(null);
	let nCarriers = $state(4);

	async function autoSeed() {
		seedBusy = true;
		seedError = null;
		try {
			const points = recordsStore.located.map((r) => ({
				id: r.id,
				lat: r.lat!,
				lon: r.lon!
			}));
			const assignments = await cluster(points, bucketsStore.maxStops, nCarriers);
			bucketsStore.applySeed(assignments);
		} catch (e) {
			seedError = e instanceof Error ? e.message : 'auto-seed failed';
		} finally {
			seedBusy = false;
		}
	}
</script>

<div class="toolbar">
	<div class="group" role="toolbar" aria-label="Bucket tools">
		{#each TOOLS as t (t.id)}
			<button
				class:armed={ui.tool === t.id}
				disabled={t.needsActive && !bucketsStore.activeId}
				title={t.title}
				onclick={() => (ui.tool = ui.tool === t.id ? 'select' : t.id)}
			>
				{t.label}
			</button>
		{/each}
	</div>

	{#if ui.drawing}
		<div class="group">
			{#each SHAPES as s (s)}
				<button class:armed={ui.drawShape === s} onclick={() => (ui.drawShape = s)}>
					{s}
				</button>
			{/each}
		</div>
	{/if}

	<div class="group grow"></div>

	<div class="group">
		<button
			disabled={!bucketsStore.history.canUndo}
			title="Undo (⌘Z)"
			onclick={() => bucketsStore.undo()}>↶</button
		>
		<button
			disabled={!bucketsStore.history.canRedo}
			title="Redo (⇧⌘Z)"
			onclick={() => bucketsStore.redo()}>↷</button
		>
	</div>

	<div class="group seed">
		<label title="Capacity per bucket">
			≤ <input type="number" min="1" bind:value={bucketsStore.maxStops} class="mono" />
		</label>
		<label title="Number of carriers">
			× <input type="number" min="1" bind:value={nCarriers} class="mono" />
		</label>
		<button disabled={seedBusy || recordsStore.located.length === 0} onclick={autoSeed}>
			{seedBusy ? 'seeding…' : 'auto-seed'}
		</button>
	</div>

	<div class="group">
		<button
			class="primary"
			disabled={routesStore.running || routesStore.stale.length === 0}
			title="Compute a walking route for every changed bucket"
			onclick={() => routesStore.computeAll()}
		>
			{routesStore.running
				? `routing ${routesStore.results.size + 1}/${bucketsStore.list.length}…`
				: routesStore.stale.length > 0
					? `compute routes (${routesStore.stale.length})`
					: 'routes up to date'}
		</button>
		<button
			disabled={bucketsStore.assignment.size === 0}
			title="Download the ordering as CSV, keyed by id"
			onclick={downloadExport}
		>
			export csv
		</button>
	</div>
</div>
{#if seedError}
	<p class="error">{seedError}</p>
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.45rem 0.9rem;
		border-bottom: 1px solid var(--border);
		background: var(--panel);
		flex-wrap: wrap;
	}

	.group {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}

	.grow {
		flex: 1;
	}

	button {
		font-size: 0.82rem;
		padding: 0.25rem 0.6rem;
	}

	button.armed {
		background: var(--postal);
		border-color: var(--postal);
		color: #fff;
	}

	.seed label {
		font-size: 0.82rem;
		color: var(--muted);
	}

	.seed input {
		width: 3.2rem;
		padding: 0.2rem 0.3rem;
		font-size: 0.82rem;
	}

	.error {
		color: var(--warn);
		font-size: 0.85rem;
		padding: 0.3rem 0.9rem;
		margin: 0;
	}
</style>
