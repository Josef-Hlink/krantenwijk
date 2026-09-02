-- krantenwijk schema. Applied on first connection, every time.
--
-- Deliberately `if not exists` and nothing else: there is no migration
-- machinery here and no versioning, because nothing is in production and no
-- real round has ever been stored. Reshape this file freely until the day
-- that stops being true — then, and only then, bring in a migration tool.

create table if not exists rounds (
  id       text primary key,
  name     text not null,
  saved_at timestamptz not null,
  -- The whole Round model, verbatim. A round is written once, by one person
  -- at a desk, and read whole — there is nothing to gain from shredding it
  -- into tables, and the pydantic model stays the single source of shape.
  payload  jsonb not null
);

create index if not exists rounds_saved_at_idx on rounds (saved_at desc);

-- Three accounts, made by hand with `krantenwijk useradd`. There is no
-- registration endpoint anywhere in the router — absent, not disabled — so
-- this table only ever grows when someone with a shell says so.
create table if not exists users (
  id            serial primary key,
  username      text not null unique,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- A session is the cookie's sha256, never the cookie itself: a stolen dump of
-- this table cannot be replayed as a login.
create table if not exists sessions (
  token_hash bytea primary key,
  user_id    integer not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id);

-- Delivery marks: one row per door, which is the whole point.
--
-- Three phones walk one round at the same time. If progress lived inside the
-- round's payload they would read-modify-write a shared blob and silently
-- erase each other; as rows keyed by the door, carrier A on bucket 3 and
-- carrier B on bucket 4 touch disjoint sets and never contend at all.
--
-- `delivered` is a column rather than the row's existence because undo is
-- real, and `marked_at` (the client's clock) decides who wins: a phone that
-- has been out of signal can replay its whole queue blindly without
-- resurrecting a door someone deliberately cleared.
create table if not exists deliveries (
  round_id  text not null references rounds (id) on delete cascade,
  stop_id   text not null,
  bucket_id text not null,
  delivered boolean not null,
  marked_at timestamptz not null,
  synced_at timestamptz not null default now(),
  by_user   integer references users (id) on delete set null,
  primary key (round_id, stop_id)
);

create index if not exists deliveries_bucket_idx on deliveries (round_id, bucket_id);
