<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import { mark } from '$lib/branding/logo';
	import { toggleTheme } from '$lib/theme';

	let { children } = $props();

	// /go is a full-bleed phone surface: the masthead would eat a fifth of the
	// screen and the map has to reach the edges. It carries its own chrome.
	const bare = $derived(page.url.pathname.startsWith('/go'));
</script>

{#if bare}
	{@render children()}
{:else}
	<div class="shell">
		<header>
			<a class="masthead" href="/">
				<span class="mark">{@html mark}</span>
				krantenwijk
			</a>
			<button class="theme" onclick={toggleTheme} title="Toggle theme">☾/☀</button>
		</header>
		<hr class="rule-double" />
		<main>
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.shell {
		height: 100%;
		display: flex;
		flex-direction: column;
		/* viewport-fit=cover lets content under the notch — keep it out */
		padding-left: env(safe-area-inset-left);
		padding-right: env(safe-area-inset-right);
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.9rem;
		padding: 0.55rem 1rem 0.35rem;
	}

	.masthead {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.35rem;
		letter-spacing: -0.02em;
		color: var(--fg);
		text-decoration: none;
	}

	.mark {
		width: 30px;
		display: flex;
	}

	.mark :global(svg) {
		width: 100%;
		height: auto;
	}

	.theme {
		margin-left: auto;
		border: none;
		background: none;
		color: var(--muted);
		padding: 0 0.3rem;
	}

	.rule-double {
		margin: 0 1rem;
	}

	main {
		flex: 1;
		min-height: 0;
	}
</style>
