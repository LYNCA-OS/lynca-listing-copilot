-- The Listing Copilot schema exceeds the 30 second cold-cache build budget on
-- the smallest compute tier. Keep request-role limits independent, while the
-- PostgREST control-plane connection receives a bounded two minute ceiling.
alter role authenticator set statement_timeout = '120s';

notify pgrst, 'reload schema';
