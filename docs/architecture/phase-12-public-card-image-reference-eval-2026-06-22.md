# Phase 12 Public Card Image Reference Eval

Date: 2026-06-22

## Scope

This phase adds a repeatable public card-image reference test for Agnes.

The user asked for 300 card images even if eBay is not required. This implementation uses the Pokémon TCG API card search endpoint as a structured card-image source. It collects only card records with:

- `supertype = Pokémon`
- a card name
- an HTTPS card image URL
- `category = pokemon_card`

This is not web scraping, and it does not mix in non-card images.

## Source Boundary

Source documentation:

- `https://docs.pokemontcg.io/api-reference/cards/search-cards/`

The Pokémon TCG API is treated as a public structured reference source for card-name testing. It is not the commercial held-out dataset and does not replace human/official/printed evidence for the Listing Copilot commercial gate.

## Added Files

- `scripts/collect-public-card-image-candidates.mjs`
- `scripts/evaluate-agnes-public-card-images.mjs`
- `scripts/public-card-image-candidates.test.mjs`

## Package Commands

Collect 300 card-image candidates:

```bash
npm run public:cards -- --target 300 --out data/public-card-candidates/public-card-image-candidates-latest.json
```

Evaluate card-name recognition with Agnes:

```bash
npm run eval:agnes-public-cards -- --limit 300 --concurrency 3 --out data/eval/agnes-public-card-image-eval-latest.json
```

The eval script supports resume. It reuses already evaluated rows and retries provider errors.

## Current Local Run

Candidate collection:

- status: `collected`
- source: `pokemon_tcg_api`
- target_count: `300`
- collected_count: `300`
- categories: `pokemon_card`
- invalid/missing card records in the saved candidate set: `0`

Agnes evaluation after retrying transient provider errors:

- status: `completed`
- attempted_count: `300`
- evaluated_count: `300`
- provider_error_count: `0`
- strict card-name exact: `296/300`
- strict card-name exact rate: `0.986667`
- loose card-name rate: `0.986667`
- parsed_success_rate: `1`

The four strict card-name misses were spelling-level OCR/name errors:

- `Cinccino ex` -> `Cincino ex`
- `Tyrantrum` -> `Tyranttrum`
- `Eelektrik` -> `Eleektrik`
- `Larry's Dudunsparce ex` -> `Larry's Dudunce ex`

## Accuracy Boundary

This run is useful evidence that Agnes can read card names from a 300-image public card reference set at `98.6667%` strict exact-match accuracy after retrying transient provider failures.

`npm run readiness:audit` now reports this as:

```text
public_card_reference_eval: completed 296/300 (0.986667)
```

The readiness check is non-blocking. Passing it does not clear any commercial blocker.

It still must not be used to claim commercial readiness because:

- it tests Pokémon card-name recognition, not the full sports-card resolved-field contract;
- it compares against public structured reference names, not approved commercial review ground truth;
- it does not evaluate full-card exact resolution, title correctness, glare recovery, routing, or B-end publish safety;
- it does not replace the held-out commercial dataset gate.

The commercial gate remains tied to `npm run commercial:heldout`, `npm run eval:golden`, and `npm run readiness:audit`.
