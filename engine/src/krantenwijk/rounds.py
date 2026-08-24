"""Saved rounds — the one part of the engine that holds personal data.

Everything else in this package is coordinates-only by construction (see
``models.py``, whose types literally cannot hold a name). A round is the
exception, and deliberately so: a phone out on the round needs to show the
street, the house number and the resident's name so the carrier can match the
screen against the card in their hand.

That exception is fenced in two ways:

1. **Opt-in.** Storage exists only when ``KRANTENWIJK_ROUNDS_DIR`` is set. With
   it unset — the public deployment — ``rounds_dir()`` returns ``None``, every
   ``/api/rounds`` endpoint 404s, and the engine is exactly as stateless as it
   has always been.
2. **Minimal payload.** The web app sends only the delivery essentials plus the
   detail columns the user explicitly ticked "show on map". Unshown passthrough
   columns from the upload never reach here; full-fidelity export stays a
   browser-side concern.

A private instance running with this enabled must sit behind an access gate.
"""

import os
import re
import secrets
import unicodedata
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

# A round id is used as a filename, so it is restricted to a shape that cannot
# escape the directory: no dots, no slashes, no traversal.
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

MAX_ROUND_BYTES = 8 * 1024 * 1024


class RoundStop(BaseModel):
    """One deliverable address as the phone needs to see it."""

    id: str
    street: str | None = None
    house_number: str | None = None
    postcode: str | None = None
    city: str | None = None
    lat: float
    lon: float
    # Shown detail columns only, keyed by the label the user chose.
    details: dict[str, str] = {}


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


class RoundsDisabled(RuntimeError):
    """No rounds directory is configured; this instance does not store plans."""


class RoundNotFound(LookupError):
    """No round by that id."""


def rounds_dir() -> Path | None:
    """Where rounds live, or ``None`` when this instance stores nothing."""
    configured = os.environ.get("KRANTENWIJK_ROUNDS_DIR", "").strip()
    return Path(configured).expanduser() if configured else None


def _dir() -> Path:
    path = rounds_dir()
    if path is None:
        raise RoundsDisabled(
            "this instance does not store rounds — set KRANTENWIJK_ROUNDS_DIR "
            "to enable saving (private deployments only)"
        )
    path.mkdir(parents=True, exist_ok=True)
    return path


def _path(round_id: str) -> Path:
    if not ID_RE.match(round_id):
        raise RoundNotFound(f"invalid round id {round_id!r}")
    return _dir() / f"{round_id}.json"


def slugify(name: str) -> str:
    """A filename-safe stem from a user-supplied round name."""
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
    path = _path(stored.id)
    payload = stored.model_dump_json(indent=1)
    # Write beside the target and rename: a reader never sees a half-written
    # round, and a crash mid-write leaves the previous version intact.
    tmp = path.with_suffix(f".{secrets.token_hex(4)}.tmp")
    try:
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return stored


def read_round(round_id: str) -> Round:
    path = _path(round_id)
    if not path.is_file():
        raise RoundNotFound(f"no round {round_id!r}")
    if path.stat().st_size > MAX_ROUND_BYTES:
        raise RoundNotFound(f"round {round_id!r} is implausibly large")
    return Round.model_validate_json(path.read_text(encoding="utf-8"))


def delete_round(round_id: str) -> None:
    path = _path(round_id)
    if not path.is_file():
        raise RoundNotFound(f"no round {round_id!r}")
    path.unlink()


def list_rounds() -> list[RoundSummary]:
    """Every stored round, newest first. Unreadable files are skipped, not fatal."""
    summaries = []
    for path in _dir().glob("*.json"):
        try:
            r = Round.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue  # a stray or corrupt file shouldn't break the picker
        summaries.append(
            RoundSummary(
                id=r.id or path.stem,
                name=r.name,
                saved_at=r.saved_at,
                n_stops=len(r.stops),
                n_buckets=len(r.buckets),
            )
        )
    return sorted(summaries, key=lambda s: s.saved_at, reverse=True)
