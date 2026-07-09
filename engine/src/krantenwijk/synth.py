"""Synthetic Amsterdam address generator.

Produces the committed demo file (web/static/sample/amsterdam.csv) and every
test fixture. Streets are real Amsterdam street names (bundled list); house
numbers, postcodes, and coordinates are fabricated. Houses are laid out
spaced along a random bearing per street so the dots look street-shaped on a
map instead of uniform noise. Deterministic for a given seed.
"""

import csv
import math
import random
from importlib import resources
from pathlib import Path
from typing import TextIO

import click

from .models import AddressRecord

# Amsterdam bounding box (matches config/location.example.yaml).
BBOX = (4.76, 52.29, 5.02, 52.42)  # min_lon, min_lat, max_lon, max_lat

CATEGORIES = [("griep", 0.8), ("pneum", 0.2)]

# Degrees per meter, latitude; longitude is corrected by cos(lat) per point.
_DEG_PER_M_LAT = 1.0 / 111_320.0

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


def load_streets() -> list[str]:
    text = (
        resources.files("krantenwijk.data")
        .joinpath("amsterdam_streets.txt")
        .read_text(encoding="utf-8")
    )
    lines = (ln.strip() for ln in text.splitlines())
    return [ln for ln in lines if ln and not ln.startswith("#")]


def _house_number(rng: random.Random, seq: int) -> str:
    """Plausible Dutch house number: mostly plain, occasionally suffixed."""
    n = str(seq)
    roll = rng.random()
    if roll < 0.08:
        return n + rng.choice(["hs", "A", "B"])
    if roll < 0.12:
        return f"{n}-{rng.randint(1, 3)}"
    return n


def _postcode(rng: random.Random) -> str:
    letters = "ABCDEGHJKLMNPRSTVWXZ"
    return f"10{rng.randint(11, 99)} {rng.choice(letters)}{rng.choice(letters)}"


def generate(n: int = 400, seed: int = 7) -> list[AddressRecord]:
    """Generate ``n`` synthetic Amsterdam address records."""
    rng = random.Random(seed)
    streets = load_streets()
    rng.shuffle(streets)

    min_lon, min_lat, max_lon, max_lat = BBOX
    # Keep street anchors away from the bbox edge so segments stay inside.
    pad_lon = (max_lon - min_lon) * 0.08
    pad_lat = (max_lat - min_lat) * 0.08

    records: list[AddressRecord] = []
    street_idx = 0
    while len(records) < n:
        street = streets[street_idx % len(streets)]
        street_idx += 1

        houses = rng.randint(8, 22)
        anchor_lat = rng.uniform(min_lat + pad_lat, max_lat - pad_lat)
        anchor_lon = rng.uniform(min_lon + pad_lon, max_lon - pad_lon)
        bearing = rng.uniform(0, math.tau)
        postcode = _postcode(rng)
        first_no = rng.randint(1, 120)
        deg_per_m_lon = _DEG_PER_M_LAT / math.cos(math.radians(anchor_lat))

        for h in range(houses):
            if len(records) >= n:
                break
            along = h * rng.uniform(12.0, 18.0)  # meters along the street
            lateral = rng.uniform(-3.0, 3.0)  # doorstep jitter
            dx = along * math.cos(bearing) - lateral * math.sin(bearing)
            dy = along * math.sin(bearing) + lateral * math.cos(bearing)
            i = len(records)
            records.append(
                AddressRecord(
                    id=f"a-{i:04d}",
                    street=street,
                    house_number=_house_number(rng, first_no + 2 * h),
                    postcode=postcode,
                    city="Amsterdam",
                    lat=round(anchor_lat + dy * _DEG_PER_M_LAT, 6),
                    lon=round(anchor_lon + dx * deg_per_m_lon, 6),
                    category=rng.choices(
                        [c for c, _ in CATEGORIES], weights=[w for _, w in CATEGORIES]
                    )[0],
                    carrier=None,
                )
            )
    return records


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
@click.option("--n", default=400, show_default=True, help="Number of addresses.")
@click.option("--seed", default=7, show_default=True, help="RNG seed.")
@click.option(
    "--out",
    type=click.Path(dir_okay=False, writable=True, path_type=Path),
    required=True,
    help="Output CSV path.",
)
def synth(n: int, seed: int, out: Path) -> None:
    """Generate a synthetic Amsterdam demo CSV."""
    records = generate(n=n, seed=seed)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as f:
        write_csv(records, f)
    click.echo(f"wrote {len(records)} synthetic addresses to {out}")


if __name__ == "__main__":
    synth()
