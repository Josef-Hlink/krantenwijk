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
