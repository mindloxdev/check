#!/usr/bin/env bash
#
# Runs the database behaviour suite against a throwaway Postgres container.
#
#     bash scripts/db-test.sh
#
# This needs only Docker — not the Supabase CLI — because it stands up a plain
# Postgres and supplies a minimal `auth` schema shim (auth.users + auth.uid())
# matching what Supabase provides. That is enough to exercise every migration,
# constraint, trigger and RLS policy in the repo.
set -euo pipefail

CONTAINER="${CONTAINER:-oat-pg-test}"
IMAGE="${IMAGE:-postgres:16-alpine}"
DB=oat_test
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Docker paths must not be mangled by Git Bash on Windows.
export MSYS_NO_PATHCONV=1

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Starting $IMAGE as $CONTAINER..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB="$DB" "$IMAGE" >/dev/null

for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc "select 1" >/dev/null 2>&1; then
    break
  fi
done
docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc "select 1" >/dev/null

echo "Applying the auth shim..."
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid, aud text, role text,
  email text unique, encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  ), '')::uuid
$$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;
SQL

# SQL is piped in on stdin rather than copied with `docker cp`, which keeps the
# script free of host-path translation problems (Git Bash on Windows rewrites
# /tmp/... into C:	mp\..., and disabling that breaks the source side instead).
echo "Applying migrations..."
for file in "$HERE"/supabase/migrations/*.sql; do
  echo "  $(basename "$file")"
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q < "$file"
done

echo "Running behaviour checks..."
docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q   < "$HERE/supabase/tests/behaviour_check.sql"

echo
echo "Database suite passed."
