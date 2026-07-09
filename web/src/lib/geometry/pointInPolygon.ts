/**
 * Ray-cast point-in-polygon. Handles a GeoJSON Polygon's outer ring and
 * holes; at city scale, treating lon/lat as planar is fine. Hand-rolled to
 * keep turf out of the dependency tree for one textbook algorithm.
 */
import type { Polygon } from 'geojson';

function inRing(lon: number, lat: number, ring: number[][]): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

export function pointInPolygon(lon: number, lat: number, polygon: Polygon): boolean {
	const [outer, ...holes] = polygon.coordinates;
	if (!outer || !inRing(lon, lat, outer)) return false;
	return !holes.some((hole) => inRing(lon, lat, hole));
}
