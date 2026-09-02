"""Delivery marks — which doors have had their card, across every phone.

This is the table the move to postgres was for. Three siblings walk one round
at the same time, each on their own phone, and the marks have to survive a
walk that starts in signal, crosses a dead patch, and finishes an hour later.

Two properties carry the whole design:

**Disjoint rows.** The key is (round, door). Carrier A on bucket 3 and carrier
B on bucket 4 write different rows, so postgres' row-level locking means they
never block and never overwrite each other. There is no application lock here,
and there does not need to be one.

**Idempotent, order-insensitive writes.** A mark carries the moment it was
made, and a later mark wins; an older one is ignored. So a phone coming out of
a tunnel can replay its entire outbox without checking what got through, and
without a stale tap undoing something newer.
"""

from datetime import UTC, datetime

from pydantic import BaseModel

from . import db


class Mark(BaseModel):
    """One tap, as a phone reports it."""

    stop_id: str
    bucket_id: str
    delivered: bool
    marked_at: datetime


class Delivery(BaseModel):
    """One door's standing state, as everyone's phone should see it."""

    stop_id: str
    bucket_id: str
    delivered: bool
    marked_at: datetime
    by: str | None = None


def list_for_round(round_id: str) -> list[Delivery]:
    """Every mark on the round — all buckets, not just your own.

    Seeing the whole round advance is the point of sharing it; a carrier who
    finishes early should be able to tell where everyone else is.
    """
    with db.connection() as conn:
        rows = conn.execute(
            """
            select d.stop_id, d.bucket_id, d.delivered, d.marked_at, u.username
            from deliveries d
            left join users u on u.id = d.by_user
            where d.round_id = %s
            order by d.marked_at
            """,
            (round_id,),
        ).fetchall()
    return [
        Delivery(stop_id=s, bucket_id=b, delivered=d, marked_at=m, by=who)
        for s, b, d, m, who in rows
    ]


def record(
    round_id: str, marks: list[Mark], by_user: int | None = None
) -> list[Delivery]:
    """Apply a batch of marks, newest-per-door winning. Returns the round's state.

    Batched rather than one request per tap: the outbox drains as a unit, which
    is far kinder to a phone with one bar of signal.
    """
    if marks:
        now = datetime.now(UTC)
        params = [
            (
                round_id,
                m.stop_id,
                m.bucket_id,
                m.delivered,
                # A phone whose clock runs fast would otherwise pin its door
                # forever, since nothing later could ever beat it.
                min(m.marked_at.astimezone(UTC), now),
                by_user,
            )
            for m in marks
        ]
        with db.connection() as conn, conn.cursor() as cur:
            cur.executemany(
                """
                insert into deliveries
                    (round_id, stop_id, bucket_id, delivered, marked_at, by_user)
                values (%s, %s, %s, %s, %s, %s)
                on conflict (round_id, stop_id) do update
                   set bucket_id = excluded.bucket_id,
                       delivered = excluded.delivered,
                       marked_at = excluded.marked_at,
                       synced_at = now(),
                       by_user   = excluded.by_user
                 where excluded.marked_at > deliveries.marked_at
                """,
                params,
            )
    return list_for_round(round_id)


def clear_bucket(round_id: str, bucket_id: str) -> int:
    """Wipe one bucket's marks — 'start this bucket over'.

    A delete rather than a batch of false marks: resetting is a deliberate
    act at a known moment, not something a stale queue should be able to redo.
    """
    with db.connection() as conn:
        return conn.execute(
            "delete from deliveries where round_id = %s and bucket_id = %s",
            (round_id, bucket_id),
        ).rowcount
