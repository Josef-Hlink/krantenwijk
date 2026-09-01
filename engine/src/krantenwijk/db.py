"""Postgres — the one place this engine holds state.

Storage is opt-in, exactly as the rounds directory used to be: with
``KRANTENWIJK_DATABASE_URL`` unset there is no database, no pool, and every
storage-backed endpoint 404s. That is the profile the privacy spine in
DESIGN.md describes, and it stays reachable for anyone self-hosting who wants
the guarantee that nothing can be written at all.

On esther the URL is a unix-socket DSN and there is no password anywhere: the
service runs as a ``DynamicUser`` named ``krantenwijk``, so postgres' ``local
all all peer`` rule lets it in on a name match.
"""

import os
import threading
from pathlib import Path

from psycopg_pool import ConnectionPool

SCHEMA = Path(__file__).parent / "schema.sql"


class StorageDisabled(RuntimeError):
    """No database is configured; this instance stores nothing."""


_lock = threading.Lock()
_pool: ConnectionPool | None = None
_pool_url: str | None = None


def database_url() -> str | None:
    """The configured DSN, or ``None`` when this instance stores nothing."""
    configured = os.environ.get("KRANTENWIJK_DATABASE_URL", "").strip()
    return configured or None


def configured() -> bool:
    return database_url() is not None


def pool() -> ConnectionPool:
    """The process-wide pool, opened on first use and cached by DSN.

    Cached *by DSN* rather than as a plain singleton so a test that points the
    engine at a fresh cluster gets a fresh pool instead of one still holding
    the previous database open.
    """
    global _pool, _pool_url
    url = database_url()
    if url is None:
        raise StorageDisabled(
            "this instance does not store rounds — set KRANTENWIJK_DATABASE_URL "
            "to enable saving"
        )
    with _lock:
        if _pool is not None and _pool_url == url:
            return _pool
        if _pool is not None:
            _pool.close()
            _pool, _pool_url = None, None
        new = ConnectionPool(url, min_size=1, max_size=8, timeout=10.0, open=True)
        try:
            new.wait(timeout=10.0)
            # Idempotent, cheap, and tied to pool creation rather than to app
            # startup — so a TestClient built without a lifespan gets a schema
            # too, and there is exactly one code path that creates tables.
            with new.connection() as conn:
                conn.execute(SCHEMA.read_text(encoding="utf-8"))
        except Exception:
            new.close()
            raise
        _pool, _pool_url = new, url
        return new


def connection():
    """A pooled connection, committed on clean exit of the ``with`` block."""
    return pool().connection()


def reset() -> None:
    """Drop the cached pool. For tests, and for nothing else."""
    global _pool, _pool_url
    with _lock:
        if _pool is not None:
            _pool.close()
        _pool, _pool_url = None, None
