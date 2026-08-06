# Active service context

The machine-readable source of truth is
[`active-service-context.json`](./active-service-context.json). Run:

```sh
node scripts/verify-active-service-context.mjs
```

before a Linear mutation, Vercel deployment, Supabase migration, or live CSM
trace. The verifier is local and prints no secret values.

- Linear is read live through the bundled app. Acceptance-complete COS issues
  must be `Done` before push, PR, merge, or Production deployment.
- Vercel Production is
  `lyncafei-s-projects/lynca-listing-copilot` and may deploy only from the
  clean production checkout. The capacity lab remains Preview-only.
- Supabase migrations use only
  `infrastructure/supabase-production`, whose ledger is fetched from remote.
  The repository-level `supabase/migrations` directory is frozen historical
  contract material and is deliberately unlinked.
- The former project ref `osrrujmpxxiefppjfgpd` (Sydney) is decommissioned and
  its hostname no longer resolves. A reference to it anywhere is stale
  configuration, not a network fault -- do not retry, repoint.
- Secrets live in the mode-0600 canonical runtime env file. No key value is
  stored in this context document or printed by the verifier.
- Cloud Run, vector retrieval, and the generic OCR sidecar are retired and are
  not fallback paths for the CSM thin chain.
