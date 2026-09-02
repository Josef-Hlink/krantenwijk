<script lang="ts">
	import { ui, type Tool, type DrawShape } from '$lib/ui.svelte';
	import { bucketsStore } from '$lib/buckets/buckets.svelte';
	import { recordsStore } from '$lib/records/records.svelte';
	import { routesStore } from '$lib/routes/routes.svelte';
	import { UNASSIGNED_COLOR } from '$lib/buckets/palette';
	import { cluster, createRound, ApiError } from '$lib/api/client';
	import { downloadExport } from '$lib/export/sorted';
	import { downloadGeocodedCsv, hasNewCoordinates } from '$lib/export/geocoded';
	import { buildRound } from '$lib/rounds/serialize';
	import { capability } from '$lib/rounds/capability.svelte';

	const TOOLS: { id: Tool; label: string; title: string; needsActive?: boolean }[] = [
		{ id: 'select', label: 'select', title: 'Click a dot to activate its bucket' },
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
		{
			id: 'pick-start',
			label: 'set start',
			title: 'Click a dot to mark the route start',
			needsActive: true
		},
		{
			id: 'pick-end',
			label: 'set end',
			title: 'Click a dot to mark the route end',
			needsActive: true
		}
	];

	const SHAPES: DrawShape[] = ['freehand', 'polygon', 'rectangle'];

	// Dot icons paint with the active bucket's color, like the map will.
	const activeColor = $derived(
		(bucketsStore.activeId
			? bucketsStore.buckets.get(bucketsStore.activeId)?.color
			: undefined) ?? UNASSIGNED_COLOR
	);

	let seedBusy = $state(false);
	let seedError = $state<string | null>(null);
	let nCarriers = $state(4);

	// Saving only exists on an instance configured to store rounds.
	capability.ensure();
	let saveState = $state<'idle' | 'saving' | 'saved'>('idle');

	async function saveRound() {
		const name = prompt('Name this round', 'ronde')?.trim();
		if (!name) return;
		saveState = 'saving';
		seedError = null;
		try {
			const saved = await createRound(buildRound(name));
			saveState = 'saved';
			// The id is how a phone finds it, so say it rather than hide it.
			seedError = `saved as "${saved.name}" — open /go on your phone to walk it`;
		} catch (e) {
			saveState = 'idle';
			seedError =
				e instanceof ApiError ? `could not save: ${e.message}` : 'engine unreachable';
		}
	}

	async function autoSeed() {
		seedBusy = true;
		seedError = null;
		try {
			// One point per door: capacity, and ORS's ~50-waypoint ceiling, are
			// both about places you walk to, not cards you carry.
			const points = recordsStore.doorPoints();
			const assignments = await cluster(points, bucketsStore.maxStops, nCarriers);
			bucketsStore.applySeed(
				assignments.flatMap((a) =>
					recordsStore
						.expandToDoors([a.id])
						.map((id) => ({ id, bucket: a.bucket }))
				)
			);
		} catch (e) {
			seedError = e instanceof Error ? e.message : 'auto-seed failed';
		} finally {
			seedBusy = false;
		}
	}
</script>

{#snippet icon(id: Tool | DrawShape)}
	<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
		{#if id === 'select'}
			<path
				d="M6.2 8.7V2.8a1.1 1.1 0 0 1 2.2 0v4.4l3.5 1c.8.2 1.3 1 1.2 1.8l-.4 2.2a2.6 2.6 0 0 1-2.6 2.2H8.3c-.7 0-1.4-.3-1.9-.8l-2.9-2.9a1.1 1.1 0 0 1 1.6-1.6z"
				fill="none"
				stroke="currentColor"
				stroke-width="1.3"
				stroke-linejoin="round"
			/>
		{:else if id === 'draw-assign'}
			<path
				d="M8 3.2v9.6M3.2 8h9.6"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
			/>
		{:else if id === 'toggle'}
			<circle cx="3.8" cy="11" r="2.1" fill={UNASSIGNED_COLOR} />
			<circle
				cx="10"
				cy="7"
				r="4.2"
				fill={activeColor}
				stroke="currentColor"
				stroke-width="1.2"
			/>
		{:else if id === 'pick-start' || id === 'pick-end'}
			<circle
				cx="8"
				cy="8"
				r="6"
				fill={activeColor}
				stroke="currentColor"
				stroke-width="1"
			/>
			<text x="8" y="10.7" text-anchor="middle" font-size="7.5" font-weight="700" fill="#fff">
				{id === 'pick-start' ? 'S' : 'E'}
			</text>
		{:else if id === 'freehand'}
			<path
				d="M2.5 13.5l1.4-4L10.6 2.8l2.6 2.6L6.5 12.1z"
				fill="currentColor"
				fill-opacity="0.15"
				stroke="currentColor"
				stroke-width="1.2"
				stroke-linejoin="round"
			/>
			<path d="M9.6 3.8l2.6 2.6" stroke="currentColor" stroke-width="1.2" />
		{:else if id === 'polygon'}
			<path
				d="M8 2.2 13.6 6.3 11.5 12.8H4.5L2.4 6.3Z"
				fill="currentColor"
				fill-opacity="0.15"
				stroke="currentColor"
				stroke-width="1.1"
				stroke-linejoin="round"
			/>
			{#each [[8, 2.2], [13.6, 6.3], [11.5, 12.8], [4.5, 12.8], [2.4, 6.3]] as [x, y] (x)}
				<circle cx={x} cy={y} r="1.1" fill="currentColor" />
			{/each}
		{:else if id === 'rectangle'}
			<rect
				x="2.5"
				y="4"
				width="11"
				height="8"
				rx="1"
				fill="currentColor"
				fill-opacity="0.15"
				stroke="currentColor"
				stroke-width="1.1"
			/>
		{/if}
	</svg>
{/snippet}

<div class="toolbar">
	<div class="group" role="toolbar" aria-label="Bucket tools">
		{#each TOOLS as t (t.id)}
			<button
				class:armed={ui.tool === t.id}
				disabled={t.needsActive && !bucketsStore.activeId}
				title={t.title}
				onclick={() => (ui.tool = ui.tool === t.id ? 'select' : t.id)}
			>
				{@render icon(t.id)}
				{t.label}
			</button>
		{/each}
	</div>

	{#if ui.drawing}
		<div class="group">
			{#each SHAPES as s (s)}
				<button class:armed={ui.drawShape === s} onclick={() => (ui.drawShape = s)}>
					{@render icon(s)}
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
		{#if hasNewCoordinates()}
			<!-- Only once we have actually resolved something: offering to hand
			     back a file identical to the one just uploaded is noise. -->
			<button
				title="Save your CSV with the geocoded lat/lon filled in — upload that next time and nothing leaves the browser"
				onclick={downloadGeocodedCsv}
			>
				save csv + coords
			</button>
		{/if}
		{#if capability.rounds}
			<button
				disabled={bucketsStore.assignment.size === 0 || saveState === 'saving'}
				title="Save this round on the server so a phone can walk it"
				onclick={saveRound}
			>
				{saveState === 'saving' ? 'saving…' : 'save round'}
			</button>
		{/if}
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
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.82rem;
		padding: 0.25rem 0.6rem;
	}

	.icon {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
	}

	.icon text {
		font-family: var(--font-body);
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
