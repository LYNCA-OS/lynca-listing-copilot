-- Manual recovery tool for the small production compute tier. This does not
-- schedule recurring reads; operators explicitly warm the bounded hot set
-- after a cold database/service restart.
create extension if not exists pg_prewarm with schema extensions;
