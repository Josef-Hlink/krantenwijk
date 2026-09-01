<script lang="ts">
	/**
	 * Signing in. Seen in two places: at a desk before saving a plan, and on a
	 * phone at dawn with a stack of cards in one hand — so it is sized for the
	 * second. Big targets, 17px, and the autocomplete hints that let a password
	 * manager fill it with a fingerprint instead of cold thumbs.
	 *
	 * There is no way to make an account from here, because there is no such
	 * endpoint. Three accounts, made by hand on the box.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { login, ApiError } from '$lib/api/client';
	import { capability } from '$lib/rounds/capability.svelte';

	// Asked fresh, not from cache. This is the one page whose answer must be
	// current: a tab opened before the instance had a database would otherwise
	// keep telling you there is nothing here to sign in to, long after there is.
	capability.refresh();

	let username = $state('');
	let password = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	// Where to land afterwards. Same-site paths only: an open redirect is a
	// phishing gift, and the only callers are our own /go and /plan.
	const next = $derived.by(() => {
		const asked = page.url.searchParams.get('next') ?? '/';
		return asked.startsWith('/') && !asked.startsWith('//') ? asked : '/';
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		error = null;
		try {
			await login(username, password);
			await capability.refresh();
			await goto(next, { replaceState: true });
		} catch (e) {
			error =
				e instanceof ApiError && e.status === 401
					? 'That username and password do not match.'
					: e instanceof ApiError && e.status === 404
						? 'This instance has no accounts — nothing is stored here.'
						: 'Could not reach the engine.';
			password = '';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>krantenwijk — inloggen</title></svelte:head>

<div class="wrap">
	<form onsubmit={submit}>
		<h1>Sign in</h1>
		<p class="lede">
			Planning a round needs no account — that all happens in your browser. Signing in
			adds one thing: krantenwijk can keep a planned round, so you can pull it up on a
			phone and walk it door by door.
		</p>

		<label>
			<span>username</span>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={username}
				autocomplete="username"
				autocapitalize="none"
				autocorrect="off"
				spellcheck="false"
				autofocus
				required
			/>
		</label>

		<label>
			<span>password</span>
			<input
				type="password"
				bind:value={password}
				autocomplete="current-password"
				enterkeyhint="go"
				required
			/>
		</label>

		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}

		<button class="primary" type="submit" disabled={busy || !username || !password}>
			{busy ? 'signing in…' : 'sign in'}
		</button>

		{#if capability.checked && !capability.accounts}
			<p class="fine">
				This instance stores nothing at all, so there is nothing here to sign in to.
			</p>
		{/if}
	</form>
</div>

<style>
	.wrap {
		display: flex;
		justify-content: center;
		padding: 2rem 1.2rem calc(2rem + env(safe-area-inset-bottom));
	}

	form {
		width: 100%;
		max-width: 26rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		/* Arm's length, in sunlight — the same footing as /go. */
		font-size: 17px;
	}

	h1 {
		font-size: 1.6rem;
		margin: 0;
	}

	.lede {
		color: var(--muted);
		margin: 0;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	label span {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		color: var(--muted);
	}

	input {
		font: inherit;
		padding: 0.7rem 0.75rem;
		min-height: 3rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel);
		color: var(--fg);
	}

	input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}

	button.primary {
		min-height: 3.2rem;
		font-size: 1rem;
		font-weight: 600;
		background: var(--accent);
		border: 1px solid var(--accent);
		color: var(--accent-ink);
		border-radius: 8px;
	}

	button.primary:disabled {
		opacity: 0.55;
	}

	.error {
		color: var(--warn);
		margin: 0;
	}

	.fine {
		color: var(--muted);
		font-size: 0.85rem;
		margin: 0;
	}
</style>
