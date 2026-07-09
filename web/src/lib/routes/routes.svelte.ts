/**
 * Computed routes per bucket, and the sequential compute loop. Buckets are
 * routed one at a time — the public ORS quota is per-minute and the engine
 * holds the key, so a polite queue with visible progress beats a burst.
 */
import { SvelteMap } from 'svelte/reactivity';
import { route, estimate, ApiError, type RouteResult } from '$lib/api/client';
import { recordsStore } from '$lib/records/records.svelte';
import { bucketsStore } from '$lib/buckets/buckets.svelte';

export interface BucketRoute extends RouteResult {
	/** dirty-counter value at compute time; stale when the bucket changed since */
	version: number;
	totalS: number; // walking + service time
}

export type RouteStatus =
	| { state: 'computing' }
	| { state: 'error'; message: string };

class RoutesStore {
	results = $state(new SvelteMap<string, BucketRoute>());
	status = $state(new SvelteMap<string, RouteStatus>());
	running = $state(false);
	serviceTimeS = $state(45);

	/** Buckets whose route is missing or out of date. */
	stale = $derived(
		bucketsStore.list.filter((b) => {
			const r = this.results.get(b.id);
			return !r || r.version !== (bucketsStore.dirty.get(b.id) ?? 0);
		})
	);

	async computeAll() {
		if (this.running) return;
		this.running = true;
		try {
			for (const bucket of [...this.stale]) {
				await this.computeOne(bucket.id);
			}
		} finally {
			this.running = false;
		}
	}

	async computeOne(bucketId: string) {
		const bucket = bucketsStore.buckets.get(bucketId);
		if (!bucket) return;
		const version = bucketsStore.dirty.get(bucketId) ?? 0;
		const byId = new Map(recordsStore.located.map((r) => [r.id, r]));
		const points = bucketsStore
			.memberIds(bucketId)
			.map((id) => byId.get(id))
			.filter((r) => r != null)
			.map((r) => ({ id: r.id, lat: r.lat!, lon: r.lon! }));

		if (points.length === 0) {
			this.results.delete(bucketId);
			this.status.delete(bucketId);
			return;
		}

		this.status.set(bucketId, { state: 'computing' });
		try {
			const result = await route(points, bucket.startId, bucket.endId);
			const est = await estimate(result.duration_s, points.length, this.serviceTimeS);
			this.results.set(bucketId, { ...result, version, totalS: est.total_s });
			this.status.delete(bucketId);
		} catch (e) {
			const message =
				e instanceof ApiError ? e.message : 'engine unreachable — is it running?';
			this.status.set(bucketId, { state: 'error', message });
		}
	}

	clear() {
		this.results = new SvelteMap();
		this.status = new SvelteMap();
	}
}

export const routesStore = new RoutesStore();
