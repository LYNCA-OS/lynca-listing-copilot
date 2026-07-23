-- Listing Copilot does not use PostgREST's per-request `Prefer: timezone=...`
-- feature. Disabling it removes `SELECT name FROM pg_timezone_names` from the
-- schema-cache build, which can monopolize the smallest compute tier.
alter role authenticator set pgrst.db_timezone_enabled = 'false';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
