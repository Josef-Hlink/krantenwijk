/**
 * Whether this instance stores rounds, asked once and remembered.
 *
 * Two deployment profiles run the same build. The public one has no rounds
 * directory configured, so /api/rounds 404s and nothing is ever written — the
 * privacy copy on the landing page is literally true there. The private one
 * (behind an access gate) saves rounds so a phone can walk them. The UI reads
 * this to decide whether to offer saving at all, and what to promise.
 *
 * Unreachable engine → false. Offering a save button that cannot work is
 * worse than not offering it.
 */
import { status } from '$lib/api/client';

class Capability {
	rounds = $state(false);
	checked = $state(false);
	private inflight: Promise<void> | null = null;

	async ensure(): Promise<void> {
		if (this.checked) return;
		this.inflight ??= (async () => {
			try {
				this.rounds = (await status()).rounds === true;
			} catch {
				this.rounds = false;
			} finally {
				this.checked = true;
				this.inflight = null;
			}
		})();
		return this.inflight;
	}
}

export const capability = new Capability();
