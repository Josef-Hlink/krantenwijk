"""Demo-round generator: real addresses, fictional round.

The committed demo file uses *real* Vlissingen addresses — public data from
OpenStreetMap (© OpenStreetMap contributors, ODbL; address data in the
Netherlands originates from the public BAG register). What's fabricated is
the round itself: opaque ids, invented residents (random names and
elfproef-valid but meaningless BSNs, there to show that sensitive columns
can ride along without ever being used), a category split, and the
sampling. No real person or delivery is referenced, only letterboxes that
exist.

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
    "naam",
    "bsn",
    "straat",
    "huisnr",
    "postcode",
    "plaats",
    "lat",
    "lon",
    "soort",
    "loper",
]

FIRST_NAMES = [
    "Ada",
    "Anna",
    "Bram",
    "Carla",
    "Daan",
    "Els",
    "Femke",
    "Gijs",
    "Hanna",
    "Hendrik",
    "Iris",
    "Jan",
    "Johanna",
    "Kees",
    "Lieke",
    "Marijke",
    "Niels",
    "Otto",
    "Pieter",
    "Roos",
    "Sanne",
    "Sem",
    "Teun",
    "Willem",
]

SURNAMES = [
    "Bakker",
    "Bos",
    "Brouwer",
    "de Boer",
    "de Bruin",
    "de Groot",
    "de Vries",
    "de Wit",
    "Dekker",
    "Dijkstra",
    "Hendriks",
    "Jansen",
    "Kuipers",
    "Maas",
    "Mulder",
    "Peters",
    "Post",
    "Smits",
    "van den Berg",
    "van der Meer",
    "van Dijk",
    "van Leeuwen",
    "Visser",
    "Vos",
]


def make_bsn(rng: random.Random) -> str:
    """A random 9-digit number satisfying the BSN elfproef: 9·d1 + 8·d2 +
    … + 2·d8 − d9 ≡ 0 (mod 11). Valid-looking, tied to nobody."""
    while True:
        digits = [rng.randint(1, 9)] + [rng.randint(0, 9) for _ in range(7)]
        check = sum((9 - i) * d for i, d in enumerate(digits)) % 11
        if check == 10:
            continue
        return "".join(map(str, digits + [check]))


def synth_person(record_id: str, seed: int = 7) -> tuple[str, str]:
    """Deterministic invented resident for a demo row: (naam, bsn).

    Seeded per record id, so the committed CSV can be re-derived or
    augmented offline without reshuffling everyone."""
    rng = random.Random(f"{seed}:{record_id}")
    naam = f"{rng.choice(FIRST_NAMES)} {rng.choice(SURNAMES)}"
    return naam, make_bsn(rng)


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
    pool = sorted(addresses, key=lambda r: (r.street, r.postcode or "", r.house_number))
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


def write_csv(records: list[AddressRecord], out: TextIO, seed: int = 7) -> None:
    """Write records using the demo column names from schema.example.yaml."""
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)
    for r in records:
        naam, bsn = synth_person(r.id, seed=seed)
        writer.writerow(
            [
                r.id,
                naam,
                bsn,
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
        write_csv(records, f, seed=seed)
    click.echo(f"wrote {len(records)} demo addresses to {out}")


if __name__ == "__main__":
    demo()
