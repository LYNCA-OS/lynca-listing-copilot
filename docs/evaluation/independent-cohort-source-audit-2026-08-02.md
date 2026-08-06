# Independent accuracy cohort source audit — 2026-08-02

## Read-only result

The Supabase project was queried through the existing service credential without
writing or exporting row contents:

| Source | Rows | Latest timestamp | Can supply sealed independent GT? |
|---|---:|---|---|
| `listing_title_feedback` | 358 | 2026-06-29 | No new rows beyond the existing pool |
| `listing_reviews` | 0 | — | No |
| `v4_writer_feedback_events` | 30 | 2026-08-01 | No; writer/admin events are not sealed reviewed labels |

The existing reviewed blind pool remains 255 materializable card images: 150
are already in the development cohort and only 105 are outside it. The 30
writer events must remain `OBSERVE_ONLY` / `ADMIN_TEST_ONLY`; treating them as
labels would contaminate the independent gate.

## Stop condition

Do not spend another paid 150-card confirmation against the same 255-card pool.
No replay, remixed 150, or writer-event promotion can create independent-card
evidence. Acquire at least 150 new label-blind cards with sealed reviewed
references and materializable originals, then run
`scripts/verify-independent-accuracy-cohort.mjs` before paying for the
candidate bundle.

The candidate interaction replay remains useful evidence (`13 / 0 / 137`,
`+0.007446` F1), but this source audit keeps it evaluation-only until the
cohort boundary is satisfied.
