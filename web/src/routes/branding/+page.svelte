<script lang="ts">
	import { plates, inks } from '$lib/branding/logo';
</script>

<svelte:head>
	<title>krantenwijk — huisstijl</title>
</svelte:head>

<div class="sheet">
	<header class="intro">
		<p class="eyebrow mono">huisstijl</p>
		<h1>one bundle of post,<br />one elastic band</h1>
		<p>
			That's the round, and that's the mark: green postcards squared up behind a
			white address panel, a natural-rubber band wrapping the lot. Below, the mark
			in its production treatments — and the six inks everything else on this site
			will be mixed from.
		</p>
	</header>

	<div class="grid">
		{#each plates as p (p.nr)}
			<article class="plate">
				<header class="plate-head">
					<span class="nr mono">{p.nr}</span>
					<h2>{p.title}</h2>
					<span class="meta mono">{p.meta}</span>
				</header>
				<div class="stage">
					<div class="mark">{@html p.svg}</div>
				</div>
				<p class="note">{p.note}</p>
			</article>
		{/each}
	</div>

	<section class="inks">
		<h2>inkt</h2>
		<p class="lede">
			Six inks, all lifted from the bundle itself. The greens are the identity —
			they do the heavy lifting here and across the whole app. The band's
			beige is the warm counterweight; the panel white is the paper everything
			sits on.
		</p>
		<div class="swatches">
			{#each inks as ink (ink.hex)}
				<div class="swatch">
					<span class="well" style="background:{ink.hex}"></span>
					<div class="swatch-label">
						<span class="name">{ink.name}</span>
						<span class="mono hex">{ink.hex}</span>
					</div>
					<p class="role">{ink.role}</p>
				</div>
			{/each}
		</div>
	</section>
</div>

<style>
	.sheet {
		max-width: 72rem;
		margin: 0 auto;
		padding: 2.5rem 1.5rem 4rem;
	}

	.mono {
		font-family: var(--font-mono);
	}

	.intro {
		max-width: 42rem;
		margin-bottom: 2.4rem;
	}

	.eyebrow {
		font-size: 0.75rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
		margin: 0 0 0.6rem;
	}

	.intro h1 {
		font-size: 2rem;
		line-height: 1.12;
		margin-bottom: 0.8rem;
	}

	.intro p:not(.eyebrow) {
		color: var(--muted);
		margin: 0;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.4rem;
	}

	@media (max-width: 720px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}

	.plate {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		background: var(--panel);
		padding: 0.9rem 0.9rem 1rem;
	}

	.plate-head {
		display: flex;
		align-items: baseline;
		gap: 0.55rem;
		margin-bottom: 0.7rem;
	}

	.nr {
		color: var(--accent);
		font-size: 0.8rem;
	}

	.plate-head h2 {
		font-size: 1.05rem;
		font-weight: 640;
	}

	.meta {
		margin-left: auto;
		color: var(--muted);
		font-size: 0.7rem;
		letter-spacing: 0.04em;
	}

	.stage {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--border);
		background:
			radial-gradient(circle at 50% 40%, transparent 60%, rgba(0, 0, 0, 0.025)),
			var(--panel);
		padding: 1.3rem 0;
	}

	.mark {
		width: 170px;
	}

	.mark :global(svg) {
		display: block;
		width: 100%;
		height: auto;
	}

	.note {
		margin: 0.7rem 0 0;
		color: var(--muted);
		font-size: 0.83rem;
		line-height: 1.4;
	}

	.inks {
		margin-top: 3rem;
		border-top: 1px solid var(--border);
		padding-top: 1.4rem;
	}

	.inks h2 {
		font-size: 1.3rem;
		margin-bottom: 0.5rem;
	}

	.lede {
		max-width: 42rem;
		color: var(--muted);
		margin: 0 0 1.4rem;
	}

	.swatches {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1.1rem;
	}

	@media (max-width: 720px) {
		.swatches {
			grid-template-columns: 1fr 1fr;
		}
	}

	.swatch {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		background: var(--panel);
		padding: 0.7rem;
	}

	.well {
		height: 64px;
		border-radius: 4px;
		border: 1px solid var(--border);
	}

	.swatch-label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-top: 0.55rem;
	}

	.name {
		font-family: var(--font-display);
		font-weight: 640;
		font-size: 0.95rem;
	}

	.hex {
		color: var(--muted);
		font-size: 0.72rem;
	}

	.role {
		margin: 0.35rem 0 0;
		color: var(--muted);
		font-size: 0.8rem;
		line-height: 1.4;
	}
</style>
