<script lang="ts">
	import type { ParsedCsv } from './parse';
	import {
		ROLES,
		ROLE_LABELS,
		type Role,
		guessMapping,
		defaultDetail,
		savedMapping,
		saveMapping,
		mappingStatus,
		identity,
		uniqueCounts,
		applyMapping,
		skippedIds
	} from './mapping.svelte';
	import type { Rec, Detail, Source } from '$lib/records/records.svelte';

	let {
		parsed,
		onready
	}: {
		parsed: ParsedCsv;
		onready: (records: Rec[], details: Detail[], source: Source, skipped: string[]) => void;
	} = $props();

	// The component is keyed on `parsed` by its parent, so reading the prop's
	// initial value here is deliberate.
	// svelte-ignore state_referenced_locally
	const saved = savedMapping(parsed.columns);
	// svelte-ignore state_referenced_locally
	const initial = saved ?? guessMapping(parsed.columns);
	let roles = $state<Partial<Record<Role, string>>>(initial.roles);
	let idColumns = $state<string[]>(initial.idColumns);
	// Per-column detail preferences, kept for every column so flipping a
	// column between role and detail doesn't lose its name/show settings.
	// svelte-ignore state_referenced_locally
	let detailPrefs = $state<Record<string, { label: string; show: boolean }>>(
		Object.fromEntries(
			parsed.columns.map((c) => {
				const savedDetail = saved?.details.find((d) => d.column === c);
				const { label, show } = savedDetail ?? defaultDetail(c);
				return [c, { label, show }];
			})
		)
	);

	// svelte-ignore state_referenced_locally
	const unique = uniqueCounts(parsed.rows, parsed.columns);
	const status = $derived(mappingStatus(roles));
	const ident = $derived(identity(parsed.rows, idColumns));
	const roleCols = $derived(
		new Set([...idColumns, ...(Object.values(roles).filter(Boolean) as string[])])
	);
	const details = $derived<Detail[]>(
		parsed.columns.filter((c) => !roleCols.has(c)).map((c) => ({ column: c, ...detailPrefs[c] }))
	);

	type Use = Role | 'id' | '';

	function columnRole(col: string): Use {
		if (idColumns.includes(col)) return 'id';
		for (const role of ROLES) if (roles[role] === col) return role;
		return '';
	}

	function setRole(col: string, use: Use) {
		const next = { ...roles };
		// a column holds at most one role; a role points at one column — except
		// the id, which any number of columns can make up together
		for (const r of ROLES) if (next[r] === col) delete next[r];
		let ids = idColumns.filter((c) => c !== col);
		if (use === 'id') {
			ids = parsed.columns.filter((c) => c === col || ids.includes(c));
		} else if (use) {
			next[use] = col;
		}
		roles = next;
		idColumns = ids;
	}

	function samples(col: string): string {
		return parsed.preview
			.map((row) => row[col])
			.filter((v) => v?.trim())
			.slice(0, 3)
			.join(' · ');
	}

	function continueToMap() {
		saveMapping(parsed.columns, { roles, idColumns, details });
		// The source shape rides along so the file can later be handed back with
		// coordinates filled in, under its own column names.
		const records = applyMapping(parsed.rows, parsed.columns, { roles, idColumns });
		onready(
			records,
			details,
			{ columns: parsed.columns, roles, idColumns },
			skippedIds(parsed.rows, records, roles)
		);
	}
</script>

<div class="mapper">
	<h2>map your columns</h2>
	<p class="hint">
		One thing is needed: a <strong>location</strong>. An <strong>id</strong> keeps your own
		key in the export — pick several columns if it takes more than one to tell rows apart.
		Every other column is an extra detail — tick it to show it when you point at a dot on
		the map, and rename it if the header is cryptic. All columns come back in the export,
		and this mapping is remembered for files with the same columns.
	</p>

	<table>
		<thead>
			<tr>
				<th>column</th>
				<th>sample values</th>
				<th class="num" title="distinct values in this column">unique</th>
				<th>used as</th>
				<th>on the map</th>
			</tr>
		</thead>
		<tbody>
			{#each parsed.columns as col (col)}
				{@const role = columnRole(col)}
				<tr>
					<td class="mono">{col}</td>
					<td class="samples mono">{samples(col)}</td>
					<td class="num mono" class:covers={unique[col] === parsed.rows.length}>
						{unique[col]}
					</td>
					<td>
						<select
							value={role}
							onchange={(e) => setRole(col, e.currentTarget.value as Use)}
						>
							<option value="">extra detail</option>
							<option value="id">id</option>
							{#each ROLES as r (r)}
								<option value={r}>{ROLE_LABELS[r]}</option>
							{/each}
						</select>
					</td>
					<td class="onmap">
						{#if !role}
							<label class="show">
								<input
									type="checkbox"
									checked={detailPrefs[col].show}
									onchange={(e) => (detailPrefs[col].show = e.currentTarget.checked)}
								/>
								show
							</label>
							{#if detailPrefs[col].show}
								<input
									class="label-input"
									type="text"
									value={detailPrefs[col].label}
									oninput={(e) => (detailPrefs[col].label = e.currentTarget.value)}
									title="Name shown in the map popup"
								/>
							{/if}
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<ul class="checklist">
		{#if !idColumns.length}
			<li class="todo">
				<span class="tick mono">—</span>
				no id — every row gets a generated one; pick a column to keep your own key in the
				export
			</li>
		{:else if ident.duplicates}
			<li class="warn">
				<span class="tick mono">!</span>
				<span>
					id — {idColumns.join(' + ')}: <strong>{ident.unique} unique ids for {ident.rows} rows</strong>.
					Add a column that tells the other {ident.duplicates} apart; otherwise they are
					numbered #2, #3… in the export.
				</span>
			</li>
		{:else}
			<li class="ok">
				<span class="tick mono">✓</span>
				id — {idColumns.join(' + ')}: {ident.unique} unique ids for {ident.rows} rows{#if ident.blank}
					({ident.blank} without one get a generated id){/if}
			</li>
		{/if}
		<li class={status.location === 'coords' || status.location === 'address' ? 'ok' : 'todo'}>
			<span class="tick mono"
				>{status.location === 'coords' || status.location === 'address' ? '✓' : '—'}</span
			>
			{#if status.location === 'coords'}
				location — using coordinates, nothing leaves the browser
			{:else if status.location === 'address'}
				location — street + house number, geocoded via OpenStreetMap (you'll be asked first)
			{:else if status.location === 'partial'}
				location — incomplete: map street + house number, or latitude + longitude
			{:else}
				location — map street + house number, or latitude + longitude
			{/if}
		</li>
	</ul>

	{#if parsed.truncated}
		<p class="warn">File was longer than the row limit; extra rows were dropped.</p>
	{/if}

	<button class="primary" disabled={!status.ok} onclick={continueToMap}>
		Continue to the map — {parsed.rows.length}
		{parsed.rows.length === 1 ? 'address' : 'addresses'}
	</button>
</div>

<style>
	.mapper {
		max-width: 52rem;
	}

	h2 {
		font-size: 1.15rem;
		margin-bottom: 0.25rem;
	}

	.hint {
		color: var(--muted);
		font-size: 0.85rem;
		margin-top: 0;
		max-width: 40rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		margin: 0.8rem 0;
	}

	th {
		text-align: left;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		font-weight: 600;
		padding: 0.3rem 0.6rem 0.3rem 0;
		border-bottom: 1px solid var(--fg);
	}

	td {
		padding: 0.35rem 0.6rem 0.35rem 0;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}

	.samples {
		color: var(--muted);
		font-size: 0.78rem;
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.onmap {
		white-space: nowrap;
	}

	.num {
		text-align: right;
		padding-right: 1.2rem;
		color: var(--muted);
		font-size: 0.78rem;
	}

	/* every row has its own value — this column alone could be the id */
	td.covers {
		color: var(--accent);
	}

	.show {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.82rem;
		color: var(--muted);
		cursor: pointer;
	}

	.show input {
		accent-color: var(--accent);
	}

	.label-input {
		width: 8rem;
		margin-left: 0.5rem;
		font-size: 0.82rem;
		padding: 0.15rem 0.4rem;
	}

	.checklist {
		list-style: none;
		margin: 0.4rem 0 1rem;
		padding: 0;
		font-size: 0.85rem;
	}

	.checklist li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.15rem 0;
	}

	.checklist .tick {
		width: 1rem;
		text-align: center;
	}

	.checklist .ok .tick,
	.checklist li.ok .tick {
		color: var(--accent);
	}

	.checklist li.ok {
		color: var(--fg);
	}

	.checklist li.todo {
		color: var(--muted);
	}

	.checklist li.todo .tick {
		color: var(--warn);
	}

	.checklist li.warn,
	.checklist li.warn .tick {
		color: var(--warn);
	}

	.warn {
		color: var(--warn);
		font-size: 0.85rem;
	}
</style>
