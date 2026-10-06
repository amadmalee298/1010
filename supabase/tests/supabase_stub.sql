-- Minimal stand-in for the Supabase platform pieces our migrations depend on.
-- Used ONLY by the local test harness (scripts/test-db.ts); never deployed.
-- Roles are cluster-wide and test files create databases in parallel, so a plain
-- "if not exists" check can race; tolerate a concurrent creation instead.
do $$ begin create role anon nologin; exception when duplicate_object or unique_violation then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object or unique_violation then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Supabase's default privileges (which our migration must neutralise)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
