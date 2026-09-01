"""Accounts, sessions, and the gate they put in front of saved rounds.

The assertions that matter most here are the negative ones: a guest keeps the
whole planner and reaches no stored round, and there is no way to make an
account over HTTP at all.
"""

import pytest
from fastapi.testclient import TestClient

from krantenwijk import api, auth
from krantenwijk.auth import COOKIE_NAME

# ── passwords ───────────────────────────────────────────────────────────


def test_a_password_survives_a_round_trip(store):
    encoded = auth.hash_password("correct horse battery staple")
    assert auth.verify_password("correct horse battery staple", encoded)
    assert not auth.verify_password("correct horse battery stapl", encoded)


def test_the_hash_is_not_the_password(store):
    encoded = auth.hash_password("hunter2")
    assert "hunter2" not in encoded
    assert encoded.startswith("scrypt$")


def test_the_same_password_hashes_differently_every_time(store):
    """Salted, so two siblings picking the same password are not visibly alike."""
    assert auth.hash_password("zelfde") != auth.hash_password("zelfde")


def test_a_mangled_hash_verifies_false_rather_than_exploding(store):
    for junk in ["", "scrypt$nonsense", "bcrypt$1$2$3$4$5", "$$$$$"]:
        assert auth.verify_password("anything", junk) is False


# ── accounts ────────────────────────────────────────────────────────────


def test_usernames_are_case_folded(store):
    auth.create_user("Josef", "pw")
    assert auth.authenticate("JOSEF", "pw") is not None
    with pytest.raises(auth.UsernameTaken):
        auth.create_user("josef", "another")


def test_authenticate_rejects_a_wrong_password(store, account):
    assert auth.authenticate("josef", "not it") is None


def test_authenticate_rejects_an_unknown_name(store):
    assert auth.authenticate("nobody", "pw") is None


def test_changing_a_password_ends_every_session(store, account):
    token, _ = auth.start_session(account)
    assert auth.resolve_session(token) is not None
    auth.set_password("josef", "nieuw")
    assert auth.resolve_session(token) is None, "a lost phone must lose its session"
    assert auth.authenticate("josef", "nieuw") is not None


# ── sessions ────────────────────────────────────────────────────────────


def test_a_session_resolves_to_its_user(store, account):
    token, _ = auth.start_session(account)
    assert auth.resolve_session(token).username == "josef"


def test_nonsense_and_absent_tokens_resolve_to_nobody(store, account):
    auth.start_session(account)
    assert auth.resolve_session(None) is None
    assert auth.resolve_session("") is None
    assert auth.resolve_session("not-a-real-token") is None


def test_the_raw_token_is_never_stored(store, account):
    """A dump of the sessions table must not be replayable as a login."""
    from krantenwijk import db

    token, _ = auth.start_session(account)
    with db.connection() as conn:
        stored = conn.execute("select token_hash from sessions").fetchall()
    assert all(token.encode() not in bytes(row[0]) for row in stored)


def test_ending_a_session_ends_it(store, account):
    token, _ = auth.start_session(account)
    auth.end_session(token)
    assert auth.resolve_session(token) is None


def test_an_expired_session_is_refused_and_swept(store, account):
    from datetime import UTC, datetime, timedelta

    from krantenwijk import db

    token, _ = auth.start_session(account)
    with db.connection() as conn:
        conn.execute(
            "update sessions set expires_at = %s",
            (datetime.now(UTC) - timedelta(seconds=1),),
        )
    assert auth.resolve_session(token) is None
    assert auth.purge_expired_sessions() == 1


# ── the gate ────────────────────────────────────────────────────────────


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
def test_a_guest_reaches_no_saved_round(client, account, method, path):
    r = client.request(method, path, json={"name": "x"})
    assert r.status_code == 401


def test_a_guest_keeps_the_whole_planner(client, small_points):
    """Accounts gate storage, not the tool. This is the promise on the landing page."""
    points = [{"id": p.id, "lat": p.lat, "lon": p.lon} for p in small_points]
    assert client.post("/api/cluster", json={"points": points}).status_code == 200
    assert (
        client.post(
            "/api/estimate", json={"duration_s": 600, "n_stops": 12}
        ).status_code
        == 200
    )


def test_signing_in_opens_the_drawer(signed_in):
    assert signed_in.get("/api/rounds").status_code == 200


def test_signing_out_closes_it(signed_in):
    assert signed_in.post("/api/logout").status_code == 204
    assert signed_in.get("/api/rounds").status_code == 401


def test_the_session_cookie_is_not_reachable_from_javascript(client, account):
    r = client.post(
        "/api/login",
        json={"username": "josef", "password": "een lang genoeg wachtwoord"},
    )
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "secure" in cookie
    assert "samesite=lax" in cookie


def test_a_wrong_password_is_401_and_sets_nothing(client, account):
    r = client.post("/api/login", json={"username": "josef", "password": "wrong"})
    assert r.status_code == 401
    assert "set-cookie" not in r.headers
    assert COOKIE_NAME not in client.cookies


def test_the_login_error_does_not_say_which_half_was_wrong(client, account):
    unknown = client.post("/api/login", json={"username": "ghost", "password": "x"})
    wrong = client.post("/api/login", json={"username": "josef", "password": "x"})
    assert unknown.json()["detail"] == wrong.json()["detail"]


def test_there_is_no_way_to_make_an_account_over_http(client):
    """Not disabled — absent. Nothing here to accidentally re-enable."""
    paths = [r.path for r in api.create_app().routes]
    assert not any(
        word in p for p in paths for word in ("register", "signup", "users", "account")
    )


# ── status ──────────────────────────────────────────────────────────────


def test_status_tells_a_guest_an_account_would_help(client, account):
    body = client.get("/api/status").json()
    assert body["accounts"] is True, "an account could be used here"
    assert body["rounds"] is False, "but this caller has none"
    assert body["user"] is None


def test_status_tells_a_signed_in_sibling_they_can_save(signed_in):
    body = signed_in.get("/api/status").json()
    assert body["rounds"] is True
    assert body["user"] == "josef"


def test_an_instance_with_no_database_offers_no_login(disabled):
    client = TestClient(api.create_app())
    body = client.get("/api/status").json()
    assert body["accounts"] is False and body["rounds"] is False
    r = client.post("/api/login", json={"username": "josef", "password": "pw"})
    assert r.status_code == 404
