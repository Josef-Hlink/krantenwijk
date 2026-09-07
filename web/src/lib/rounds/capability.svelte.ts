/**
 * What this caller can do, asked once and remembered.
 *
 * Two questions, and the difference between them matters. `accounts` says an
 * account could be used here at all — false on an instance with no database,
 * where there is nothing to sign in to and no login to offer. `rounds` says
 * *this* caller can reach saved rounds right now: signed in, on an instance
 * that stores them.
 *
 * The UI reads both to decide what to promise. A guest on the family host is
 * offered a way in; a guest on a storage-less one is told the truth, that
 * nothing is stored here at all.
 *
 * Unreachable engine → neither. Offering a save button that cannot work is
 * worse than not offering it.
 */
import { status } from "$lib/api/client";

class Capability {
  accounts = $state(false);
  rounds = $state(false);
  user = $state<string | null>(null);
  checked = $state(false);
  private inflight: Promise<void> | null = null;

  async ensure(): Promise<void> {
    if (this.checked) return;
    return this.inflight ?? this.refresh();
  }

  /**
   * Ask again — after signing in or out, when the answer has just changed.
   * Always a fresh request: one started before the change would answer for
   * the old state, so a refresh queues behind whatever is in flight.
   */
  async refresh(): Promise<void> {
    const previous = this.inflight ?? Promise.resolve();
    const run = previous.then(() => this.ask());
    this.inflight = run;
    try {
      await run;
    } finally {
      if (this.inflight === run) this.inflight = null;
    }
  }

  private async ask(): Promise<void> {
    try {
      const s = await status();
      this.accounts = s.accounts === true;
      this.rounds = s.rounds === true;
      this.user = s.user ?? null;
    } catch {
      this.accounts = false;
      this.rounds = false;
      this.user = null;
    } finally {
      this.checked = true;
    }
  }
}

export const capability = new Capability();

// A tab left open on /plan while you sign in somewhere else — another tab,
// a phone — still believes it is a guest. Coming back to it is the moment to
// ask again; one small request, only for tabs that ever asked at all.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && capability.checked) {
      void capability.refresh();
    }
  });
}
