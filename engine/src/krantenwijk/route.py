"""Per-bucket walking-route optimization.

Two interchangeable backends:

- ``OrsBackend`` — OpenRouteService. We call the optimization endpoint
  (Vroom TSP; start/end pinned on the vehicle) and then directions with the
  ordered coordinates for real street geometry. We deliberately do NOT use
  the client's ``optimize_waypoints`` flag: it reorders coordinates
  internally without exposing the permutation, so the result can't be mapped
  back to point ids.

- ``FallbackBackend`` — no network, no key: greedy nearest-neighbor from the
  start with the end pinned last, improved by a 2-opt pass, straight-line
  geometry, durations from haversine length at walking speed. Good enough to
  demo and test with; the UI badges it as approximate.

``get_backend()`` picks ORS iff ``ORS_API_KEY`` is set.
"""

import math
import os
from typing import Any, Protocol

import openrouteservice

from .models import Point, RouteResult

WALKING_SPEED_M_S = 1.33  # ~4.8 km/h

# Public ORS optimization tops out around 50 jobs per request; max_stops
# defaults to 50 so a legal bucket always fits.
MAX_ORS_STOPS = 50


class BucketTooLarge(ValueError):
    """Raised when a bucket exceeds what the routing backend accepts."""


class RoutingBackend(Protocol):
    def route(
        self,
        points: list[Point],
        start_id: str | None = None,
        end_id: str | None = None,
        optimize: bool = True,
    ) -> RouteResult: ...


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance in meters between two (lat, lon) pairs."""
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def _split_fixed(
    points: list[Point], start_id: str | None, end_id: str | None
) -> tuple[Point, Point, list[Point]]:
    """Resolve start/end points (defaulting to first/last) and the middle."""
    by_id = {p.id: p for p in points}
    if start_id is not None and start_id not in by_id:
        raise ValueError(f"start_id {start_id!r} not among points")
    if end_id is not None and end_id not in by_id:
        raise ValueError(f"end_id {end_id!r} not among points")
    start = by_id[start_id] if start_id else points[0]
    end = by_id[end_id] if end_id else points[-1]
    if start.id == end.id and len(points) > 1:
        raise ValueError("start and end must be different points")
    middle = [p for p in points if p.id not in (start.id, end.id)]
    return start, end, middle


class FallbackBackend:
    """Keyless approximation: NN + 2-opt, straight lines, haversine timing."""

    engine = "fallback"

    def route(
        self,
        points: list[Point],
        start_id: str | None = None,
        end_id: str | None = None,
        optimize: bool = True,
    ) -> RouteResult:
        if not points:
            raise ValueError("no points to route")
        if len(points) == 1:
            p = points[0]
            return RouteResult(
                order=[p.id], geometry=[(p.lon, p.lat)], duration_s=0.0,
                distance_m=0.0, engine=self.engine,
            )

        start, end, middle = _split_fixed(points, start_id, end_id)
        ordered = [start, *middle, end]
        if optimize:
            ordered = self._nearest_neighbor(start, end, middle)
            ordered = self._two_opt(ordered)

        distance = sum(
            haversine_m((a.lat, a.lon), (b.lat, b.lon))
            for a, b in zip(ordered, ordered[1:], strict=False)
        )
        return RouteResult(
            order=[p.id for p in ordered],
            geometry=[(p.lon, p.lat) for p in ordered],
            duration_s=distance / WALKING_SPEED_M_S,
            distance_m=distance,
            engine=self.engine,
        )

    @staticmethod
    def _nearest_neighbor(start: Point, end: Point, middle: list[Point]) -> list[Point]:
        ordered = [start]
        remaining = middle.copy()
        while remaining:
            here = ordered[-1]

            def from_here(p: Point, here: Point = here) -> float:
                return haversine_m((here.lat, here.lon), (p.lat, p.lon))

            nxt = min(remaining, key=from_here)
            remaining.remove(nxt)
            ordered.append(nxt)
        ordered.append(end)
        return ordered

    @staticmethod
    def _two_opt(path: list[Point]) -> list[Point]:
        """Reverse segments while doing so shortens the path (ends fixed)."""

        def d(a: Point, b: Point) -> float:
            return haversine_m((a.lat, a.lon), (b.lat, b.lon))

        best = path.copy()
        improved = True
        while improved:
            improved = False
            for i in range(1, len(best) - 2):
                for j in range(i + 1, len(best) - 1):
                    delta = (
                        d(best[i - 1], best[j]) + d(best[i], best[j + 1])
                        - d(best[i - 1], best[i]) - d(best[j], best[j + 1])
                    )
                    if delta < -1e-9:
                        best[i : j + 1] = reversed(best[i : j + 1])
                        improved = True
        return best


class OrsBackend:
    """OpenRouteService: Vroom optimization + foot-walking directions."""

    engine = "ors"

    def __init__(self, client: Any | None = None):
        if client is None:
            client = openrouteservice.Client(
                key=os.environ["ORS_API_KEY"],
                base_url=os.environ.get("ORS_URL", "https://api.heigit.org"),
            )
        self.client = client

    def route(
        self,
        points: list[Point],
        start_id: str | None = None,
        end_id: str | None = None,
        optimize: bool = True,
    ) -> RouteResult:
        if not points:
            raise ValueError("no points to route")
        if len(points) > MAX_ORS_STOPS:
            raise BucketTooLarge(
                f"bucket has {len(points)} stops; ORS optimization accepts "
                f"~{MAX_ORS_STOPS} — split the bucket"
            )
        if len(points) == 1:
            p = points[0]
            return RouteResult(
                order=[p.id], geometry=[(p.lon, p.lat)], duration_s=0.0,
                distance_m=0.0, engine=self.engine,
            )

        start, end, middle = _split_fixed(points, start_id, end_id)
        ordered = [start, *middle, end]
        if optimize and middle:
            ordered = self._optimize_order(start, end, middle)

        directions = self.client.directions(
            [(p.lon, p.lat) for p in ordered],
            profile="foot-walking",
            format="geojson",
        )
        feature = directions["features"][0]
        summary = feature["properties"]["summary"]
        return RouteResult(
            order=[p.id for p in ordered],
            geometry=[tuple(c) for c in feature["geometry"]["coordinates"]],
            duration_s=summary["duration"],
            distance_m=summary["distance"],
            engine=self.engine,
        )

    def _optimize_order(
        self, start: Point, end: Point, middle: list[Point]
    ) -> list[Point]:
        jobs = [
            {"id": i, "location": [p.lon, p.lat]} for i, p in enumerate(middle)
        ]
        vehicle = {
            "id": 0,
            "profile": "foot-walking",
            "start": [start.lon, start.lat],
            "end": [end.lon, end.lat],
        }
        result = self.client.optimization(jobs=jobs, vehicles=[vehicle])
        steps = result["routes"][0]["steps"]
        visited = [middle[s["job"]] for s in steps if s["type"] == "job"]
        return [start, *visited, end]


def get_backend() -> RoutingBackend:
    if os.environ.get("ORS_API_KEY"):
        return OrsBackend()
    return FallbackBackend()
