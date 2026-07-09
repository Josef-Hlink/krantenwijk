"""OrsBackend against a protocol-level fake — request shape and response
mapping are ours to get right; the wire is the openrouteservice client's job.
"""

import pytest

from krantenwijk.models import Point
from krantenwijk.route import BucketTooLarge, OrsBackend


class FakeOrsClient:
    """Canned ORS responses in the real endpoints' shapes."""

    def __init__(self):
        self.optimization_calls = []
        self.directions_calls = []
        # visit middle jobs in reverse submission order, to prove we map ids
        self.reverse_jobs = True

    def optimization(self, jobs, vehicles):
        self.optimization_calls.append({"jobs": jobs, "vehicles": vehicles})
        ordered = list(reversed(jobs)) if self.reverse_jobs else jobs
        steps = (
            [{"type": "start"}]
            + [{"type": "job", "job": j["id"]} for j in ordered]
            + [{"type": "end"}]
        )
        return {"routes": [{"steps": steps}]}

    def directions(self, coordinates, profile, format):
        self.directions_calls.append(
            {"coordinates": coordinates, "profile": profile, "format": format}
        )
        return {
            "features": [
                {
                    "geometry": {
                        # a plausible densified line: echo the inputs plus a bend
                        "coordinates": [list(c) for c in coordinates] + [[4.9, 52.37]],
                    },
                    "properties": {"summary": {"duration": 1234.5, "distance": 1650.0}},
                }
            ]
        }


@pytest.fixture
def fake():
    return FakeOrsClient()


@pytest.fixture
def backend(fake):
    return OrsBackend(client=fake)


def test_optimized_order_maps_job_ids_back(backend, small_points):
    start, end = small_points[0].id, small_points[-1].id
    result = backend.route(small_points, start_id=start, end_id=end)

    middle = [p.id for p in small_points[1:-1]]
    assert result.order == [start, *reversed(middle), end]
    assert result.engine == "ors"


def test_vehicle_carries_start_end(backend, fake, small_points):
    start, end = small_points[2], small_points[5]
    backend.route(small_points, start_id=start.id, end_id=end.id)
    vehicle = fake.optimization_calls[0]["vehicles"][0]
    assert vehicle["start"] == [start.lon, start.lat]
    assert vehicle["end"] == [end.lon, end.lat]
    assert vehicle["profile"] == "foot-walking"


def test_directions_called_with_ordered_lonlat(backend, fake, small_points):
    result = backend.route(small_points)
    sent = fake.directions_calls[0]
    assert sent["profile"] == "foot-walking"
    assert sent["format"] == "geojson"
    by_id = {p.id: p for p in small_points}
    assert sent["coordinates"] == [
        (by_id[i].lon, by_id[i].lat) for i in result.order
    ]


def test_geometry_and_summary_passthrough(backend, small_points):
    result = backend.route(small_points)
    assert result.duration_s == 1234.5
    assert result.distance_m == 1650.0
    assert result.geometry[-1] == (4.9, 52.37)


def test_no_optimize_keeps_input_order(backend, fake, small_points):
    result = backend.route(small_points, optimize=False)
    assert result.order == [p.id for p in small_points]
    assert fake.optimization_calls == []


def test_bucket_too_large():
    pts = [Point(id=f"p{i}", lat=52.3 + i * 1e-4, lon=4.9) for i in range(51)]
    with pytest.raises(BucketTooLarge):
        OrsBackend(client=FakeOrsClient()).route(pts)
