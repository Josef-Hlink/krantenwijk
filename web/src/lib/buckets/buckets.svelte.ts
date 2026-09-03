/**
 * Bucket state: bucket definitions, per-point membership, the active bucket,
 * and undoable operations over all of it.
 *
 * Membership lives per point (recordId → bucketId); drawn shapes are
 * transient selection gestures, deleted the moment they've selected. A point
 * belongs to at most one bucket — the most recent assignment wins, and every
 * gesture is one atomic undo step.
 */
import { SvelteMap } from 'svelte/reactivity';
import { recordsStore } from '$lib/records/records.svelte';
import { bucketColor } from './palette';
import { History, CompositeCommand, type Command } from './history';

export interface Bucket {
	id: string;
	name: string;
	color: string;
	carrier?: string;
	startId?: string;
	endId?: string;
}

export const DEFAULT_MAX_STOPS = 50;

class BucketsStore {
	buckets = $state(new SvelteMap<string, Bucket>());
	/** recordId → bucketId; absence = unassigned. */
	assignment = $state(new SvelteMap<string, string>());
	activeId = $state<string | null>(null);
	maxStops = $state(DEFAULT_MAX_STOPS);

	history = new History();

	/** Bump when routes must be invalidated for a bucket (membership change). */
	dirty = $state(new SvelteMap<string, number>());

	private nextNumber = 1;
	private colorCursor = 0;

	list = $derived([...this.buckets.values()]);

	/** Cards per bucket — what you carry. */
	counts = $derived.by(() => {
		const c = new Map<string, number>();
		for (const bucketId of this.assignment.values()) {
			c.set(bucketId, (c.get(bucketId) ?? 0) + 1);
		}
		return c;
	});

	/**
	 * Doors per bucket — what you walk, and what capacity is really about:
	 * `maxStops` exists because ORS optimization tops out around 50 waypoints,
	 * and a waypoint is a place, not a card.
	 */
	doorCounts = $derived.by(() => {
		const seen = new Map<string, Set<string>>();
		for (const [recordId, bucketId] of this.assignment) {
			const key = recordsStore.stopOf.get(recordId);
			if (!key) continue;
			let set = seen.get(bucketId);
			if (!set) seen.set(bucketId, (set = new Set()));
			set.add(key);
		}
		return new Map([...seen].map(([bucketId, keys]) => [bucketId, keys.size]));
	});

	active = $derived(this.activeId ? (this.buckets.get(this.activeId) ?? null) : null);

	carriers = $derived([
		...new Set(this.list.map((b) => b.carrier).filter((c): c is string => !!c))
	]);

	memberIds(bucketId: string): string[] {
		return [...this.assignment.entries()]
			.filter(([, b]) => b === bucketId)
			.map(([recordId]) => recordId);
	}

	private touch(bucketId: string | undefined | null) {
		if (bucketId) this.dirty.set(bucketId, (this.dirty.get(bucketId) ?? 0) + 1);
	}

	// ── command builders ────────────────────────────────────────────────

	private assignCommand(label: string, recordIds: string[], to: string | null): Command {
		const changes = recordIds
			.map((recordId) => ({
				recordId,
				from: this.assignment.get(recordId) ?? null,
				to
			}))
			.filter((ch) => ch.from !== ch.to);
		const store = this;
		return {
			label,
			apply() {
				for (const ch of changes) {
					if (ch.to === null) store.assignment.delete(ch.recordId);
					else store.assignment.set(ch.recordId, ch.to);
					// start/end markers don't survive leaving the bucket
					if (ch.from) store.clearMarkersIfGone(ch.from, ch.recordId);
					store.touch(ch.from);
					store.touch(ch.to);
				}
			},
			revert() {
				for (const ch of changes) {
					if (ch.from === null) store.assignment.delete(ch.recordId);
					else store.assignment.set(ch.recordId, ch.from);
					if (ch.to) store.clearMarkersIfGone(ch.to, ch.recordId);
					store.touch(ch.from);
					store.touch(ch.to);
				}
			}
		};
	}

	private clearMarkersIfGone(bucketId: string, recordId: string) {
		const b = this.buckets.get(bucketId);
		if (!b) return;
		if (this.assignment.get(recordId) === bucketId) return;
		if (b.startId === recordId) this.buckets.set(bucketId, { ...b, startId: undefined });
		const b2 = this.buckets.get(bucketId)!;
		if (b2.endId === recordId) this.buckets.set(bucketId, { ...b2, endId: undefined });
	}

	private createCommand(bucket: Bucket): Command {
		const store = this;
		return {
			label: `create ${bucket.name}`,
			apply() {
				store.buckets.set(bucket.id, bucket);
				store.activeId = bucket.id;
			},
			revert() {
				store.buckets.delete(bucket.id);
				if (store.activeId === bucket.id) store.activeId = null;
			}
		};
	}

	private deleteCommand(bucketId: string): Command {
		const store = this;
		let snapshot: Bucket | undefined;
		return {
			label: 'delete bucket',
			apply() {
				snapshot = store.buckets.get(bucketId);
				store.buckets.delete(bucketId);
				if (store.activeId === bucketId) store.activeId = null;
			},
			revert() {
				if (snapshot) store.buckets.set(bucketId, snapshot);
			}
		};
	}

	private updateCommand(label: string, bucketId: string, patch: Partial<Bucket>): Command {
		const store = this;
		let before: Bucket | undefined;
		return {
			label,
			apply() {
				const b = store.buckets.get(bucketId);
				if (!b) return;
				before = b;
				store.buckets.set(bucketId, { ...b, ...patch });
				if ('startId' in patch || 'endId' in patch) store.touch(bucketId);
			},
			revert() {
				if (before) store.buckets.set(bucketId, before);
				if ('startId' in patch || 'endId' in patch) store.touch(bucketId);
			}
		};
	}

	/** Flip a door in or out of the round; the caller passes every card at it. */
	private skipCommand(label: string, recordIds: string[], out: boolean): Command {
		const ids = recordIds.filter((id) => recordsStore.skipped.has(id) !== out);
		const set = (skipped: boolean) => {
			for (const id of ids) {
				if (skipped) recordsStore.skipped.add(id);
				else recordsStore.skipped.delete(id);
			}
		};
		return {
			label,
			apply: () => set(out),
			revert: () => set(!out)
		};
	}

	private freshBucket(name?: string): Bucket {
		return {
			id: crypto.randomUUID(),
			name: name ?? `bucket ${this.nextNumber++}`,
			color: bucketColor(this.colorCursor++)
		};
	}

	// ── public operations (each = one undo step) ────────────────────────

	/** Assign a selection to the active bucket (stealing where needed). */
	assignToActive(recordIds: string[]): void {
		if (!this.activeId) return;
		this.history.run(
			this.assignCommand(`assign ${recordIds.length} points`, recordIds, this.activeId)
		);
	}

	/**
	 * Toggle a whole doorstep's membership in the active bucket. Every card
	 * at the door moves together — the first one decides the direction, so a
	 * partially-assigned household resolves to "all in".
	 */
	toggleDoor(recordIds: string[]): void {
		if (!this.activeId || recordIds.length === 0) return;
		const allIn = recordIds.every((id) => this.assignment.get(id) === this.activeId);
		const to = allIn ? null : this.activeId;
		this.history.run(this.assignCommand('toggle door', recordIds, to));
	}

	createEmpty(): void {
		this.history.run(this.createCommand(this.freshBucket()));
	}

	remove(bucketId: string): void {
		const members = this.memberIds(bucketId);
		this.history.run(
			new CompositeCommand('delete bucket', [
				this.assignCommand('unassign', members, null),
				this.deleteCommand(bucketId)
			])
		);
	}

	rename(bucketId: string, name: string): void {
		this.history.run(this.updateCommand('rename bucket', bucketId, { name }));
	}

	setCarrier(bucketId: string, carrier: string | undefined): void {
		this.history.run(this.updateCommand('set carrier', bucketId, { carrier }));
	}

	setStart(bucketId: string, recordId: string | undefined): void {
		this.history.run(this.markerCommand('set start', bucketId, { startId: recordId }, recordId));
	}

	setEnd(bucketId: string, recordId: string | undefined): void {
		this.history.run(this.markerCommand('set end', bucketId, { endId: recordId }, recordId));
	}

	/** A start/end marker only makes sense on a member — setting one on an
	 * outside record pulls it into the bucket first, as one undo step. */
	private markerCommand(
		label: string,
		bucketId: string,
		patch: Partial<Bucket>,
		recordId: string | undefined
	): Command {
		const update = this.updateCommand(label, bucketId, patch);
		if (recordId != null && this.assignment.get(recordId) !== bucketId) {
			return new CompositeCommand(label, [
				this.assignCommand(label, [recordId], bucketId),
				update
			]);
		}
		return update;
	}

	/**
	 * Take a door out of the round: it leaves its bucket and stops counting,
	 * but stays on the map greyed out. One undo step brings it all back.
	 */
	skip(recordIds: string[]): void {
		if (!recordIds.length) return;
		this.history.run(
			new CompositeCommand('skip door', [
				this.assignCommand('unassign', recordIds, null),
				this.skipCommand('skip', recordIds, true)
			])
		);
	}

	/** Bring a door back into the round, unassigned. */
	unskip(recordIds: string[]): void {
		if (!recordIds.length) return;
		this.history.run(this.skipCommand('unskip door', recordIds, false));
	}

	/** Merge several buckets into the first: one undo step. */
	merge(bucketIds: string[]): void {
		if (bucketIds.length < 2) return;
		const [winner, ...losers] = bucketIds;
		const commands: Command[] = [];
		for (const loser of losers) {
			commands.push(this.assignCommand('move points', this.memberIds(loser), winner));
			commands.push(this.deleteCommand(loser));
		}
		this.history.run(new CompositeCommand(`merge ${bucketIds.length} buckets`, commands));
	}

	/**
	 * Auto-seed: server assignments become buckets + one atomic assignment.
	 * Seeding steals every seeded point, so any bucket it empties — an
	 * earlier seed's, typically — goes with it, or a second run leaves a
	 * rail full of zeros above the real buckets. One undo step, all of it.
	 */
	applySeed(assignments: { id: string; bucket: string }[]): void {
		const labels = [...new Set(assignments.map((a) => a.bucket))];
		const byLabel = new Map<string, Bucket>(
			labels.map((label) => [label, this.freshBucket(label)])
		);
		const seeded = new Set(assignments.map((a) => a.id));
		const emptied = this.list.filter((b) =>
			this.memberIds(b.id).every((id) => seeded.has(id))
		);
		const commands: Command[] = [...byLabel.values()].map((b) => this.createCommand(b));
		for (const [label, bucket] of byLabel) {
			const ids = assignments.filter((a) => a.bucket === label).map((a) => a.id);
			commands.push(this.assignCommand('assign', ids, bucket.id));
		}
		// Reverse, so an undo (which reverts in reverse) puts them back in
		// the order the rail had them.
		for (const b of [...emptied].reverse()) commands.push(this.deleteCommand(b.id));
		this.history.run(
			new CompositeCommand(`auto-seed ${labels.length} buckets`, commands)
		);
	}

	undo() {
		return this.history.undo();
	}

	redo() {
		return this.history.redo();
	}

	clear() {
		this.buckets = new SvelteMap();
		this.assignment = new SvelteMap();
		this.activeId = null;
		this.dirty = new SvelteMap();
		this.history.clear();
		this.nextNumber = 1;
		this.colorCursor = 0;
	}
}

export const bucketsStore = new BucketsStore();
