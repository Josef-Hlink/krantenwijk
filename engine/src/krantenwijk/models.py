"""Canonical data model.

There is deliberately no field for a name, birthdate, email, phone number, or
any other personal attribute — the model cannot hold them. ``id`` is an opaque
string supplied by the caller; it only means something joined against the
caller's own private table.
"""

from pydantic import BaseModel, ConfigDict


class AddressRecord(BaseModel):
    """One deliverable address, as accepted from an anonymized upload."""

    id: str
    street: str
    house_number: str
    postcode: str | None = None
    city: str | None = None
    lat: float | None = None
    lon: float | None = None
    category: str | None = None
    extra: dict[str, str] = {}


class Point(BaseModel):
    """The only shape the API endpoints ever see: an id and a coordinate."""

    model_config = ConfigDict(frozen=True)

    id: str
    lat: float
    lon: float


class Assignment(BaseModel):
    """A point's bucket membership, as returned by clustering."""

    id: str
    bucket: str


class RouteResult(BaseModel):
    """An ordered visit sequence for one bucket."""

    order: list[str]
    geometry: list[tuple[float, float]]  # [lon, lat] pairs, GeoJSON axis order
    duration_s: float
    distance_m: float
    engine: str  # "ors" | "fallback"
