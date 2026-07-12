-- Direct database migrations and PostgREST schema discovery are separate
-- control planes. Refresh explicitly so a newly deployed queue RPC is visible
-- to workers before the first production job arrives.
notify pgrst, 'reload schema';
