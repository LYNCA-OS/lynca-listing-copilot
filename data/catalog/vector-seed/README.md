# Vector seed: writer-reviewed feedback cards

`feedback-writer-gt-seed-dataset.json` contains 255 cards / 509 images from
`listing_title_feedback` (writer-reviewed corrected titles = internal GT).
These are our own uploaded photos with trusted identities - the correct seed
source per policy (no scraped marketplace image libraries).

## Why

eBay C10 showed the vector lane returning noise: only 138 embeddings existed
in `card_image_embeddings`, so nearest-neighbour search was effectively
random while costing 4.8s p50 / 83s p95 of blocking embed time per card. The
API now skips the online-embed wait until `VECTOR_INDEX_READY=true`.

## How to index (needs runtime env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, vector worker)

```bash
node scripts/index-visual-vector-embeddings.mjs \
  --dataset data/catalog/vector-seed/feedback-writer-gt-seed-dataset.json \
  --out data/catalog/vector-seed/index-report.json
```

After indexing (and any further seeds), set `VECTOR_INDEX_READY=true` in the
Vercel environment to re-enable the online vector assist lane. Target scale
before flipping: >= 1,000 embeddings; below that the lane stays shadow.

## Next seed sources (in trust order)

1. New writer-approved listings (flows in automatically via the feedback loop).
2. `card_reference_images` (128 rows) - already indexed reference shots.
3. Catalog gap queue promotions - each promoted identity should bring its
   query images along as references.
