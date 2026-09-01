"""Shared fixtures — offline only, no network ever.

The committed demo CSV (real Vlissingen addresses, fictional round) doubles
as the realistic fixture set; tests validate the artifact we actually ship.

The storage tests run against a real postgres — a throwaway cluster initdb'd
into a tmpdir, torn down at the end of the session. Faking the database would
only test the fake: the behaviour that matters here (an upsert, a jsonb count,
two carriers writing disjoint rows) *is* the SQL.
"""

import csv
import shutil
import socket
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from krantenwijk import api, auth, db
from krantenwijk.models import AddressRecord, Point

ACCOUNT = ("josef", "een lang genoeg wachtwoord")

DEMO_CSV = Path(__file__).parents[2] / "web" / "static" / "sample" / "vlissingen.csv"


@pytest.fixture(scope="session")
def records() -> list[AddressRecord]:
    with DEMO_CSV.open(encoding="utf-8") as f:
        return [
            AddressRecord(
                id=row["id"],
                street=row["straat"],
                house_number=row["huisnr"],
                postcode=row["postcode"] or None,
                city=row["plaats"] or None,
                lat=float(row["lat"]),
                lon=float(row["lon"]),
                category=row["soort"] or None,
            )
            for row in csv.DictReader(f)
        ]


@pytest.fixture(scope="session")
def points(records) -> list[Point]:
    return [Point(id=r.id, lat=r.lat, lon=r.lon) for r in records]


@pytest.fixture(scope="session")
def small_points(points) -> list[Point]:
    """A routable handful."""
    return points[:12]


# ── a throwaway postgres ─────────────────────────────────────────────────


def _run(cmd: list[str], what: str) -> None:
    """Run a cluster command, surfacing postgres' own words when it refuses.

    Worth the wrapper: the failure people actually hit is a *stale devShell*,
    where PATH still finds a system postgres that cannot initdb. Raw
    CalledProcessError hides the reason behind a wall of subprocess source.
    """
    done = subprocess.run(cmd, capture_output=True, text=True)
    if done.returncode != 0:
        pytest.fail(
            f"could not {what} the test cluster using {cmd[0]}\n"
            f"{(done.stderr or done.stdout).strip()}\n\n"
            "If that binary is not the one from the devShell, run "
            "`direnv reload` — postgres is pinned in flake.nix.",
            pytrace=False,
        )


def _free_port() -> int:
    """A port the cluster can have to itself, chosen by the kernel."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture(scope="session")
def postgres_url(tmp_path_factory) -> str:
    """A running cluster with an empty database, gone when the session ends."""
    initdb, pg_ctl, createdb = (
        shutil.which("initdb"),
        shutil.which("pg_ctl"),
        shutil.which("createdb"),
    )
    if not (initdb and pg_ctl and createdb):
        pytest.skip("postgres not on PATH — it comes from the nix devShell")

    datadir = tmp_path_factory.mktemp("pgdata")
    port = _free_port()
    _run(
        # Trust auth and the C locale: this cluster lives for one test run,
        # reachable only on loopback. esther's collation is pinned separately.
        [
            initdb,
            "-D",
            str(datadir),
            "-A",
            "trust",
            "-U",
            "krantenwijk",
            "--encoding=UTF8",
            "--locale=C",
        ],
        "initdb",
    )
    # No unix socket at all: a macOS tmpdir path is long enough to blow the
    # 104-char sockaddr limit, and TCP on loopback sidesteps the question.
    # fsync off because losing this cluster to a crash costs nothing.
    options = (
        f"-p {port} -h 127.0.0.1 -c unix_socket_directories= "
        f"-c fsync=off -c full_page_writes=off"
    )
    _run(
        [
            pg_ctl,
            "-D",
            str(datadir),
            "-o",
            options,
            "-l",
            str(datadir / "log"),
            "-w",
            "start",
        ],
        "start",
    )
    try:
        _run(
            [
                createdb,
                "-h",
                "127.0.0.1",
                "-p",
                str(port),
                "-U",
                "krantenwijk",
                "krantenwijk",
            ],
            "create a database in",
        )
        yield f"postgresql://krantenwijk@127.0.0.1:{port}/krantenwijk"
    finally:
        subprocess.run(
            [pg_ctl, "-D", str(datadir), "-m", "immediate", "-w", "stop"],
            capture_output=True,
        )
        db.reset()


@pytest.fixture
def store(postgres_url, monkeypatch):
    """Point the engine at the cluster, with every table empty."""
    monkeypatch.setenv("KRANTENWIJK_DATABASE_URL", postgres_url)
    with db.connection() as conn:  # creates the pool and applies the schema
        conn.execute("truncate rounds, users, sessions cascade")
    return postgres_url


@pytest.fixture
def account(store) -> auth.User:
    """The one hand-made account the API tests sign in as."""
    return auth.create_user(*ACCOUNT)


@pytest.fixture
def client(store) -> TestClient:
    """A guest: the planner works, saved rounds do not.

    Served over https because the session cookie is Secure — an http client
    would drop it on the floor and every signed-in test would read as a 401.
    """
    return TestClient(api.create_app(), base_url="https://testserver")


@pytest.fixture
def signed_in(client, account) -> TestClient:
    """A sibling with an account, holding a session cookie."""
    username, password = ACCOUNT
    r = client.post("/api/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def disabled(monkeypatch):
    """An instance with no database: the profile that stores nothing."""
    monkeypatch.delenv("KRANTENWIJK_DATABASE_URL", raising=False)
