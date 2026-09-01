"""Accounts and sessions — the gate in front of saved rounds.

Everything else the engine serves is open: guests upload a CSV, draw buckets,
route them and export the ordering, and none of it is stored. Accounts exist
for the one thing that is: a saved round carries addresses and resident names,
and `/go` walks it on a phone.

There is no sign-up. Accounts are made with ``krantenwijk useradd`` by someone
with a shell on the box, and the router has no registration endpoint at all —
absent, not disabled, so there is nothing to accidentally re-enable.

The three accounts share one drawer. Everyone who can sign in sees every saved
round, because they are three siblings splitting one round between them; this
is authentication, not authorization, and there is deliberately no per-user
ownership to get wrong.
"""

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from pydantic import BaseModel

from . import db

# scrypt, from the standard library — no dependency, and a perfectly good
# password hash. n=2^16 puts a single guess at roughly a tenth of a second,
# which is the throttle that matters on a login form open to the internet;
# three siblings signing in a handful of times a year will never feel it.
# maxmem is headroom over the 64 MiB these parameters need, because OpenSSL's
# default ceiling sits below that and simply refuses.
SCRYPT_N = 2**16
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAXMEM = 192 * 1024 * 1024

SESSION_TTL = timedelta(days=90)
# Renewed only in the last third of its life, so a walk does not write a row
# on every request — but a phone used through the autumn never sees a login.
SESSION_RENEW_UNDER = timedelta(days=30)

COOKIE_NAME = "krantenwijk_session"


class User(BaseModel):
    id: int
    username: str


class UsernameTaken(ValueError):
    """That username already has an account."""


class NoSuchUser(LookupError):
    """No account by that name."""


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=SCRYPT_MAXMEM,
        dklen=32,
    )
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    """Check a password against a stored hash, in constant time."""
    try:
        scheme, n, r, p, salt_hex, digest_hex = encoded.split("$")
        if scheme != "scrypt":
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=SCRYPT_MAXMEM,
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


# Burned when the username is unknown, so a wrong name and a wrong password
# cost the same wall-clock time and the form cannot be used to enumerate the
# three accounts.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def create_user(username: str, password: str) -> User:
    username = username.strip().lower()
    if not username:
        raise ValueError("a username cannot be blank")
    with db.connection() as conn:
        existing = conn.execute(
            "select 1 from users where username = %s", (username,)
        ).fetchone()
        if existing:
            raise UsernameTaken(f"{username!r} already has an account")
        row = conn.execute(
            "insert into users (username, password_hash) values (%s, %s) "
            "returning id, username",
            (username, hash_password(password)),
        ).fetchone()
    return User(id=row[0], username=row[1])


def set_password(username: str, password: str) -> None:
    with db.connection() as conn:
        updated = conn.execute(
            "update users set password_hash = %s where username = %s",
            (hash_password(password), username.strip().lower()),
        ).rowcount
        if not updated:
            raise NoSuchUser(f"no account {username!r}")
        # Every session of theirs dies with the old password: changing it is
        # how you get a lost phone off the round.
        conn.execute(
            "delete from sessions where user_id = "
            "(select id from users where username = %s)",
            (username.strip().lower(),),
        )


def list_users() -> list[User]:
    with db.connection() as conn:
        rows = conn.execute(
            "select id, username from users order by username"
        ).fetchall()
    return [User(id=i, username=u) for i, u in rows]


def authenticate(username: str, password: str) -> User | None:
    """The account for these credentials, or ``None``."""
    with db.connection() as conn:
        row = conn.execute(
            "select id, username, password_hash from users where username = %s",
            (username.strip().lower(),),
        ).fetchone()
    if row is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if not verify_password(password, row[2]):
        return None
    return User(id=row[0], username=row[1])


def _token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode("utf-8")).digest()


def start_session(user: User) -> tuple[str, datetime]:
    """Open a session. Returns the raw cookie value and when it expires."""
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + SESSION_TTL
    with db.connection() as conn:
        conn.execute(
            "insert into sessions (token_hash, user_id, expires_at) "
            "values (%s, %s, %s)",
            (_token_hash(token), user.id, expires_at),
        )
    return token, expires_at


def resolve_session(token: str | None) -> User | None:
    """Whoever holds this cookie, or ``None``. Renews a session nearing its end."""
    if not token:
        return None
    now = datetime.now(UTC)
    with db.connection() as conn:
        row = conn.execute(
            "select u.id, u.username, s.expires_at from sessions s "
            "join users u on u.id = s.user_id "
            "where s.token_hash = %s and s.expires_at > %s",
            (_token_hash(token), now),
        ).fetchone()
        if row is None:
            return None
        if row[2] - now < SESSION_RENEW_UNDER:
            conn.execute(
                "update sessions set expires_at = %s where token_hash = %s",
                (now + SESSION_TTL, _token_hash(token)),
            )
    return User(id=row[0], username=row[1])


def end_session(token: str | None) -> None:
    if not token:
        return
    with db.connection() as conn:
        conn.execute(
            "delete from sessions where token_hash = %s", (_token_hash(token),)
        )


def purge_expired_sessions() -> int:
    """Sweep dead rows. Nothing depends on it; expiry is enforced on read."""
    with db.connection() as conn:
        return conn.execute(
            "delete from sessions where expires_at <= %s", (datetime.now(UTC),)
        ).rowcount
