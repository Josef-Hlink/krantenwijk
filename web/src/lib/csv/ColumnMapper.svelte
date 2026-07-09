<script lang="ts">
	import type { ParsedCsv } from './parse';
	import {
		ROLES,
		ROLE_LABELS,
		type Role,
		guessMapping,
		savedMapping,
		saveMapping,
		validateMapping,
		applyMapping
	} from './mapping.svelte';
	import type { Rec } from '$lib/records/records.svelte';

	let {
		parsed,
		onready
	}: { parsed: ParsedCsv; onready: (records: Rec[]) => void } = $props();

	// The component is keyed on `parsed` by its parent, so reading the prop's
	// initial value here is deliberate.
	// svelte-ignore state_referenced_locally
	let mapping = $state<Partial<Record<Role, string>>>(
		savedMapping(parsed.columns) ?? guessMapping(parsed.columns)
	);

	const problem = $derived(validateMapping(mapping));
	const roleOf = $derived(
		Object.fromEntries(
			Object.entries(mapping).filter(([, col]) => col) as [Role, string][]
		) as Partial<Record<Role, string>>
	);

	function columnRole(col: string): Role | '' {
		for (const role of ROLES) if (roleOf[role as Role] === col) return role as Role;
		return '';
	}

	function setRole(col: string, role: Role | '') {
		const next = { ...mapping };
		// a column holds at most one role; a role points at one column
		for (const r of ROLES) if (next[r] === col) delete next[r];
		if (role) next[role] = col;
		mapping = next;
	}

	function samples(col: string): string {
		return parsed.preview
			.map((row) => row[col])
			.filter((v) => v?.trim())
			.slice(0, 3)
			.join(' · ');
	}

	function continueToMap() {
		saveMapping(parsed.columns, mapping);
		onready(applyMapping(parsed.rows, parsed.columns, mapping));
	}
</script>

<div class="mapper">
	<h2>map your columns</h2>
	<p class="hint">
		Only mapped roles are used; everything else rides along untouched and reappears in
		the export. This mapping is remembered for files with the same columns.
	</p>

	<table>
		<thead>
			<tr><th>column</th><th>sample values</th><th>role</th></tr>
		</thead>
		<tbody>
			{#each parsed.columns as col (col)}
				<tr>
					<td class="mono">{col}</td>
					<td class="samples mono">{samples(col)}</td>
					<td>
						<select
							value={columnRole(col)}
							onchange={(e) => setRole(col, e.currentTarget.value as Role | '')}
						>
							<option value="">passthrough (kept for export)</option>
							{#each ROLES as role (role)}
								<option value={role}>{ROLE_LABELS[role]}</option>
							{/each}
						</select>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if parsed.truncated}
		<p class="warn">File was longer than the row limit; extra rows were dropped.</p>
	{/if}
	{#if problem}
		<p class="warn">{problem.message}</p>
	{/if}

	<button class="primary" disabled={!!problem} onclick={continueToMap}>
		Continue to the map — {parsed.rows.length}
		{parsed.rows.length === 1 ? 'address' : 'addresses'}
	</button>
</div>

<style>
	.mapper {
		max-width: 46rem;
	}

	h2 {
		font-size: 1.15rem;
		margin-bottom: 0.25rem;
	}

	.hint {
		color: var(--muted);
		font-size: 0.85rem;
		margin-top: 0;
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
		max-width: 18rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.warn {
		color: var(--warn);
		font-size: 0.85rem;
	}
</style>
