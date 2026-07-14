"""Shared fixtures — offline only, no network ever.

The committed demo CSV (real Vlissingen addresses, fictional round) doubles
as the realistic fixture set; tests validate the artifact we actually ship.
"""

import csv
from pathlib import Path

import pytest

from krantenwijk.models import AddressRecord, Point

DEMO_CSV = Path(__file__).parents[2] / "web" / "static" / "sample" / "vlissingen.csv"


@pytest.fixture(scope="session")
def records() -> list[AddressRecord]:
    with DEMO_CSV.open(encoding="utf-8") as f:
        return [
            AddressRecord(
                id=row["id"],
                street=row["straat"],
                house_number=row["huisnr"],
                postcode=row["postcode"] or None,
                city=row["plaats"] or None,
                lat=float(row["lat"]),
                lon=float(row["lon"]),
                category=row["soort"] or None,
            )
            for row in csv.DictReader(f)
        ]


@pytest.fixture(scope="session")
def points(records) -> list[Point]:
    return [Point(id=r.id, lat=r.lat, lon=r.lon) for r in records]


@pytest.fixture(scope="session")
def small_points(points) -> list[Point]:
    """A routable handful."""
    return points[:12]
