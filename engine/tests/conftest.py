"""Shared fixtures — all synthetic, no network ever."""

import pytest

from krantenwijk.models import Point
from krantenwijk.synth import generate


@pytest.fixture(scope="session")
def records():
    return generate(n=200, seed=42)


@pytest.fixture(scope="session")
def points(records) -> list[Point]:
    return [Point(id=r.id, lat=r.lat, lon=r.lon) for r in records]


@pytest.fixture(scope="session")
def small_points(points) -> list[Point]:
    """A routable handful."""
    return points[:12]
