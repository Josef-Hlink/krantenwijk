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
        self.with_segments = True

    def optimization(self, jobs, vehicles):
        # mirror the real client, which asserts on its Job/Vehicle types
        from openrouteservice.optimization import Job, Vehicle

        assert all(isinstance(j, Job) for j in jobs)
        assert all(isinstance(v, Vehicle) for v in vehicles)
        self.optimization_calls.append({"jobs": jobs, "vehicles": vehicles})
        ordered = list(reversed(jobs)) if self.reverse_jobs else jobs
        steps = (
            [{"type": "start"}]
            + [{"type": "job", "job": j.id} for j in ordered]
            + [{"type": "end"}]
        )
        return {"routes": [{"steps": steps}]}

    def directions(self, coordinates, profile, format):
        self.directions_calls.append(
            {"coordinates": coordinates, "profile": profile, "format": format}
        )
        properties = {"summary": {"duration": 1234.5, "distance": 1650.0}}
        if self.with_segments:
            # real ORS returns one segment per consecutive waypoint pair
            properties["segments"] = [
                {"distance": 100.0 + i, "duration": 80.0 + i}
                for i in range(len(coordinates) - 1)
            ]
        return {
            "features": [
                {
                    "geometry": {
                        # a plausible densified line: echo the inputs plus a bend
                        "coordinates": [list(c) for c in coordinates] + [[4.9, 52.37]],
                    },
                    "properties": properties,
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
    assert vehicle.start == [start.lon, start.lat]
    assert vehicle.end == [end.lon, end.lat]
    assert vehicle.profile == "foot-walking"


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


def test_legs_come_from_directions_segments(backend, small_points):
    result = backend.route(small_points)
    assert len(result.legs) == len(result.order) - 1
    assert [leg.distance_m for leg in result.legs][:3] == [100.0, 101.0, 102.0]
    assert result.legs[0].duration_s == 80.0


def test_legs_fall_back_to_straight_lines_without_segments(backend, fake, small_points):
    fake.with_segments = False
    result = backend.route(small_points)
    # a self-hosted instance that omits segments still gets usable legs, one
    # per pair, rather than a list that doesn't line up with `order`
    assert len(result.legs) == len(result.order) - 1
    assert all(leg.distance_m > 0 for leg in result.legs)


def test_mismatched_segment_count_is_not_trusted(backend, fake, small_points):
    real_directions = fake.directions

    def truncated(coordinates, profile, format):
        out = real_directions(coordinates, profile, format)
        out["features"][0]["properties"]["segments"] = [{"distance": 1, "duration": 1}]
        return out

    fake.directions = truncated
    result = backend.route(small_points)
    assert len(result.legs) == len(result.order) - 1
    assert result.legs[0].distance_m != 1
