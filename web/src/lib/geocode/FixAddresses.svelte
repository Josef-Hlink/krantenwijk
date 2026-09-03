<script lang="ts">
	import { recordsStore } from '$lib/records/records.svelte';
	import {
		ADDRESS_FIELDS,
		FIELD_LABELS,
		type AddressField,
		type Draft,
		toDraft,
		matching,
		replaceIn,
		changed,
		applyDraft
	} from './reconcile';

	let { onclose }: { onclose: () => void } = $props();

	// The failed rows as they stand when the dialog opens. Edits live here
	// until "geocode again" hands the changed ones back to the store.
	// svelte-ignore state_referenced_locally
	const originals = new Map(recordsStore.failed.map((r) => [r.id, toDraft(r)]));
	let drafts = $state<Draft[]>([...originals.values()].map((d) => ({ ...d })));

	let field = $state<AddressField>('street');
	let find = $state('');
	let replacement = $state('');

	const hits = $derived(matching(drafts, field, find));
	const dirty = $derived(changed(drafts, originals));

	let dialog: HTMLDialogElement | undefined = $state();
	$effect(() => {
		dialog?.showModal();
	});

	function applyReplace() {
		drafts = replaceIn(drafts, field, find, replacement);
		find = '';
		replacement = '';
	}

	function submit() {
		const byId = new Map(recordsStore.failed.map((r) => [r.id, r]));
		recordsStore.replace(
			dirty.flatMap((d) => {
				const r = byId.get(d.id);
				return r ? [applyDraft(r, d)] : [];
			})
		);
		onclose();
	}
</script>

<dialog bind:this={dialog} onclose={onclose} onclick={(e) => e.target === dialog && onclose()}>
	<div class="body">
		<h2>fix {drafts.length} {drafts.length === 1 ? 'address' : 'addresses'}</h2>
		<p class="hint">
			These are the rows the map could not find — usually a spelling it does not know.
			What you type here is only used to look the door up: your file keeps its own
			address in the export and on the card. Only the rows you change are looked up again.
		</p>

		<form class="replace" onsubmit={(e) => (e.preventDefault(), applyReplace())}>
			<label>
				in
				<select bind:value={field}>
					{#each ADDRESS_FIELDS as f (f)}
						<option value={f}>{FIELD_LABELS[f]}</option>
					{/each}
				</select>
			</label>
			<label>
				replace
				<input type="text" bind:value={find} placeholder="Ruijter" />
			</label>
			<label>
				with
				<input type="text" bind:value={replacement} placeholder="Ruyter" />
			</label>
			<button type="submit" disabled={!hits.length}>
				{#if find}
					replace in {hits.length} {hits.length === 1 ? 'row' : 'rows'}
				{:else}
					replace
				{/if}
			</button>
		</form>

		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th>id</th>
						{#each ADDRESS_FIELDS as f (f)}
							<th>{FIELD_LABELS[f]}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each drafts as d, i (d.id)}
						{@const isDirty = dirty.includes(d)}
						<tr class:dirty={isDirty}>
							<td class="mono id">{d.id}</td>
							{#each ADDRESS_FIELDS as f (f)}
								{@const hit = find && d[f].includes(find) && f === field}
								<td>
									<input
										type="text"
										class="mono"
										class:hit
										value={d[f]}
										oninput={(e) => (drafts[i] = { ...d, [f]: e.currentTarget.value })}
									/>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="actions">
			<button onclick={onclose}>cancel</button>
			<button class="primary" disabled={!dirty.length} onclick={submit}>
				geocode {dirty.length} changed {dirty.length === 1 ? 'address' : 'addresses'} again
			</button>
		</div>
	</div>
</dialog>

<style>
	dialog {
		background: var(--bg);
		color: var(--fg);
		border: 1px solid var(--fg);
		border-radius: 6px;
		padding: 0;
		width: min(56rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
	}

	dialog::backdrop {
		background: rgba(0, 0, 0, 0.35);
	}

	.body {
		padding: 1rem 1.2rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: calc(100vh - 2rem);
	}

	h2 {
		font-size: 1.1rem;
		margin: 0;
	}

	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.replace {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
		padding: 0.5rem 0.7rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel);
		font-size: 0.85rem;
	}

	.replace label {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--muted);
	}

	.replace input {
		width: 10rem;
	}

	.scroll {
		overflow: auto;
		min-height: 0;
		border-top: 1px solid var(--fg);
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th {
		position: sticky;
		top: 0;
		background: var(--bg);
		text-align: left;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		font-weight: 600;
		padding: 0.35rem 0.4rem 0.3rem 0;
		border-bottom: 1px solid var(--border);
	}

	td {
		padding: 0.2rem 0.4rem 0.2rem 0;
		border-bottom: 1px solid var(--border);
	}

	td.id {
		color: var(--muted);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	td input {
		width: 100%;
		box-sizing: border-box;
		font-size: 0.8rem;
		padding: 0.15rem 0.35rem;
	}

	td input.hit {
		border-color: var(--warn);
	}

	tr.dirty td.id {
		color: var(--accent);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding-top: 0.2rem;
	}
</style>
