<script lang="ts">
	/**
	 * The delivery view. Three states on one route: pick a round, pick the
	 * bucket you are walking, then walk it.
	 *
	 * Everything here assumes a phone in one hand, outdoors, possibly at dawn:
	 * big targets, few controls, and no gesture that a mis-tap makes expensive.
	 */
	import { onMount, tick } from 'svelte';
	import { listRounds, getRound, ApiError } from '$lib/api/client';
	import type { Round, RoundSummary } from '$lib/rounds/types';
	import { walkStore, fmtM, fmtMin, type WalkStop } from '$lib/go/walk.svelte';
	import { geo } from '$lib/go/geolocation.svelte';
	import { keepAwake } from '$lib/go/wakelock';
	import { toggleTheme } from '$lib/theme';
	import GoMap from '$lib/go/GoMap.svelte';
	import StopList from '$lib/go/StopList.svelte';
	import NextCard from '$lib/go/NextCard.svelte';

	type Phase = 'rounds' | 'buckets' | 'walk';

	let phase = $state<Phase>('rounds');
	let summaries = $state<RoundSummary[]>([]);
	let round = $state<Round | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	let mode = $state<'map' | 'list'>('map');
	let pinned = $state<WalkStop | null>(null);
	let mapView = $state<GoMap | undefined>();
	let pendingWayFit = $state(false);

	// The card is shown for whichever stop you tapped, else whatever is next.
	const shown = $derived(pinned ?? walkStore.next);

	onMount(() => {
		load();
		const release = keepAwake();
		return () => {
			release();
			geo.stop();
			walkStore.close();
		};
	});

	async function load() {
		loading = true;
		error = null;
		try {
			summaries = await listRounds();
			if (!summaries.length) error = 'No rounds saved yet — plan one on a desktop first.';
		} catch (e) {
			error =
				e instanceof ApiError && e.status === 404
					? 'This instance does not store rounds.'
					: 'Could not reach the engine.';
		} finally {
			loading = false;
		}
	}

	async function pickRound(id: string) {
		loading = true;
		error = null;
		try {
			round = await getRound(id);
			phase = 'buckets';
		} catch {
			error = 'Could not load that round.';
		} finally {
			loading = false;
		}
	}

	function pickBucket(bucketId: string) {
		if (!round) return;
		walkStore.open(round, bucketId);
		pinned = null;
		phase = 'walk';
		geo.start();
	}

	function backToBuckets() {
		walkStore.close();
		geo.stop();
		pinned = null;
		phase = 'buckets';
	}

	async function show(stop: WalkStop) {
		pinned = stop;
		await setMode('map');
		mapView?.goTo(stop);
	}

	/**
	 * Delivering advances the round, so the map should advance with it: frame
	 * the walk to the new next stop straight away. If we are on the list the
	 * map is display:none and cannot be framed, so it waits for the way back.
	 */
	function onDelivered() {
		pinned = null;
		if (mode === 'map') mapView?.showWayToNext();
		else pendingWayFit = true;
	}

	async function resumeRoute() {
		pinned = null;
		await setMode('map');
		mapView?.resume(walkStore.next);
	}

	async function setMode(next: 'map' | 'list') {
		mode = next;
		// The list always tracks the next stop, so a pinned stop has no
		// meaning there — and leaving it set would spring back on return.
		if (next === 'list') pinned = null;
		if (next !== 'map') return;
		// Coming back from the list, the map container was display:none and so
		// still has a stale zero size. Wait for the DOM to show it, then
		// resize — easing a zero-sized map silently does nothing, which looks
		// exactly like "tapping a stop doesn't move the map".
		await tick();
		mapView?.resize();
		if (pendingWayFit) {
			pendingWayFit = false;
			if (!pinned) mapView?.showWayToNext();
		}
	}

	const savedWhen = $derived.by(() => {
		// Only claim saved progress when there is some — an empty set that
		// merely has a timestamp reads as "your work is safe" when it isn't.
		if (!walkStore.updatedAt || walkStore.doneCount === 0) return null;
		const days = Math.floor((Date.now() - walkStore.updatedAt) / 86_400_000);
		if (days < 1) return 'today';
		return days === 1 ? 'yesterday' : `${days} days ago`;
	});
</script>

<svelte:head><title>krantenwijk — lopen</title></svelte:head>

<div class="go">
	{#if phase === 'walk' && walkStore.bucket}
		<header class="bar">
			<button class="back" onclick={backToBuckets} aria-label="Back to buckets">←</button>
			<span class="chip" style:background={walkStore.bucket.color}></span>
			<span class="title">{walkStore.bucket.name}</span>
			<span class="count">{walkStore.doneCount}/{walkStore.total}</span>
			<div class="modes" role="group" aria-label="View">
				<button class:on={mode === 'map'} onclick={() => void setMode('map')}>map</button>
				<button class:on={mode === 'list'} onclick={() => void setMode('list')}>list</button>
			</div>
			<!-- A round that starts at dawn ends in daylight; the flip has to be
			     reachable mid-walk, not only from the picker. -->
			<button class="theme" onclick={toggleTheme} aria-label="Toggle theme">☾/☀</button>
		</header>

		<!-- Looking at one stop is a state you are in, not a page you navigated
		     to, so the way out belongs at the top as a visible band — not as a
		     button tucked into the card. -->
		{#if pinned}
			<button class="ribbon" onclick={resumeRoute}>
				<span class="ribbon-icon" aria-hidden="true">↩</span>
				resume route navigation
			</button>
		{/if}

		<div class="body">
			<!-- Both stay mounted: rebuilding MapLibre on every toggle costs a
			     visible re-init and a fresh round of tile fetches. -->
			<div class="mapwrap" class:hidden={mode !== 'map'}>
				<GoMap bind:this={mapView} onpick={show} />
				{#if geo.state === 'denied' || geo.state === 'unavailable'}
					<p class="geonote">location off — walk it by the numbers</p>
				{/if}
				<div class="overlay">
					<button
						class="round-btn"
						onclick={() => mapView?.recenter()}
						aria-label="Recentre"
						title={geo.state === 'denied' ? 'Location permission denied' : 'Recentre'}
					>
						{geo.state === 'live' ? '◎' : '⌖'}
					</button>
					<button
						class="round-btn"
						onclick={() => mapView?.showWayToNext()}
						disabled={walkStore.complete}
						aria-label="Show the way to the next address"
						title="Fit you and the next address on screen"
					>
						<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
							<!-- you, the gap, and the door: the shape of the question -->
							<circle cx="5" cy="18.5" r="3" fill="currentColor" />
							<path
								d="M7.6 15.4 Q12 11 11.5 7.4"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-dasharray="2.4 2.4"
							/>
							<circle
								cx="17"
								cy="6"
								r="3.4"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							/>
						</svg>
					</button>
					<button class="round-btn" onclick={() => mapView?.frameRoute()} aria-label="Whole route">
						⤢
					</button>
				</div>
			</div>
			<div class="listwrap" class:hidden={mode !== 'list'}>
				<p class="summary">
					{fmtM(walkStore.remainingM)} left · about {fmtMin(walkStore.remainingS)}
					{#if savedWhen}<br /><em>progress saved on this phone, {savedWhen}</em>{/if}
				</p>
				<StopList onpick={show} ondelivered={onDelivered} />
			</div>
		</div>

		{#if mode === 'map' && shown}
			<NextCard stop={shown} ondelivered={onDelivered} />
		{:else if mode === 'map' && walkStore.complete}
			<div class="finished">
				<p>Bucket walked — all {walkStore.total} delivered.</p>
				<button onclick={backToBuckets}>pick another bucket</button>
			</div>
		{/if}
	{:else}
		<header class="bar">
			{#if phase === 'buckets'}
				<button class="back" onclick={() => (phase = 'rounds')} aria-label="Back">←</button>
			{:else}
				<a class="back" href="/" aria-label="Home">←</a>
			{/if}
			<span class="title">
				{phase === 'rounds' ? 'pick a round' : (round?.name ?? '')}
			</span>
			<button class="theme" onclick={toggleTheme} aria-label="Toggle theme">☾/☀</button>
		</header>

		<!-- Looking at one stop is a state you are in, not a page you navigated
		     to, so the way out belongs at the top as a visible band — not as a
		     button tucked into the card. -->
		{#if pinned}
			<button class="ribbon" onclick={resumeRoute}>
				<span class="ribbon-icon" aria-hidden="true">↩</span>
				resume route navigation
			</button>
		{/if}

		<div class="body pad">
			{#if loading}
				<p class="note">loading…</p>
			{:else if error}
				<p class="note">{error}</p>
				<button onclick={load}>try again</button>
			{:else if phase === 'rounds'}
				<ul class="picks">
					{#each summaries as s (s.id)}
						<li>
							<button onclick={() => pickRound(s.id)}>
								<span class="pick-name">{s.name}</span>
								<span class="pick-meta">
									{s.n_buckets} buckets · {s.n_stops} stops · {s.saved_at.slice(0, 10)}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if round}
				<ul class="picks">
					{#each round.buckets as b (b.id)}
						<li>
							<button onclick={() => pickBucket(b.id)} disabled={b.order.length === 0}>
								<span class="pick-name">
									<span class="chip" style:background={b.color}></span>
									{b.name}
								</span>
								<span class="pick-meta">
									{b.order.length} stops{b.carrier ? ` · ${b.carrier}` : ''}{b.distance_m
										? ` · ${fmtM(b.distance_m)}`
										: ' · not routed'}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.go {
		height: 100vh; /* fallback */
		height: 100dvh; /* iOS: 100vh is the *large* viewport, so the card hides */
		display: flex;
		flex-direction: column;
		overflow: hidden;
		overscroll-behavior: none;
		-webkit-tap-highlight-color: transparent;
		user-select: none;
		font-size: 17px; /* arm's length, in sunlight */
		background: var(--bg);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		padding-top: calc(0.4rem + env(safe-area-inset-top));
		padding-left: calc(0.6rem + env(safe-area-inset-left));
		padding-right: calc(0.6rem + env(safe-area-inset-right));
		border-bottom: 1px solid var(--border);
		background: var(--panel);
		flex-shrink: 0;
	}

	.back,
	.theme {
		border: none;
		background: none;
		color: var(--muted);
		font-size: 1.3rem;
		padding: 0.2rem 0.5rem;
		min-height: 2.6rem;
		text-decoration: none;
		display: flex;
		align-items: center;
	}

	.title {
		font-family: var(--font-display);
		font-weight: 640;
		font-size: 1.05rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
		min-width: 0;
	}

	.count {
		font-family: var(--font-mono);
		font-size: 0.9rem;
		color: var(--muted);
		flex-shrink: 0;
	}

	/* Everything else in the walk bar is fixed-width, so the bucket name is
	   what gives when the header runs out of room. */
	.bar .theme {
		font-size: 1rem;
		padding: 0.2rem 0.25rem;
		flex-shrink: 0;
	}

	.chip {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex-shrink: 0;
		display: inline-block;
	}

	.modes {
		display: flex;
		flex-shrink: 0;
	}

	.modes button {
		font-size: 0.85rem;
		padding: 0.35rem 0.6rem;
		border-radius: 0;
		min-height: 2.4rem;
	}

	.modes button:first-child {
		border-radius: 6px 0 0 6px;
	}

	.modes button:last-child {
		border-radius: 0 6px 6px 0;
		border-left: none;
	}

	.modes button.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-ink);
		font-weight: 600;
	}

	.ribbon {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		width: 100%;
		border: none;
		border-bottom: 1px solid var(--border);
		border-radius: 0;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.9rem;
		font-weight: 600;
		min-height: 2.6rem;
		padding: 0.3rem 0.8rem;
		padding-left: calc(0.8rem + env(safe-area-inset-left));
		padding-right: calc(0.8rem + env(safe-area-inset-right));
		flex-shrink: 0;
	}

	.ribbon-icon {
		font-size: 1.05rem;
		line-height: 1;
	}

	.body {
		flex: 1;
		min-height: 0;
	}

	.body.pad {
		overflow-y: auto;
		padding: 0.8rem;
		padding-left: calc(0.8rem + env(safe-area-inset-left));
		padding-right: calc(0.8rem + env(safe-area-inset-right));
		padding-bottom: calc(0.8rem + env(safe-area-inset-bottom));
	}

	.mapwrap {
		position: relative;
		height: 100%;
	}

	.hidden {
		display: none;
	}

	.listwrap {
		height: 100%;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
		padding-bottom: env(safe-area-inset-bottom);
	}

	.summary {
		margin: 0;
		padding: 0.6rem 1rem;
		font-size: 0.85rem;
		color: var(--muted);
		border-bottom: 1px solid var(--border);
	}

	.summary em {
		font-style: normal;
		opacity: 0.8;
	}

	.overlay {
		position: absolute;
		right: 0.7rem;
		/* clear of MapLibre's attribution strip along the bottom */
		bottom: 2.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.round-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3rem;
		height: 3rem;
		padding: 0;
		border-radius: 50%;
		background: var(--panel);
		color: var(--fg);
		font-size: 1.3rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.geonote {
		position: absolute;
		left: 0.7rem;
		top: 0.7rem;
		margin: 0;
		font-size: 0.75rem;
		color: var(--muted);
		background: var(--panel);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
	}

	.picks {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.picks button {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		padding: 0.85rem 0.9rem;
		border-radius: 8px;
		text-align: left;
		min-height: 3.6rem;
	}

	.pick-name {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-family: var(--font-display);
		font-weight: 640;
		font-size: 1.1rem;
	}

	.pick-meta {
		font-size: 0.85rem;
		color: var(--muted);
	}

	.note {
		color: var(--muted);
	}

	.finished {
		background: var(--panel);
		border-top: 1px solid var(--fg);
		padding: 0.9rem 1rem calc(0.9rem + env(safe-area-inset-bottom));
		text-align: center;
	}

	.finished p {
		margin: 0 0 0.6rem;
	}

	button {
		touch-action: manipulation;
	}
</style>
