"""Demo-round generator: real addresses, fictional round.

The committed demo file uses *real* Vlissingen addresses — public data from
OpenStreetMap (© OpenStreetMap contributors, ODbL; address data in the
Netherlands originates from the public BAG register). What's fabricated is
the round itself: opaque ids, a category split, and the sampling. No real
person or delivery is referenced, only letterboxes that exist.

Fetching hits the Overpass API (network); sampling/writing is deterministic
and offline, so tests only exercise ``make_round``/``write_csv``.
"""

import csv
import random
from pathlib import Path
from typing import TextIO

import click
import httpx

from .models import AddressRecord

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# A bbox query resolves far faster on Overpass than an area query; the
# addr:city filter keeps it exact within the box.
QUERY = """
[out:json][timeout:120][bbox:{bbox}];
node["addr:housenumber"]["addr:street"]["addr:city"="{place}"];
out tags center;
"""

# south, west, north, east — Vlissingen and surroundings
DEFAULT_BBOX = "51.42,3.53,51.49,3.64"

CATEGORIES = [("griep", 0.8), ("pneum", 0.2)]

CSV_COLUMNS = [
    "id",
    "straat",
    "huisnr",
    "postcode",
    "plaats",
    "lat",
    "lon",
    "soort",
    "loper",
]


def fetch_addresses(place: str, bbox: str = DEFAULT_BBOX) -> list[AddressRecord]:
    """All OSM address nodes for a Dutch place (network)."""
    query = QUERY.format(place=place, bbox=bbox)
    last_error: Exception | None = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            resp = httpx.post(endpoint, data={"data": query}, timeout=120)
            resp.raise_for_status()
            elements = resp.json()["elements"]
            break
        except (httpx.HTTPError, KeyError, ValueError) as e:
            last_error = e
    else:
        raise RuntimeError(f"all Overpass endpoints failed: {last_error}")

    seen: set[tuple[str, str, str]] = set()
    records: list[AddressRecord] = []
    for el in elements:
        tags = el.get("tags", {})
        street = tags.get("addr:street")
        number = tags.get("addr:housenumber")
        if not street or not number or "lat" not in el:
            continue
        key = (street, number, tags.get("addr:postcode", ""))
        if key in seen:
            continue
        seen.add(key)
        records.append(
            AddressRecord(
                id="",  # assigned when a round is made
                street=street,
                house_number=number,
                postcode=tags.get("addr:postcode"),
                city=tags.get("addr:city", place),
                lat=el["lat"],
                lon=el["lon"],
            )
        )
    return records


def make_round(
    addresses: list[AddressRecord], n: int = 400, seed: int = 7
) -> list[AddressRecord]:
    """Deterministically sample a fictional round from real addresses."""
    rng = random.Random(seed)
    pool = sorted(
        addresses, key=lambda r: (r.street, r.postcode or "", r.house_number)
    )
    sample = rng.sample(pool, min(n, len(pool)))
    return [
        r.model_copy(
            update={
                "id": f"v-{i:04d}",
                "category": rng.choices(
                    [c for c, _ in CATEGORIES], weights=[w for _, w in CATEGORIES]
                )[0],
            }
        )
        for i, r in enumerate(sample)
    ]


def write_csv(records: list[AddressRecord], out: TextIO) -> None:
    """Write records using the demo column names from schema.example.yaml."""
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    for r in records:
        writer.writerow(
            [
                r.id,
                r.street,
                r.house_number,
                r.postcode,
                r.city,
                r.lat,
                r.lon,
                r.category,
                r.carrier or "",
            ]
        )


@click.command()
@click.option("--place", default="Vlissingen", show_default=True)
@click.option(
    "--bbox", default=DEFAULT_BBOX, show_default=True, help="south,west,north,east"
)
@click.option("--n", default=400, show_default=True, help="Number of addresses.")
@click.option("--seed", default=7, show_default=True, help="RNG seed.")
@click.option(
    "--out",
    type=click.Path(dir_okay=False, writable=True, path_type=Path),
    required=True,
    help="Output CSV path.",
)
def demo(place: str, bbox: str, n: int, seed: int, out: Path) -> None:
    """Generate the demo CSV: real addresses, fictional round."""
    addresses = fetch_addresses(place, bbox=bbox)
    click.echo(f"fetched {len(addresses)} addresses in {place} from OpenStreetMap")
    records = make_round(addresses, n=n, seed=seed)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        write_csv(records, f)
    click.echo(f"wrote {len(records)} demo addresses to {out}")


if __name__ == "__main__":
    demo()
