import warnings
from collections import Counter

from krantenwijk.cluster import seed_buckets
from krantenwijk.models import Point


def sizes(assignments) -> Counter:
    return Counter(a.bucket for a in assignments)


def test_capacity_respected(points):
    for max_stops in (10, 25, 50):
        counts = sizes(seed_buckets(points, max_stops=max_stops))
        assert max(counts.values()) <= max_stops


def test_every_point_assigned_once(points):
    assignments = seed_buckets(points, max_stops=30)
    assert sorted(a.id for a in assignments) == sorted(p.id for p in points)


def test_deterministic(points):
    a = seed_buckets(points, max_stops=30)
    b = seed_buckets(points, max_stops=30)
    assert a == b


def test_n_carriers_floor(points):
    counts = sizes(seed_buckets(points, max_stops=200, n_carriers=4))
    assert len(counts) >= 4


def test_depot_orders_buckets(points):
    depot = Point(id="depot", lat=points[0].lat, lon=points[0].lon)
    assignments = seed_buckets(points, max_stops=30, depot=depot)
    # bucket-1 must be the bucket containing (or nearest to) the depot anchor
    bucket_of_first = next(a.bucket for a in assignments if a.id == points[0].id)
    assert bucket_of_first == "bucket-1"


def test_empty_and_single():
    assert seed_buckets([]) == []
    single = [Point(id="x", lat=52.37, lon=4.89)]
    result = seed_buckets(single)
    assert len(result) == 1 and result[0].bucket == "bucket-1"


def test_duplicate_coordinates_stay_together():
    """Cards at one door must not be split across carriers."""
    pts = [Point(id=f"h{i}", lat=51.44 + i * 0.002, lon=3.57) for i in range(20)]
    pts += [Point(id=f"door-{j}", lat=51.4700, lon=3.6000) for j in range(3)]
    by_id = {a.id: a.bucket for a in seed_buckets(pts, max_stops=5)}
    assert len({by_id[f"door-{j}"] for j in range(3)}) == 1


def test_an_unsplittable_block_does_not_shatter_the_round():
    """A block of flats at one coordinate can exceed max_stops and no k fixes
    it. The loop must notice rather than escalate to one bucket per point."""
    pts = [
        Point(id=f"h{i}", lat=51.44 + (i % 20) * 0.001, lon=3.57 + (i // 20) * 0.001)
        for i in range(300)
    ]
    pts += [Point(id=f"flat-{j}", lat=51.4700, lon=3.6000) for j in range(60)]

    assignments = seed_buckets(pts, max_stops=50)

    sizes: dict[str, int] = {}
    for a in assignments:
        sizes[a.bucket] = sizes.get(a.bucket, 0) + 1
    # the 300 houses must still be grouped, not shattered into singletons
    assert len(sizes) < 20
    assert sorted(sizes.values())[-2] > 1
    # the block itself stays whole, over capacity and visibly so
    assert len({a.bucket for a in assignments if a.id.startswith("flat-")}) == 1


def test_no_convergence_warning_on_duplicate_points():
    pts = [Point(id=f"d{j}", lat=51.45, lon=3.58) for j in range(12)]
    pts += [Point(id=f"h{i}", lat=51.46 + i * 0.001, lon=3.59) for i in range(3)]
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        seed_buckets(pts, max_stops=5)
