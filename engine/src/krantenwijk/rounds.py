"""Saved rounds — the one part of the engine that holds personal data.

Everything else in this package is coordinates-only by construction (see
``models.py``, whose types literally cannot hold a name). A round is the
exception, and deliberately so: a phone out on the round needs to show the
street, the house number and the resident's name so the carrier can match the
screen against the card in their hand.

That exception is fenced in two ways:

1. **Opt-in.** Storage exists only when ``KRANTENWIJK_DATABASE_URL`` is set.
   With it unset, ``enabled()`` is ``False``, every ``/api/rounds`` endpoint
   404s, and the engine is exactly as stateless as it has always been.
2. **Minimal payload.** The web app sends only the delivery essentials plus the
   detail columns the user explicitly ticked "show on map". Unshown passthrough
   columns from the upload never reach here; full-fidelity export stays a
   browser-side concern.

Reaching a round additionally requires an account: these endpoints sit behind a
session, so the public instance serves the planner to everyone and the stored
rounds to nobody.
"""

import re
import secrets
import unicodedata
from datetime import UTC, datetime

from psycopg.types.json import Jsonb
from pydantic import BaseModel

from . import db
from .db import StorageDisabled

# A round id is a primary key and a URL segment, so it is restricted to a shape
# that can be neither confused nor smuggled: lowercase, no dots, no slashes.
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

MAX_ROUND_BYTES = 8 * 1024 * 1024

# Kept under its old name: callers care that *rounds* are unavailable, not that
# a database is. See db.StorageDisabled.
RoundsDisabled = StorageDisabled


class RoundStop(BaseModel):
    """One doorstep as the phone needs to see it.

    A stop is a door, not a card. A household called up twice is one place
    you walk to carrying two cards, so ``cards`` holds one entry per card —
    each the shown detail columns, keyed by the label the user chose.
    """

    id: str
    street: str | None = None
    house_number: str | None = None
    postcode: str | None = None
    city: str | None = None
    lat: float
    lon: float
    cards: list[dict[str, str]] = []


class RoundLeg(BaseModel):
    """The walk from one stop to the next."""

    distance_m: float
    duration_s: float


class RoundBucket(BaseModel):
    """One carrier's slice of the round, in visit order."""

    id: str
    name: str
    color: str
    carrier: str | None = None
    order: list[str] = []  # stop ids, in visit order
    geometry: list[tuple[float, float]] = []  # [lon, lat], GeoJSON axis order
    legs: list[RoundLeg] = []  # len == len(order) - 1 when routed
    distance_m: float = 0.0
    duration_s: float = 0.0


class Round(BaseModel):
    """A saved plan: every stop, and the buckets that walk them."""

    id: str = ""
    name: str
    saved_at: str = ""  # ISO 8601, UTC
    stops: list[RoundStop] = []
    buckets: list[RoundBucket] = []


class RoundSummary(BaseModel):
    """Listing shape — enough to pick one, with no address or name in it."""

    id: str
    name: str
    saved_at: str
    n_stops: int
    n_buckets: int


class RoundNotFound(LookupError):
    """No round by that id."""


class RoundTooLarge(ValueError):
    """A payload no plausible round would reach."""


def enabled() -> bool:
    """Whether this instance stores rounds at all."""
    return db.configured()


def slugify(name: str) -> str:
    """A readable, URL-safe stem from a user-supplied round name."""
    folded = unicodedata.normalize("NFKD", name)
    ascii_only = folded.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")[:48]
    return slug or "round"


def new_id(name: str) -> str:
    """A fresh, collision-resistant id. The suffix keeps same-named rounds apart."""
    return f"{slugify(name)}-{secrets.token_hex(3)}"


def write_round(round_: Round) -> Round:
    """Persist a round, stamping id and save time. Returns what was stored."""
    stored = round_.model_copy(
        update={
            "id": round_.id if ID_RE.match(round_.id or "") else new_id(round_.name),
            "saved_at": datetime.now(UTC).isoformat(timespec="seconds"),
        }
    )
    payload = stored.model_dump(mode="json")
    size = len(stored.model_dump_json().encode("utf-8"))
    if size > MAX_ROUND_BYTES:
        raise RoundTooLarge(f"round is {size} bytes; the limit is {MAX_ROUND_BYTES}")
    with db.connection() as conn:
        conn.execute(
            """
            insert into rounds (id, name, saved_at, payload)
            values (%s, %s, %s, %s)
            on conflict (id) do update
               set name = excluded.name,
                   saved_at = excluded.saved_at,
                   payload = excluded.payload
            """,
            (
                stored.id,
                stored.name,
                datetime.fromisoformat(stored.saved_at),
                Jsonb(payload),
            ),
        )
    return stored


def read_round(round_id: str) -> Round:
    if not ID_RE.match(round_id):
        raise RoundNotFound(f"invalid round id {round_id!r}")
    with db.connection() as conn:
        row = conn.execute(
            "select payload from rounds where id = %s", (round_id,)
        ).fetchone()
    if row is None:
        raise RoundNotFound(f"no round {round_id!r}")
    return Round.model_validate(row[0])


def delete_round(round_id: str) -> None:
    if not ID_RE.match(round_id):
        raise RoundNotFound(f"invalid round id {round_id!r}")
    with db.connection() as conn:
        deleted = conn.execute("delete from rounds where id = %s", (round_id,)).rowcount
    if not deleted:
        raise RoundNotFound(f"no round {round_id!r}")


def list_rounds() -> list[RoundSummary]:
    """Every stored round, newest first.

    The counts come out of the jsonb rather than from parsing each payload, so
    the picker costs one query and stays fast — and a round whose payload no
    longer validates against the current model still lists, instead of taking
    the whole picker down with it.
    """
    with db.connection() as conn:
        rows = conn.execute(
            """
            select id,
                   name,
                   saved_at,
                   coalesce(jsonb_array_length(payload -> 'stops'), 0),
                   coalesce(jsonb_array_length(payload -> 'buckets'), 0)
            from rounds
            order by saved_at desc, id
            """
        ).fetchall()
    return [
        RoundSummary(
            id=id_,
            name=name,
            saved_at=saved_at.astimezone(UTC).isoformat(timespec="seconds"),
            n_stops=n_stops,
            n_buckets=n_buckets,
        )
        for id_, name, saved_at, n_stops, n_buckets in rows
    ]
