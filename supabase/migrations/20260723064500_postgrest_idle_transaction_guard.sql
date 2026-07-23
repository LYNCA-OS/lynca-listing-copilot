-- Client-side request deadlines can abandon a PostgREST response after the
-- database transaction has started. Without a server-side idle transaction
-- deadline those sessions retain pool capacity indefinitely and amplify a
-- single slow request into tenant-wide enqueue/authentication failures.
--
-- Keep the existing managed statement_timeout and lock_timeout values. This
-- guard only reclaims transactions whose client is no longer consuming the
-- response; ordinary pooled idle connections remain reusable.
alter role authenticator set idle_in_transaction_session_timeout = '30s';
