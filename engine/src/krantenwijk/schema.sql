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
