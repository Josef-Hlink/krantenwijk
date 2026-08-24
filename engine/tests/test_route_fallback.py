import math

import pytest

from krantenwijk.route import FallbackBackend, haversine_m


def path_length(backend_result, by_id):
    pts = [by_id[i] for i in backend_result.order]
    return sum(
        haversine_m((a.lat, a.lon), (b.lat, b.lon))
        for a, b in zip(pts, pts[1:], strict=False)
    )


def test_start_end_pinned(small_points):
    start, end = small_points[3].id, small_points[7].id
    result = FallbackBackend().route(small_points, start_id=start, end_id=end)
    assert result.order[0] == start
    assert result.order[-1] == end


def test_permutation_complete(small_points):
    result = FallbackBackend().route(small_points)
    assert sorted(result.order) == sorted(p.id for p in small_points)


def test_optimize_never_worse_than_input_order(small_points):
    backend = FallbackBackend()
    by_id = {p.id: p for p in small_points}
    raw = backend.route(small_points, optimize=False)
    opt = backend.route(small_points, optimize=True)
    assert path_length(opt, by_id) <= path_length(raw, by_id) + 1e-6


def test_duration_consistent_with_distance(small_points):
    result = FallbackBackend().route(small_points)
    assert math.isclose(result.duration_s, result.distance_m / 1.33, rel_tol=1e-9)
    assert result.engine == "fallback"


def test_single_point(small_points):
    result = FallbackBackend().route(small_points[:1])
    assert result.order == [small_points[0].id]
    assert result.distance_m == 0


def test_legs_line_up_with_the_order_and_sum_to_the_total(small_points):
    result = FallbackBackend().route(small_points)
    assert len(result.legs) == len(result.order) - 1
    assert sum(leg.distance_m for leg in result.legs) == pytest.approx(
        result.distance_m
    )
