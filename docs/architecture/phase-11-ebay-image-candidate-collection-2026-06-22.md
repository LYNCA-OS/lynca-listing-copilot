# Phase 11 eBay Image Candidate Collection

Date: 2026-06-22

## Scope

This phase adds an official eBay Browse API collection path for the requested 300 image candidates.

It does not scrape eBay pages and does not treat seller titles as ground truth. The collected records are a candidate review queue only; they are not eligible for accuracy evaluation until an operator or official/printed evidence labels the ground truth.

## Added Files

- `scripts/collect-ebay-image-candidates.mjs`
- `scripts/collect-ebay-image-candidates.test.mjs`

## Updated Files

- `lib/listing/retrieval/ebay-browse-provider.mjs`
- `scripts/retrieval.test.mjs`

The eBay Browse adapter now carries official API image URLs in candidate fields:

- `marketplace_image_url`
- `marketplace_image_urls`

These fields remain marketplace-reference evidence.

## Command

Collect 300 candidates:

```bash
npm run ebay:candidates -- --target 300 --out data/ebay-candidates/ebay-image-candidates-latest.json
```

Optional query controls:

```bash
npm run ebay:candidates -- --target 300 --query "sports trading card PSA" --query "pokemon card graded"
```

Environment controls:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_MARKETPLACE_ID`
- `EBAY_IMAGE_CANDIDATES_OUT`
- `EBAY_IMAGE_CANDIDATE_TARGET`
- `EBAY_IMAGE_CANDIDATE_QUERY_LIMIT`
- `EBAY_IMAGE_CANDIDATE_MAX_PAGES`
- `EBAY_IMAGE_CANDIDATE_QUERIES`

`EBAY_IMAGE_CANDIDATE_QUERIES` uses `|` as the separator.

## Output Contract

Output schema:

```json
{
  "schema_version": "ebay-image-candidates-v1",
  "status": "collected",
  "source": "ebay_browse",
  "target_count": 300,
  "collected_count": 300,
  "items": []
}
```

Each item is marked:

- `source_type = MARKETPLACE`
- `trust_tier = MARKET_REFERENCE`
- `seller_title_is_ground_truth = false`
- `ground_truth_status = unlabeled`
- `accuracy_eval_eligible = false`
- `required_next_step = operator_or_official_ground_truth_labeling`

## Current Local Result

The local run is blocked:

- `status = skipped`
- `target_count = 300`
- `collected_count = 0`
- reason: `EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured`

This is correct behavior. Without official eBay Browse credentials, the system must not scrape eBay or fabricate a 300-image test set.

## Accuracy Boundary

The 300 eBay image candidate file is not a benchmark by itself.

To measure accuracy:

1. Collect 300 candidates through official eBay Browse API.
2. Store or review the image candidates.
3. Label ground truth from card images, official checklists, grading evidence, and operator review.
4. Convert approved labeled rows into held-out commercial dataset input.
5. Run `npm run commercial:heldout`.
6. Run `npm run eval:golden -- --dataset data/golden-dataset.commercial.json`.
7. Only then report exact-resolution accuracy.
