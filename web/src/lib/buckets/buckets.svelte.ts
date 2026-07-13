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

	counts = $derived.by(() => {
		const c = new Map<string, number>();
		for (const bucketId of this.assignment.values()) {
			c.set(bucketId, (c.get(bucketId) ?? 0) + 1);
		}
		return c;
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

	/** Toggle one point's membership in the active bucket. */
	togglePoint(recordId: string): void {
		if (!this.activeId) return;
		const currently = this.assignment.get(recordId);
		const to = currently === this.activeId ? null : this.activeId;
		this.history.run(this.assignCommand('toggle point', [recordId], to));
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

	/** Auto-seed: server assignments become buckets + one atomic assignment. */
	applySeed(assignments: { id: string; bucket: string }[]): void {
		const labels = [...new Set(assignments.map((a) => a.bucket))];
		const byLabel = new Map<string, Bucket>(
			labels.map((label) => [label, this.freshBucket(label)])
		);
		const commands: Command[] = [...byLabel.values()].map((b) => this.createCommand(b));
		for (const [label, bucket] of byLabel) {
			const ids = assignments.filter((a) => a.bucket === label).map((a) => a.id);
			commands.push(this.assignCommand('assign', ids, bucket.id));
		}
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
