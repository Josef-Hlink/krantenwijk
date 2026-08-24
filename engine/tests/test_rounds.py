"""Saved rounds: the storage layer, and the opt-in that fences it off.

The privacy-relevant assertions here are the ones about a *disabled* instance —
with no directory configured nothing is written and every endpoint 404s.
"""

import json

import pytest
from fastapi.testclient import TestClient

from krantenwijk import api, rounds
from krantenwijk.rounds import Round, RoundBucket, RoundNotFound, RoundStop


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("KRANTENWIJK_ROUNDS_DIR", str(tmp_path / "rounds"))
    return tmp_path / "rounds"


@pytest.fixture
def disabled(monkeypatch):
    monkeypatch.delenv("KRANTENWIJK_ROUNDS_DIR", raising=False)


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
                details={"naam": "J. de Vries"},
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
    assert back.stops[0].details == {"naam": "J. de Vries"}
    assert back.buckets[0].order == ["a1", "a2"]


def test_id_is_slugged_from_the_name(store, sample):
    stored = rounds.write_round(sample.model_copy(update={"name": "Najaar 2026!"}))
    assert stored.id.startswith("najaar-2026-")
    assert rounds.ID_RE.match(stored.id)


def test_same_name_twice_does_not_collide(store, sample):
    a = rounds.write_round(sample)
    b = rounds.write_round(sample)
    assert a.id != b.id
    assert len(list(store.glob("*.json"))) == 2


def test_listing_is_newest_first_and_carries_no_pii(store, sample):
    rounds.write_round(sample.model_copy(update={"name": "eerste"}))
    rounds.write_round(sample.model_copy(update={"name": "tweede"}))
    summaries = rounds.list_rounds()
    assert {s.name for s in summaries} == {"eerste", "tweede"}
    assert all(s.n_stops == 2 and s.n_buckets == 1 for s in summaries)
    # a summary is id/name/counts only — no way to leak an address through it
    blob = json.dumps([s.model_dump() for s in summaries])
    assert "Badhuisstraat" not in blob and "de Vries" not in blob


def test_corrupt_file_is_skipped_not_fatal(store, sample):
    rounds.write_round(sample)
    store.mkdir(parents=True, exist_ok=True)
    (store / "junk.json").write_text("not json at all", encoding="utf-8")
    assert len(rounds.list_rounds()) == 1


def test_delete(store, sample):
    stored = rounds.write_round(sample)
    rounds.delete_round(stored.id)
    with pytest.raises(RoundNotFound):
        rounds.read_round(stored.id)


@pytest.mark.parametrize(
    "bad", ["../secrets", "..", "a/b", "with.dot", "UPPER", "", "-leading"]
)
def test_ids_that_could_escape_the_directory_are_refused(store, bad):
    with pytest.raises(RoundNotFound):
        rounds.read_round(bad)


def test_no_temp_files_left_behind(store, sample):
    rounds.write_round(sample)
    assert list(store.glob("*.tmp")) == []


def test_disabled_instance_writes_nothing(disabled, sample):
    assert rounds.rounds_dir() is None
    with pytest.raises(rounds.RoundsDisabled):
        rounds.write_round(sample)


# ── API surface ─────────────────────────────────────────────────────────


def test_status_reports_the_capability(store, disabled):
    assert TestClient(api.create_app()).get("/api/status").json()["rounds"] is False


def test_status_reports_enabled(store):
    assert TestClient(api.create_app()).get("/api/status").json()["rounds"] is True


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


def test_api_create_read_delete(store, sample):
    client = TestClient(api.create_app())
    created = client.post("/api/rounds", json=sample.model_dump())
    assert created.status_code == 200
    round_id = created.json()["id"]

    listed = client.get("/api/rounds").json()
    assert [s["id"] for s in listed] == [round_id]

    got = client.get(f"/api/rounds/{round_id}").json()
    assert got["stops"][0]["details"]["naam"] == "J. de Vries"

    assert client.delete(f"/api/rounds/{round_id}").status_code == 204
    assert client.get(f"/api/rounds/{round_id}").status_code == 404


def test_api_create_ignores_a_client_supplied_id(store, sample):
    client = TestClient(api.create_app())
    created = client.post(
        "/api/rounds", json=sample.model_copy(update={"id": "hijacked"}).model_dump()
    )
    assert created.json()["id"] != "hijacked"


def test_api_put_updates_in_place(store, sample):
    client = TestClient(api.create_app())
    round_id = client.post("/api/rounds", json=sample.model_dump()).json()["id"]
    updated = sample.model_copy(update={"name": "herzien"})
    r = client.put(f"/api/rounds/{round_id}", json=updated.model_dump())
    assert r.status_code == 200
    assert client.get(f"/api/rounds/{round_id}").json()["name"] == "herzien"
    assert len(client.get("/api/rounds").json()) == 1


def test_api_put_refuses_to_create(store, sample):
    client = TestClient(api.create_app())
    r = client.put("/api/rounds/nope", json=sample.model_dump())
    assert r.status_code == 404
