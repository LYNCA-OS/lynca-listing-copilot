# Independent 150-card acquisition gate

The current reviewed blind pool has 255 cards: 150 were used for development and only 105 remain outside that development set. A fresh response over a mixed 150 is useful stability evidence, but it is not an independent-card confirmation.

Before any accuracy mechanism can be promoted, a new dataset must pass `scripts/verify-independent-accuracy-cohort.mjs` with 150 unique cards that:

- have no asset-id overlap with the development cohort;
- keep the corrected title and derived fields blind during recognition;
- carry a sealed reviewed-label reference; and
- have at least one materializable original image (Supabase bucket/object path or a real local file).

The gate intentionally fails on fixture-only paths, visible labels, missing sealed references, duplicate ids, and any development overlap. Until it passes, candidate mechanisms remain evaluation-only and production stays on the deployed canonical thin path.
