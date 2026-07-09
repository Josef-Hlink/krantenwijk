import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Browser-first SPA: static assets that talk to the local engine at
		// runtime. No Node server in production — any static host (or the
		// engine itself) can serve the build; the browser calls /api.
		adapter: adapter({ fallback: 'index.html' })
	}
};

export default config;
