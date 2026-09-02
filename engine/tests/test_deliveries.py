"""Delivery marks: what three phones do to one round at the same time.

The headline assertion is `test_two_carriers_on_different_buckets_do_not_interfere`
— the requirement the whole move to postgres was for. It runs two real
connections concurrently rather than trusting the schema by eye.
"""

import threading
from datetime import UTC, datetime, timedelta

import pytest

from krantenwijk import db, deliveries, rounds
from krantenwijk.deliveries import Mark
from krantenwijk.rounds import Round, RoundBucket, RoundStop

# Anchored in the recent past, not on a fixed autumn morning: a mark dated in
# the future is deliberately clamped to now (see deliveries.record), which
# would flatten every timestamp in here and make the ordering tests vacuous.
NOW = datetime.now(UTC) - timedelta(hours=3)


def at(minutes: int) -> datetime:
    return NOW + timedelta(minutes=minutes)


@pytest.fixture
def round_id(store) -> str:
    """A round with two buckets of three doors each — A walks one, B the other."""
    saved = rounds.write_round(
        Round(
            name="najaar",
            stops=[
                RoundStop(id=f"d{i}", lat=51.44 + i / 1000, lon=3.57) for i in range(6)
            ],
            buckets=[
                RoundBucket(
                    id="b3", name="bucket 3", color="#1f6feb", order=["d0", "d1", "d2"]
                ),
                RoundBucket(
                    id="b4", name="bucket 4", color="#a34", order=["d3", "d4", "d5"]
                ),
            ],
        )
    )
    return saved.id


def mark(stop: str, bucket: str, when: datetime, delivered: bool = True) -> Mark:
    return Mark(stop_id=stop, bucket_id=bucket, delivered=delivered, marked_at=when)


def state(round_id: str) -> dict[str, bool]:
    return {d.stop_id: d.delivered for d in deliveries.list_for_round(round_id)}


# ── the requirement ─────────────────────────────────────────────────────


def test_two_carriers_on_different_buckets_do_not_interfere(round_id, account):
    """Carrier A walks bucket 3 while carrier B walks bucket 4, at the same time.

    Both sets of marks must survive in full. This is the failure the JSON file
    had — a shared blob, read-modify-written, last writer winning — and the
    reason a door is a row.
    """
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def walk(bucket: str, stops: list[str]) -> None:
        try:
            barrier.wait(timeout=10)  # push both into the same instant
            for i, stop in enumerate(stops):
                deliveries.record(round_id, [mark(stop, bucket, at(i))], account.id)
        except BaseException as e:  # noqa: BLE001 - re-raised on the main thread
            errors.append(e)

    a = threading.Thread(target=walk, args=("b3", ["d0", "d1", "d2"]))
    b = threading.Thread(target=walk, args=("b4", ["d3", "d4", "d5"]))
    a.start(), b.start()
    a.join(timeout=30), b.join(timeout=30)

    assert not errors, errors
    assert state(round_id) == {f"d{i}": True for i in range(6)}, (
        "a carrier's marks were lost to the other's"
    )


def test_both_carriers_see_the_whole_round(round_id, account):
    """Not just your own bucket: everyone can tell where everyone else is."""
    deliveries.record(round_id, [mark("d0", "b3", at(0))], account.id)
    deliveries.record(round_id, [mark("d3", "b4", at(1))], account.id)
    buckets = {d.stop_id: d.bucket_id for d in deliveries.list_for_round(round_id)}
    assert buckets == {"d0": "b3", "d3": "b4"}


# ── replay, undo, and clocks ────────────────────────────────────────────


def test_replaying_the_same_marks_changes_nothing(round_id, account):
    """A phone out of signal replays its whole outbox without checking."""
    batch = [mark("d0", "b3", at(0)), mark("d1", "b3", at(1))]
    first = deliveries.record(round_id, batch, account.id)
    again = deliveries.record(round_id, batch, account.id)
    assert [d.model_dump() for d in first] == [d.model_dump() for d in again]


def test_a_door_can_be_undelivered(round_id, account):
    deliveries.record(round_id, [mark("d0", "b3", at(0))], account.id)
    deliveries.record(round_id, [mark("d0", "b3", at(1), delivered=False)], account.id)
    assert state(round_id) == {"d0": False}


def test_a_stale_mark_cannot_resurrect_a_cleared_door(round_id, account):
    """The queued tap arrives after the undo it predates. The undo stands."""
    deliveries.record(round_id, [mark("d0", "b3", at(5), delivered=False)], account.id)
    deliveries.record(round_id, [mark("d0", "b3", at(1), delivered=True)], account.id)
    assert state(round_id) == {"d0": False}


def test_marks_arriving_out_of_order_settle_on_the_newest(round_id, account):
    deliveries.record(round_id, [mark("d0", "b3", at(9))], account.id)
    deliveries.record(round_id, [mark("d0", "b3", at(2), delivered=False)], account.id)
    deliveries.record(round_id, [mark("d0", "b3", at(4), delivered=False)], account.id)
    assert state(round_id) == {"d0": True}


def test_a_phone_with_a_fast_clock_cannot_pin_a_door(round_id, account):
    """Clamped to now, or nothing later could ever beat it."""
    next_year = datetime.now(UTC) + timedelta(days=365)
    deliveries.record(round_id, [mark("d0", "b3", next_year)], account.id)
    deliveries.record(
        round_id,
        [mark("d0", "b3", datetime.now(UTC), delivered=False)],
        account.id,
    )
    assert state(round_id) == {"d0": False}


def test_who_marked_it_is_recorded(round_id, account):
    deliveries.record(round_id, [mark("d0", "b3", at(0))], account.id)
    assert deliveries.list_for_round(round_id)[0].by == "josef"


# ── clearing ────────────────────────────────────────────────────────────


def test_clearing_a_bucket_leaves_the_other_alone(round_id, account):
    deliveries.record(
        round_id,
        [mark("d0", "b3", at(0)), mark("d3", "b4", at(1))],
        account.id,
    )
    assert deliveries.clear_bucket(round_id, "b3") == 1
    assert state(round_id) == {"d3": True}


def test_deleting_a_round_takes_its_marks_with_it(round_id, account):
    deliveries.record(round_id, [mark("d0", "b3", at(0))], account.id)
    rounds.delete_round(round_id)
    with db.connection() as conn:
        left = conn.execute("select count(*) from deliveries").fetchone()[0]
    assert left == 0


# ── the API surface ─────────────────────────────────────────────────────


def test_api_round_trip(signed_in, round_id):
    body = {
        "marks": [
            {
                "stop_id": "d0",
                "bucket_id": "b3",
                "delivered": True,
                "marked_at": at(0).isoformat(),
            }
        ]
    }
    posted = signed_in.post(f"/api/rounds/{round_id}/deliveries", json=body)
    assert posted.status_code == 200
    assert posted.json()[0]["stop_id"] == "d0"

    got = signed_in.get(f"/api/rounds/{round_id}/deliveries").json()
    assert [d["stop_id"] for d in got] == ["d0"]

    cleared = signed_in.delete(f"/api/rounds/{round_id}/deliveries?bucket_id=b3")
    assert cleared.status_code == 204
    assert signed_in.get(f"/api/rounds/{round_id}/deliveries").json() == []


def test_api_empty_batch_is_a_read(signed_in, round_id):
    """The phone that has nothing queued still wants everyone else's progress."""
    r = signed_in.post(f"/api/rounds/{round_id}/deliveries", json={"marks": []})
    assert r.status_code == 200 and r.json() == []


def test_api_unknown_round_is_404(signed_in):
    assert signed_in.get("/api/rounds/geen-ronde-abc123/deliveries").status_code == 404


@pytest.mark.parametrize("method", ["get", "post", "delete"])
def test_a_guest_reaches_no_marks(client, round_id, method):
    r = client.request(
        method,
        f"/api/rounds/{round_id}/deliveries?bucket_id=b3",
        json={"marks": []},
    )
    assert r.status_code == 401
