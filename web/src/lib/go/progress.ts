/**
 * Which stops are delivered, remembered on this phone.
 *
 * Deliberately per-device: each sibling walks their own bucket, so there is
 * nothing to reconcile, and a walk that survives a locked screen or an
 * accidental reload is the whole point.
 *
 * Two things to know about the storage:
 *  - Safari's ITP evicts localStorage after ~7 days without a visit, and
 *    private browsing has none at all. Plan on Monday, walk on Saturday, and
 *    the set can be gone. So we store `updatedAt` alongside and the UI says
 *    when progress was last touched — a lost set must never be silently
 *    indistinguishable from "nothing delivered yet".
 *  - Writes happen on mutation, not through an $effect. A module-level
 *    $effect outside a component throws `effect_orphan` in Svelte 5, and
 *    write-on-mutate is easier to reason about anyway.
 */

const PREFIX = 'krantenwijk.go.v1';

export interface Progress {
	delivered: string[];
	updatedAt: number;
}

const key = (roundId: string, bucketId: string) => `${PREFIX}.${roundId}.${bucketId}`;

export function readProgress(roundId: string, bucketId: string): Progress | null {
	try {
		const raw = localStorage.getItem(key(roundId, bucketId));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed?.delivered)) return null;
		return {
			delivered: parsed.delivered.filter((v: unknown) => typeof v === 'string'),
			updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
		};
	} catch {
		return null;
	}
}

export function writeProgress(
	roundId: string,
	bucketId: string,
	delivered: Iterable<string>
): number {
	const updatedAt = Date.now();
	try {
		localStorage.setItem(
			key(roundId, bucketId),
			JSON.stringify({ delivered: [...delivered], updatedAt })
		);
	} catch {
		// quota or private browsing — the walk still works, it just won't survive
	}
	return updatedAt;
}
