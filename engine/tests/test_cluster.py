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
