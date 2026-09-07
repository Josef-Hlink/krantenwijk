"""Saved rounds: the storage layer, and the opt-in that fences it off.

The privacy-relevant assertions here are the ones about a *disabled* instance —
with no database configured nothing is written and every endpoint 404s.

`store` and `disabled` are the two deployment profiles, as fixtures; both live
in conftest.py, and `store` hands back a real postgres with empty tables.
"""

import json

import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from krantenwijk import api, db, rounds
from krantenwijk.rounds import Round, RoundBucket, RoundNotFound, RoundStop


def count_rounds() -> int:
    with db.connection() as conn:
        return conn.execute("select count(*) from rounds").fetchone()[0]


@pytest.fixture
def sample() -> Round:
    return Round(
        name="Vlissingen najaar",
        stops=[
            RoundStop(
                id="a1",
                street="Badhuisstraat",
                house_number="12",
                postcode="4381 LR",
                city="Vlissingen",
                lat=51.4426,
                lon=3.5736,
                cards=[{"naam": "J. de Vries"}, {"naam": "M. de Vries"}],
            ),
            RoundStop(
                id="a2",
                street="Badhuisstraat",
                house_number="14",
                lat=51.4428,
                lon=3.5739,
            ),
        ],
        buckets=[
            RoundBucket(
                id="b1",
                name="bucket 1",
                color="#1f6feb",
                carrier="Josef",
                order=["a1", "a2"],
                distance_m=42.0,
                duration_s=31.0,
            )
        ],
    )


# ── storage ─────────────────────────────────────────────────────────────


def test_round_trip(store, sample):
    stored = rounds.write_round(sample)
    assert stored.id and stored.saved_at
    back = rounds.read_round(stored.id)
    assert back.name == "Vlissingen najaar"
    # a household called up twice is one stop carrying two cards
    assert back.stops[0].cards == [{"naam": "J. de Vries"}, {"naam": "M. de Vries"}]
    assert back.buckets[0].order == ["a1", "a2"]


def test_id_is_slugged_from_the_name(store, sample):
    stored = rounds.write_round(sample.model_copy(update={"name": "Najaar 2026!"}))
    assert stored.id.startswith("najaar-2026-")
    assert rounds.ID_RE.match(stored.id)


def test_same_name_twice_does_not_collide(store, sample):
    a = rounds.write_round(sample)
    b = rounds.write_round(sample)
    assert a.id != b.id
    assert count_rounds() == 2


def test_listing_is_newest_first_and_carries_no_pii(store, sample):
    rounds.write_round(sample.model_copy(update={"name": "eerste"}))
    rounds.write_round(sample.model_copy(update={"name": "tweede"}))
    summaries = rounds.list_rounds()
    assert {s.name for s in summaries} == {"eerste", "tweede"}
    assert all(s.n_stops == 2 and s.n_buckets == 1 for s in summaries)
    # a summary is id/name/counts only — no way to leak an address through it
    blob = json.dumps([s.model_dump() for s in summaries])
    assert "Badhuisstraat" not in blob and "de Vries" not in blob


def test_a_door_may_carry_several_cards(store, sample):
    """A stop is a doorstep, not a card: the phone shows every name behind
    one letterbox and ticks the lot off together."""
    stored = rounds.write_round(sample)
    back = rounds.read_round(stored.id)
    assert len(back.stops[0].cards) == 2
    assert len(back.stops[1].cards) == 0  # a door with nothing shown is fine
    assert back.buckets[0].order == ["a1", "a2"], "one entry per door, not per card"


def test_listing_does_not_parse_payloads(store, sample):
    """A round the current model can no longer validate must still list.

    The picker asks postgres for the counts rather than loading and validating
    every payload, so a round written by an older shape of the model shows up
    to be picked (or deleted) instead of taking the whole picker down.
    """
    rounds.write_round(sample)
    with db.connection() as conn:
        conn.execute(
            "insert into rounds (id, name, saved_at, payload) "
            "values (%s, %s, now(), %s)",
            ("van-vroeger-abc123", "van vroeger", Jsonb({"shape": "long gone"})),
        )
    summaries = rounds.list_rounds()
    assert len(summaries) == 2
    stale = next(s for s in summaries if s.id == "van-vroeger-abc123")
    assert (stale.n_stops, stale.n_buckets) == (0, 0)


def test_delete(store, sample):
    stored = rounds.write_round(sample)
    rounds.delete_round(stored.id)
    with pytest.raises(RoundNotFound):
        rounds.read_round(stored.id)


@pytest.mark.parametrize(
    "bad", ["../secrets", "..", "a/b", "with.dot", "UPPER", "", "-leading"]
)
def test_ids_outside_the_permitted_shape_are_refused(store, bad):
    """Never reaches the database: an id is validated before it is a parameter."""
    with pytest.raises(RoundNotFound):
        rounds.read_round(bad)
    with pytest.raises(RoundNotFound):
        rounds.delete_round(bad)


def test_rewriting_an_id_replaces_rather_than_duplicates(store, sample):
    first = rounds.write_round(sample)
    again = rounds.write_round(
        sample.model_copy(update={"id": first.id, "name": "herzien"})
    )
    assert again.id == first.id
    assert count_rounds() == 1
    assert rounds.read_round(first.id).name == "herzien"


def test_disabled_instance_writes_nothing(disabled, sample):
    assert rounds.enabled() is False
    with pytest.raises(rounds.RoundsDisabled):
        rounds.write_round(sample)
    with pytest.raises(rounds.RoundsDisabled):
        rounds.list_rounds()


# ── API surface ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/rounds"),
        ("post", "/api/rounds"),
        ("get", "/api/rounds/whatever"),
        ("put", "/api/rounds/whatever"),
        ("delete", "/api/rounds/whatever"),
    ],
)
def test_every_rounds_endpoint_404s_when_disabled(disabled, method, path):
    client = TestClient(api.create_app())
    r = client.request(method, path, json={"name": "x"})
    assert r.status_code == 404
    assert "does not store rounds" in r.json()["detail"]


def test_api_create_read_delete(signed_in, sample):
    client = signed_in
    created = client.post("/api/rounds", json=sample.model_dump())
    assert created.status_code == 200
    round_id = created.json()["id"]

    listed = client.get("/api/rounds").json()
    assert [s["id"] for s in listed] == [round_id]

    got = client.get(f"/api/rounds/{round_id}").json()
    assert got["stops"][0]["cards"][0]["naam"] == "J. de Vries"

    assert client.delete(f"/api/rounds/{round_id}").status_code == 204
    assert client.get(f"/api/rounds/{round_id}").status_code == 404


def test_api_create_ignores_a_client_supplied_id(signed_in, sample):
    created = signed_in.post(
        "/api/rounds", json=sample.model_copy(update={"id": "hijacked"}).model_dump()
    )
    assert created.json()["id"] != "hijacked"


def test_api_put_updates_in_place(signed_in, sample):
    client = signed_in
    round_id = client.post("/api/rounds", json=sample.model_dump()).json()["id"]
    updated = sample.model_copy(update={"name": "herzien"})
    r = client.put(f"/api/rounds/{round_id}", json=updated.model_dump())
    assert r.status_code == 200
    assert client.get(f"/api/rounds/{round_id}").json()["name"] == "herzien"
    assert len(client.get("/api/rounds").json()) == 1


def test_api_put_refuses_to_create(signed_in, sample):
    r = signed_in.put("/api/rounds/nope", json=sample.model_dump())
    assert r.status_code == 404


def test_schema_probe_creates_nothing(postgres_url):
    """The CLI asks before the service has ever connected; asking must not
    itself create the tables, or the asker becomes their owner."""
    import psycopg

    from krantenwijk import db

    with psycopg.connect(postgres_url, autocommit=True) as conn:
        conn.execute("drop database if exists schemaprobe")
        conn.execute("create database schemaprobe")
    fresh = postgres_url.rsplit("/", 1)[0] + "/schemaprobe"
    assert db.schema_present(fresh) is False
    assert db.schema_present(fresh) is False  # still nothing, still not created


def test_schema_present_after_the_service_opened_the_pool(store):
    from krantenwijk import db

    db.pool()
    assert db.schema_present() is True
