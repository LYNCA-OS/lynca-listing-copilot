-- PostgREST builds its schema cache while connected as `authenticator`.
-- An 8 second role-wide statement timeout can abort that metadata query and
-- leave the REST API returning PGRST002 before any business query runs.
-- Keep request limits on the request roles (`anon` / `authenticated`) and
-- leave enough bounded headroom for PostgREST control-plane work.
alter role authenticator set statement_timeout = '30s';

notify pgrst, 'reload schema';
