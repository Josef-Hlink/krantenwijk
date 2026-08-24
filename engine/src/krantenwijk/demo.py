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


def synth_person(
    person_key: str, seed: int = 7, household: str | None = None
) -> tuple[str, str]:
    """Deterministic invented resident: (naam, bsn).

    Seeded per *person*, not per row — one resident can be called up twice
    in the same round (a griep card and a pneum card), and both rows must
    carry the same name and BSN. When a household key is given the surname
    is seeded from that, so several residents at one address read as one
    family.
    """
    rng = random.Random(f"{seed}:{person_key}")
    first = rng.choice(FIRST_NAMES)
    surname_rng = random.Random(f"{seed}:huis:{household}") if household else rng
    naam = f"{first} {surname_rng.choice(SURNAMES)}"
    return naam, make_bsn(rng)


def assign_people(door: str, n_cards: int, seed: int = 7) -> list[tuple[str, str]]:
    """Who each of a door's cards is for.

    Cards are not people. A resident called up for both griep and pneum gets
    two cards at one address, so a door with three cards may hold only two
    names — the case the walking view has to collapse.
    """
    rng = random.Random(f"{seed}:mensen:{door}")
    n_people = n_cards
    if n_cards > 1 and rng.random() < 0.4:
        n_people = n_cards - 1
    people = [
        synth_person(f"{door}:{i}", seed=seed, household=door) for i in range(n_people)
    ]
    # the extra card falls to the last resident listed
    return [people[min(i, n_people - 1)] for i in range(n_cards)]


def household_key(r: AddressRecord) -> str:
    """The door a record belongs to — mirrors the app's grouping."""
    return f"{r.street.strip().lower()}|{r.house_number.strip().lower()}"


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


# Share of doors that call up more than one resident. A GP round really does
# hit households twice — two parents, a couple — and the demo has to contain
# the case or nothing downstream is ever exercised against it.
CARD_COUNTS = [(1, 0.84), (2, 0.13), (3, 0.03)]


def make_round(
    addresses: list[AddressRecord], n: int = 400, seed: int = 7
) -> list[AddressRecord]:
    """Deterministically sample a fictional round from real addresses.

    ``n`` counts cards, not doors: some addresses get two or three, so the
    round holds slightly fewer distinct addresses than rows.
    """
    rng = random.Random(seed)
    pool = sorted(addresses, key=lambda r: (r.street, r.postcode or "", r.house_number))
    sample = rng.sample(pool, min(n, len(pool)))

    records: list[AddressRecord] = []
    for address in sample:
        if len(records) >= n:
            break
        cards = rng.choices(
            [c for c, _ in CARD_COUNTS], weights=[w for _, w in CARD_COUNTS]
        )[0]
        for _ in range(min(cards, n - len(records))):
            records.append(
                address.model_copy(
                    update={
                        "id": f"v-{len(records):04d}",
                        "category": rng.choices(
                            [c for c, _ in CATEGORIES],
                            weights=[w for _, w in CATEGORIES],
                        )[0],
                    }
                )
            )
    return records


def write_csv(records: list[AddressRecord], out: TextIO, seed: int = 7) -> None:
    """Write records using the demo column names from schema.example.yaml."""
    writer = csv.writer(out)
    writer.writerow(CSV_COLUMNS)

    # Cards at one door are consecutive, so residents can be assigned per door.
    people: dict[str, list[tuple[str, str]]] = {}
    counts: dict[str, int] = {}
    for r in records:
        counts[household_key(r)] = counts.get(household_key(r), 0) + 1
    for door, n_cards in counts.items():
        people[door] = assign_people(door, n_cards, seed=seed)

    # A resident called up twice holds one griep card and one pneum card —
    # never two of the same. Their cards' categories are fixed here, where
    # the person assignment is known.
    per_person: dict[tuple[str, str], int] = {}
    first_category: dict[tuple[str, str], str] = {}

    used: dict[str, int] = {}
    for r in records:
        door = household_key(r)
        i = used.get(door, 0)
        used[door] = i + 1
        naam, bsn = people[door][i]
        who = (door, naam)
        nth = per_person.get(who, 0)
        per_person[who] = nth + 1
        if nth == 0:
            category = r.category or CATEGORIES[0][0]
            first_category[who] = category
        else:
            others = [c for c, _ in CATEGORIES if c != first_category.get(who)]
            category = others[(nth - 1) % len(others)] if others else r.category
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
                category,
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
