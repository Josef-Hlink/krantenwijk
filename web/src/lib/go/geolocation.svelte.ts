/**
 * Live position, owned rather than delegated to MapLibre's GeolocateControl.
 *
 * The control caches "is geolocation supported" in a module-level global
 * computed once per page load, so a denial — or a stale denial from an earlier
 * session — leaves its button permanently disabled even after the user grants
 * permission in Settings. It also steals the camera on every fix, which is
 * wrong for a walk where you pan ahead and then tap to come back. We need the
 * raw coordinate for the distance readout anyway, so we take the API directly.
 *
 * NOTE: geolocation requires a secure context. https and http://localhost
 * qualify; http://<LAN-IP> does not — testing on a phone against the dev
 * server over plain HTTP gives no position at all, and that is a browser rule,
 * not a bug here. Everything else on /go works without it: the round is fully
 * walkable from the list and the visit numbers.
 */

export type GeoState = 'idle' | 'locating' | 'live' | 'denied' | 'unavailable';

export interface Fix {
	lat: number;
	lon: number;
	/** Metres of uncertainty, as reported. */
	accuracy: number;
	at: number;
}

class Geolocation {
	state = $state<GeoState>('idle');
	fix = $state<Fix | null>(null);
	private watchId: number | null = null;

	get supported(): boolean {
		return typeof navigator !== 'undefined' && 'geolocation' in navigator;
	}

	start() {
		if (this.watchId !== null) return;
		if (!this.supported) {
			// Chrome removes the API entirely outside a secure context.
			this.state = 'unavailable';
			return;
		}
		this.state = 'locating';
		this.watchId = navigator.geolocation.watchPosition(
			(p) => {
				this.fix = {
					lat: p.coords.latitude,
					lon: p.coords.longitude,
					accuracy: p.coords.accuracy,
					at: p.timestamp
				};
				this.state = 'live';
			},
			(err) => {
				if (err.code === err.PERMISSION_DENIED) {
					// Terminal: retrying just re-denies. Stop and say so.
					this.stop();
					this.state = 'denied';
					return;
				}
				// POSITION_UNAVAILABLE / TIMEOUT are transient — keep watching,
				// a fix under a bridge or between buildings often comes back.
				if (!this.fix) this.state = 'locating';
			},
			{ enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
		);
	}

	stop() {
		if (this.watchId !== null) {
			navigator.geolocation.clearWatch(this.watchId);
			this.watchId = null;
		}
		if (this.state !== 'denied') this.state = 'idle';
	}
}

export const geo = new Geolocation();

/** Metres between two coordinates. */
export function haversineM(
	a: { lat: number; lon: number },
	b: { lat: number; lon: number }
): number {
	const R = 6_371_000;
	const rad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * rad;
	const dLon = (b.lon - a.lon) * rad;
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(s));
}
