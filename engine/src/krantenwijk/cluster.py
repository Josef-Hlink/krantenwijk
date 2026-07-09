"""Capacity-constrained clustering: seed buckets the user then reshapes.

Plain kmeans, with k raised until every cluster fits under ``max_stops``.
Coordinates are projected equirectangularly (longitude scaled by
cos(mean latitude)) so Euclidean distance is meaningful at ~52°N. Buckets are
relabeled in order of centroid distance from the depot (nearest first) so
"bucket-1" is the closest round.
"""

import math

from sklearn.cluster import KMeans

from .models import Assignment, Point


def _project(points: list[Point]) -> list[tuple[float, float]]:
    mean_lat = sum(p.lat for p in points) / len(points)
    scale = math.cos(math.radians(mean_lat))
    return [(p.lon * scale, p.lat) for p in points]


def seed_buckets(
    points: list[Point],
    max_stops: int = 50,
    n_carriers: int | None = None,
    depot: Point | None = None,
) -> list[Assignment]:
    """Assign every point to a bucket of at most ``max_stops`` stops."""
    if not points:
        return []
    if max_stops < 1:
        raise ValueError("max_stops must be >= 1")

    coords = _project(points)
    k = max(n_carriers or 1, math.ceil(len(points) / max_stops))
    k = min(k, len(points))

    while True:
        km = KMeans(n_clusters=k, n_init=10, random_state=0)
        labels = km.fit_predict(coords)
        sizes = [int((labels == i).sum()) for i in range(k)]
        if max(sizes) <= max_stops or k >= len(points):
            break
        k += 1

    # Order clusters by centroid distance from the depot (fallback: by size,
    # largest first) and relabel as bucket-1..bucket-k in that order.
    centroids = km.cluster_centers_
    if depot is not None:
        mean_lat = sum(p.lat for p in points) / len(points)
        scale = math.cos(math.radians(mean_lat))
        dx, dy = depot.lon * scale, depot.lat

        def dist2(i: int) -> float:
            return (centroids[i][0] - dx) ** 2 + (centroids[i][1] - dy) ** 2

        order = sorted(range(k), key=dist2)
    else:
        order = sorted(range(k), key=lambda i: -sizes[i])
    rank = {cluster: idx + 1 for idx, cluster in enumerate(order)}

    return [
        Assignment(id=p.id, bucket=f"bucket-{rank[int(label)]}")
        for p, label in zip(points, labels, strict=True)
    ]
