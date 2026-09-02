<script lang="ts">
	import { goto } from '$app/navigation';
	import { parseCsv, type ParsedCsv } from '$lib/csv/parse';
	import ColumnMapper from '$lib/csv/ColumnMapper.svelte';
	import {
		recordsStore,
		type Rec,
		type Detail,
		type Source
	} from '$lib/records/records.svelte';
	import { capability } from '$lib/rounds/capability.svelte';

	// Which deployment profile this is decides what we can honestly promise.
	capability.ensure();

	let parsed = $state<ParsedCsv | null>(null);
	let error = $state<string | null>(null);
	let dragging = $state(false);

	async function handleFile(file: File | string) {
		error = null;
		try {
			parsed = await parseCsv(file);
		} catch (e) {
			parsed = null;
			error = e instanceof Error ? e.message : 'Could not parse that file as CSV.';
		}
	}

	async function loadDemo() {
		const res = await fetch('/sample/vlissingen.csv');
		const text = await res.text();
		await handleFile(text);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) handleFile(file);
	}

	function onPick(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (file) handleFile(file);
	}

	function onReady(records: Rec[], details: Detail[], source: Source) {
		recordsStore.load(records, details, source);
		goto('/plan');
	}
</script>

<div class="landing">
	{#if !parsed}
		<section class="intro">
			<h1>plan a delivery round<br />without handing anyone your addresses</h1>
			<p>
				Drop a CSV of addresses, see them as dots on a map, draw delivery buckets by
				hand, and export a sorted walking order. Parsing, mapping and export all
				happen in your browser, and the routing engine only ever sees anonymous
				coordinates.
			</p>
			{#if capability.rounds}
				<p>
					This instance can also <strong>save a planned round</strong> so a phone can
					walk it. That saved copy is the one thing that does leave your browser: it
					carries the addresses, and the columns you tick "show on map" — a resident's
					name, so the screen matches the card in your hand. Everything you leave
					unticked stays here.
				</p>
			{:else}
				<p>
					Your file is never uploaded, never stored, and gone when you close the tab.
				</p>
			{/if}
			<p class="fine">
				If your CSV has no coordinates, addresses are geocoded one by one via
				OpenStreetMap's public Nominatim — you'll be asked first. Include
				<span class="mono">lat</span>/<span class="mono">lon</span> columns and
				nothing leaves the browser at all.
			</p>
		</section>

		<section
			class="drop {dragging ? 'dragging' : ''}"
			ondragover={(e) => {
				e.preventDefault();
				dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={onDrop}
			aria-label="CSV upload"
		>
			<p><strong>Drop a CSV here</strong></p>
			<label class="pick">
				or choose a file
				<input type="file" accept=".csv,text/csv" onchange={onPick} />
			</label>
			<p class="or">·</p>
			<button class="primary" onclick={loadDemo}>Try the Vlissingen demo</button>
			<p class="fine">
				400 real letterboxes (© OpenStreetMap contributors) with invented residents —
				every name and BSN is randomly generated, the round entirely fictional.
			</p>
		</section>

		{#if capability.rounds}
			<p class="walk">
				Already planned one? <a href="/go">Walk a saved round →</a>
			</p>
		{:else if capability.accounts}
			<!-- Quiet on purpose: the three people who need this know where it
			     is, and everyone else came here for the planner. -->
			<p class="walk">
				<a href="/login">Sign in</a> to save rounds and walk them on a phone.
			</p>
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{/if}
	{:else}
		<button class="back" onclick={() => (parsed = null)}>← different file</button>
		{#key parsed}
			<ColumnMapper {parsed} onready={onReady} />
		{/key}
	{/if}
</div>

<style>
	.landing {
		max-width: 52rem;
		margin: 0 auto;
		padding: 2.5rem 1.5rem;
	}

	.intro h1 {
		font-size: 2rem;
		line-height: 1.15;
		margin-bottom: 0.8rem;
	}

	.intro p {
		max-width: 38rem;
	}

	.walk {
		text-align: center;
		margin-top: 1.2rem;
	}

	.fine {
		color: var(--muted);
		font-size: 0.85rem;
	}

	.drop {
		margin-top: 1.8rem;
		border: 1.5px dashed var(--band);
		border-radius: 8px;
		padding: 2.2rem 1.5rem;
		text-align: center;
		background: var(--panel);
	}

	.drop.dragging {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.drop p {
		margin: 0.3rem 0;
	}

	.or {
		color: var(--muted);
	}

	.pick {
		color: var(--accent);
		cursor: pointer;
		text-decoration: underline;
	}

	.pick input {
		display: none;
	}

	.error {
		color: var(--warn);
		margin-top: 1rem;
	}

	.back {
		margin-bottom: 1.2rem;
	}
</style>
