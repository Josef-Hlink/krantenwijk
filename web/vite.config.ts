import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Dev ports are pinned (strictPort) so they don't drift onto another
// project's port: engine on 4381, this dev server on 4382 (= engine + 1).
// The env overrides exist to run a scratch stack beside the real one.
const API_PORT = Number(process.env.KRANTENWIJK_API_PORT ?? 4381);
const WEB_PORT = Number(process.env.KRANTENWIJK_WEB_PORT ?? 4382);

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: WEB_PORT,
		strictPort: true,
		proxy: {
			// Forward API calls to the engine (`krantenwijk serve`) during dev, so
			// the browser sees a single same-origin app — no CORS, no hardcoded host.
			'/api': {
				target: `http://127.0.0.1:${API_PORT}`,
				changeOrigin: true
			}
		}
	}
});
