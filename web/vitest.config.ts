/**
 * Unit tests for the pure logic — the functions that decide which cards go
 * to which door, in what order, and how they read on screen.
 *
 * Deliberately no DOM and no component rendering: the map and the walking
 * screens are checked by driving a real browser, and a jsdom imitation of
 * MapLibre would test the imitation. What is worth pinning down here is the
 * arithmetic and the grouping, which is exactly the part that breaks quietly
 * under a later refactor.
 */
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// .svelte.ts modules use runes, so they need the Svelte compiler
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: {
		alias: { $lib: new URL('./src/lib', import.meta.url).pathname }
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
