# Active service context

The machine-readable source of truth is
[`active-service-context.json`](./active-service-context.json). Run:

```sh
node scripts/verify-active-service-context.mjs
```

before any Linear mutation, Vercel deployment, Supabase migration, or live CSM
trace. The check is local and prints no secret values.

Operational boundaries:

- Linear uses the bundled app and the live LYNCA `Admins` issue state. Local
  notes are never an update source.
- Vercel production is `lyncafei-s-projects/lynca-listing-copilot`. Capacity
  experiments run only from the exact capacity-lab directory and target
  Preview. The personal Hobby scope is forbidden.
- Supabase is project ref `osrrujmpxxiefppjfgpd`; migrations live only under
  `supabase/migrations`. The ignored local link and `.env.local` must agree with
  the pinned ref before remote work.
- Cloud Run, vector retrieval, and the generic OCR sidecar are not fallback
  paths for the current thin chain.
