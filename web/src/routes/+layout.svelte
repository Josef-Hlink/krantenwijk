<script lang="ts">
	import '../app.css';

	let { children } = $props();

	function toggleTheme() {
		const next =
			document.documentElement.dataset.theme === 'avond' ? 'ochtend' : 'avond';
		document.documentElement.dataset.theme = next;
		localStorage.setItem('krantenwijk-theme', next);
	}
</script>

<div class="shell">
	<header>
		<a class="masthead" href="/">krantenwijk</a>
		<span class="tagline">delivery rounds, planned by hand</span>
		<button class="theme" onclick={toggleTheme} title="Toggle theme">☾/☀</button>
	</header>
	<hr class="rule-double" />
	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	header {
		display: flex;
		align-items: baseline;
		gap: 0.9rem;
		padding: 0.55rem 1rem 0.35rem;
	}

	.masthead {
		font-family: var(--font-display);
		font-weight: 700;
		font-size: 1.35rem;
		letter-spacing: -0.02em;
		color: var(--fg);
		text-decoration: none;
	}

	.tagline {
		color: var(--muted);
		font-size: 0.85rem;
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
