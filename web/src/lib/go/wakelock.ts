/**
 * Keep the screen awake while walking.
 *
 * A 90-minute round with the display sleeping every 30 seconds is unusable.
 * The lock is released by the browser whenever the tab backgrounds and does
 * not come back on its own, so it is re-requested on visibilitychange.
 *
 * Secure context only, and unsupported on older iOS — every path here is
 * best-effort and silent. Nothing about the walk depends on it.
 */
type Sentinel = { release: () => Promise<void>; released: boolean };

let sentinel: Sentinel | null = null;
let onVisibility: (() => void) | null = null;

async function request(): Promise<void> {
	const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } })
		.wakeLock;
	if (!wl) return;
	try {
		sentinel = await wl.request('screen');
	} catch {
		// denied, low battery, or not permitted — walk on
	}
}

export function keepAwake(): () => void {
	request();
	onVisibility = () => {
		if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) {
			request();
		}
	};
	document.addEventListener('visibilitychange', onVisibility);

	return () => {
		if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
		onVisibility = null;
		sentinel?.release().catch(() => {});
		sentinel = null;
	};
}
