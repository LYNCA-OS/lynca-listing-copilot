# CardSightAI Structure Lessons for LYNCA Listing Copilot

## 1. Executive Summary

CardSight may not be a better field reader for our use case, but its API / catalog / match-level / feedback / segment skeleton is worth learning from. LYNCA should learn the skeleton, not the eyes: keep GPT + LYNCA Resolver as the decision maker, and upgrade our product contracts so every image becomes a structured identity state, a catalog coverage decision, and a writer-learning event.

This research only uses public GitHub sources, README files, SDK surface, generated type/OpenAPI traces, and demo code. It does not call CardSight APIs, does not use a key, does not inspect any private database, and does not recommend adding CardSight as a dependency or provider.

## 2. Public Sources Reviewed

| Public source | What was inspected | Useful structure observed |
| --- | --- | --- |
| [CardSightAI organization profile](https://github.com/CardSightAI) | Public profile README and repo list | Platform positioning: visual identification, catalog, pricing/marketplace as separate but identity-linked surfaces. |
| [cardsightai-sdk-node](https://github.com/CardSightAI/cardsightai-sdk-node) | README, `src/client.ts`, `src/types.ts`, `src/utils.ts`, generated OpenAPI types | Strongest source for API surface: identify, detect, set identifiability, catalog hierarchy, match utilities, parallel/grading objects, fields, pricing, marketplace, population, feedback. |
| [cardsightai-sdk-python](https://github.com/CardSightAI/cardsightai-sdk-python) | README, generated client structure, tests | Same API surface expressed as sync/async Python helpers; clear endpoint category table; feedback and set-identifiability examples. |
| [cardsightai-sdk-swift](https://github.com/CardSightAI/cardsightai-sdk-swift) | README, `Sources/CardSightAI/CardSightAI.swift`, bundled `openapi.json` | Image-processing boundary, segment-scoped identify, detect helper, raw OpenAPI paths for feedback, grading, pricing, marketplace, population. |
| [cardsightai-sdk-java](https://github.com/CardSightAI/cardsightai-sdk-java) | README, generated client hints, `pom.xml` OpenAPI generation setup | Confirms SDK generation pattern and catalog/release/set/card filters in a statically typed ecosystem. |
| [cardsightai-demo-discord](https://github.com/CardSightAI/cardsightai-demo-discord) | README, `/identify` command, embed builder, CardSight utility wrapper | Useful UX pattern: processing state, no-card-detected state, multi-card display, confidence display, user-facing error handling. |

## 3. Current LYNCA Structure Summary

The current LYNCA Listing Copilot is already beyond a simple image-to-title demo:

- `api/listing-copilot-title.js` is the main cloud API orchestration boundary.
- The provider contract defines one GPT production vision path; the currently configured model is read from deployment configuration rather than hard-coded in documentation.
- Provider output is normalized into the Evidence First compatibility layer through `providerPayloadToEvidenceDocument`.
- Recognition worker evidence, if present, is normalized through `recognitionResponseToEvidenceDocument`.
- Retrieval is planned in `lib/listing/retrieval/query-planner.mjs` and executed in `lib/listing/retrieval/retrieval-engine.mjs`.
- Catalog / vector / hybrid retrieval can run, but assist candidates are fail-closed through `vector-candidate-packet.mjs`: only approved candidates without direct conflicts can enter the prompt.
- `catalog-contract.mjs` already contains a broad multi-source catalog type allowlist and separates official, community, external, and marketplace source classes.
- `parallel-policy.mjs` already implements safe color downgrading: surface color can be output, exact optical parallel should not be guessed.
- `card-type-policy.mjs` separates observable components such as Auto, Patch, Relic, Jersey, RC, Sketch, Redemption.
- `listing-resolution-gate.mjs` is field-aware and has writer-review states, but the match-level language is still not productized as a stable external contract.
- `listing-renderer.mjs` and `sports-title-renderer.mjs` produce deterministic titles from resolved fields, rather than using provider-generated final titles.
- `field-task-orchestrator.mjs` already models field tasks and source strength, but it should become more segment-aware and more directly tied to detect/preflight and catalog coverage.
- `analyze-cloud-timing.mjs` captures timing by provider mode, catalog cache hit, vector lazy skip, and retrieval assist.
- Feedback retention is intentionally disabled by default during tests, and reviewed/corrected title data is the long-term catalog-learning loop when explicitly promoted.

The main structural gaps are not "more prompt" problems. They are product-contract problems:

- match level is not first-class enough;
- segment mode is too implicit;
- catalog hierarchy still lacks a formal `release` layer;
- parallel is partly a policy/title string instead of a fully governed entity;
- physical instance and grading are not formal enough;
- feedback is not yet split by title, field, candidate, retrieval, and hard negative as first-class training assets.

## 4. What CardSight Does Structurally Well

### 4.1 API-first product boundary

CardSight exposes the product as stable API surfaces, then generates SDKs around those surfaces. The public SDKs suggest that each capability has a clear contract:

- identify: image to detections;
- detect: lightweight card presence;
- set identifiability: preflight catalog coverage check;
- catalog search: cards, sets, releases, manufacturers, segments, fields, parallels;
- pricing and marketplace: identity-linked market data;
- population and grades: identity/slab-linked reference data;
- feedback: corrections against entities and identify results.

LYNCA does not need to copy the endpoint list. We should copy the discipline: every major capability should have a stable internal contract before it becomes UI or eval logic.

### 4.2 Identify vs detect vs catalog vs feedback separation

The clean split is valuable:

- `detect` answers whether the image contains cards and how many.
- `identify` attempts identity resolution.
- `catalog` answers what identities exist and which variants are legal.
- `feedback` turns user corrections into data assets.

Our current API still overloads `/api/listing-copilot-title` with image processing, recognition, retrieval, resolution, rendering, review metadata, and timing. We should not split production immediately, but the internal contract should move toward this separation.

### 4.3 Match level is productized

CardSight's public Node SDK utilities distinguish:

- exact card match: specific card ID present;
- set-level match: set ID present but no card ID;
- no match: card detected but not identified.

For LYNCA this is more important than CardSight's actual recognition accuracy. Our system needs an explicit match-level state so the UI, gate, writer workflow, and eval all speak the same language.

Proposed LYNCA statuses:

| LYNCA match level | Meaning | Writer/product behavior |
| --- | --- | --- |
| `EXACT_CARD_MATCH` | Candidate identity is catalog-backed, direct evidence compatible, and selected without direct conflict. | Produce full structured draft; exact catalog fields can be locked or strongly suggested. |
| `SET_LEVEL_MATCH` | Release/set likely known, but exact card identity is not proven. | Use product/set facts, omit unsafe card/parallel specifics, ask writer to select candidate. |
| `PRODUCT_LEVEL_MATCH` | Product/release family known, set/card uncertain. | Safe draft only; product-level title modules allowed. |
| `SAFE_DRAFT_ONLY` | Direct observations are usable but no approved identity candidate exists. | Render observed fields, highlight unresolved identity modules. |
| `CATALOG_GAP_REQUIRED` | Card likely real, but catalog coverage is insufficient for exact identity. | Send to catalog gap queue; do not treat external/marketplace title as truth. |
| `NO_MATCH` | No usable card identity and direct observations are insufficient. | Rescan or deep manual review. |

### 4.4 Segment-specific identify mode

CardSight exposes segment-scoped identification in SDKs. The point is not that their segments match ours perfectly; the lesson is that narrowing the problem improves both speed and schema quality.

LYNCA should define segment scope as a first-class input/output:

| Segment | Prompt scope | Catalog scope | Parser/schema scope | Renderer scope |
| --- | --- | --- | --- | --- |
| `sports` | Generic sports card observation | All sports manufacturers/releases | player/team/product/serial/grade/card type | Standard Card Grammar |
| `basketball` | NBA/WNBA/college basketball examples and terms | Topps, Panini, Upper Deck, Bowman, Leaf basketball | player, team, rookie, auto, relic, product year | Standard Card Grammar |
| `baseball` | MLB/Bowman/Topps baseball terms | Topps, Bowman, Panini baseball | player, team, 1st Bowman, RC, auto, prospect | Standard Card Grammar |
| `football` | NFL/college football terms | Panini, Topps, Leaf football | player, team, rookie ticket, auto, patch | Standard Card Grammar |
| `soccer` | club/national team naming | Topps, Panini, Futera soccer | player, club/country, competition, refractor/prizm | Standard Card Grammar |
| `hockey` | NHL/Young Guns/Upper Deck terms | Upper Deck and related hockey sources | player, team, rookie, canvas, acetate | Standard Card Grammar |
| `pokemon` | Pokemon card text and rarity | Pokemon official/community sources | subject, card name, language, rarity, HP, type, set number | TCG Grammar |
| `yugioh` | Yu-Gi-Oh card text | Konami/YGOProDeck | card name, passcode, set code, rarity, language | TCG Grammar |
| `one_piece` | Bandai One Piece card list | Bandai official sources | character/card name, color, rarity, card number, language | TCG Grammar |
| `mtg` | MTG card text | Scryfall/WOTC | card name, mana cost, color, rarity, collector number, language | TCG Grammar |
| `generic_tcg` | fallback TCG reader | all TCG staging candidates | IP, language, product series, card number, rarity | TCG Grammar |

Segment scope should be decided by a cheap preflight, then passed into query planning, retrieval, field schema, and renderer.

### 4.5 Detect / preflight as a first-class layer

CardSight has a lightweight detect endpoint and set-identifiability checks. LYNCA needs the same concepts, even if implemented internally:

- `card_presence_detection`: is there a card in the image?
- `multi_card_detection`: one card, pair, lot, or binder/page?
- `slab_detection`: raw card vs slabbed card.
- `image_quality_preflight`: blur, glare, crop, readable text regions.
- `catalog_coverage_preflight`: do we have an approved or official candidate path?
- `set_identifiability_check`: can this product/set be resolved to exact identity?
- `rescan_required`: should the user capture another image before paid recognition?

This improves speed because bad or insufficient inputs can be routed before expensive identification; it improves accuracy because catalog coverage is separated from model confidence.

### 4.6 Catalog hierarchy is explicit

CardSight's public surface separates segments, manufacturers, releases, sets, cards, parallels, fields, and release calendar. Our schema already has products, sets, cards, and parallels, but `release` is still under-modeled.

We should introduce `release` because it solves a real ambiguity:

- Manufacturer: Topps
- Release/Product: 2025-26 Topps Chrome Basketball
- Set/Insert/Sub-set: Base, Sapphire, Autographs, Best Performance, Downtown, Rookie Ticket
- Card: Michael Jordan Best Performance #96
- Parallel: Gold, Purple, Refractor, Wave, Shimmer, etc.

Without a release layer, "product" and "set" get overloaded, especially across sports and TCG.

### 4.7 Parallel is an object, not a title phrase

CardSight models `parallel` as an object with ID/name/numberedTo and catalog utilities. This is exactly the direction we need, with stricter safety:

```text
parallel_id
name
surface_color
family
pattern
numbered_to
rarity_type
source_trust
applies_to_release
applies_to_set
applies_to_card
requires_writer_confirmation
```

Important LYNCA rule:

- First version should still output `surface_color` only when exact optical parallel is not proven.
- `parallel_exact` should remain a candidate/writer-confirmed field unless catalog legality plus direct evidence supports it.
- Do not auto-upgrade `Gold` to `Gold Refractor`, `Gold Wave`, `Gold Shimmer`, `Gold Mojo`, or `Gold Prizm`.

### 4.8 Grading/slab is a separate object

CardSight's public SDK separates card identity from slab grading detail. LYNCA should formalize the same split:

- `card_identity`: shared product identity.
- `physical_card_instance`: the particular physical copy in front of the camera.
- `grading_observation`: slab label evidence from the current image.

Rules:

- serial numerator only comes from current image;
- grade only comes from current slab label evidence;
- cert number only comes from current slab label evidence;
- catalog/reference may support expected serial denominator, but must not copy numerator;
- catalog/reference may support known graded-population structure, but must not copy grade/cert.

### 4.9 Flexible fields for TCG and segment-specific facts

CardSight's "fields" catalog is useful because TCGs do not fit a single sports-card schema. LYNCA should keep a stable core identity schema and add segment-specific flexible fields.

Proposed structure:

```json
{
  "segment": "pokemon",
  "core_fields": {
    "year": "2023",
    "product_or_set": "Scarlet & Violet",
    "subject": "Charizard",
    "collector_number": "199/165",
    "language": "EN"
  },
  "flex_fields": [
    { "key": "RARITY", "value": "Special Illustration Rare", "source": "official_or_observed" },
    { "key": "HP", "value": "330", "source": "observed_text" },
    { "key": "TYPE", "value": "Fire", "source": "observed_text" }
  ]
}
```

Segment examples:

| Segment | Flexible fields |
| --- | --- |
| Pokemon | HP, type, rarity, artist, evolution stage, set number, language, foil/reverse/holo. |
| MTG | mana cost, colors, type line, rarity, artist, collector number, language, foil. |
| Yu-Gi-Oh | passcode, set code, rarity, attribute, type, level/rank/link, edition, language. |
| One Piece | card code, color, rarity, leader/character/event/stage type, cost, power, language. |
| Sports | team, league, position, RC, auto, patch/relic, serial denominator, grading company, cert. |

### 4.10 Feedback is an API surface, not a note field

CardSight exposes feedback endpoints for identify and catalog entities. LYNCA should make writer confirmation similarly structured:

- `feedback/title`: final title override and reason.
- `feedback/field`: per-field correction, evidence source, display status.
- `feedback/candidate`: candidate accepted/rejected, conflict reason.
- `feedback/catalog-gap`: new identity request or existing identity link.
- `feedback/retrieval`: retrieval helped, failed, or misled.
- `feedback/hard-negative`: wrong high-ranking candidate, direct conflict, or model regression.

The goal is not simply storing corrections. The goal is that every writer action becomes a calibrated training/eval asset.

### 4.11 Pricing / marketplace / population hang off identity

CardSight's pricing, marketplace, and population modules are useful structurally because they hang downstream data off an identity ID. We should not implement them now, but future tables should attach to `card_identity_id` and optional `parallel_id` / `grading_company_id`:

- `pricing_by_identity`
- `marketplace_reference`
- `population_report`
- `sales_comparable`

Marketplace titles remain weak reference data. They cannot become final title truth.

## 5. What We Should Not Copy

1. Do not add CardSight as a provider or dependency.
2. Do not let a CardSight-style result, or any external result, become truth without LYNCA evidence resolution.
3. Do not use external titles to generate final titles; renderer stays deterministic and LYNCA-owned.
4. Do not treat set-level or product-level matches as exact card matches.
5. Do not write official/community/marketplace imports into `REVIEWED_INTERNAL` automatically.
6. Do not copy serial numerator, grade, cert number, or condition from catalog/reference records.
7. Do not overfit our schema to CardSight's exact names; use the parts that match LYNCA's business workflow.
8. Do not add collection/wishlist/binder APIs now; they are consumer-app features, not current listing identity infrastructure.
9. Do not add pricing/marketplace/population modules before identity quality is stable.
10. Do not use confidence text as fact. Confidence is routing metadata only.

## 6. Mapping to Our Current Architecture

| CardSight concept | LYNCA current equivalent | Gap | Recommendation |
| --- | --- | --- | --- |
| API-first SDK/OpenAPI contract | `api/listing-copilot-title.js`, scripts, docs | Main endpoint is too broad and internal contracts are not stable enough | Define internal contracts for identify/detect/catalog/render/feedback before splitting production routes. |
| Identify endpoint | GPT provider + evidence normalizer + resolver | Identification and title generation are still coupled in one route | Keep one route for now, but internally expose `identify_result` separate from `rendered_title`. |
| Detect endpoint | image quality gate and pre-provider rescan gate | Detect/preflight is not a product-level object | Add `listing_preflight` object with card presence, multi-card, slab, quality, coverage, rescan. |
| Set identifiability | catalog/vector/retrieval eligibility | Coverage exists but is not a clear status | Add `catalog_coverage_preflight` and `set_identifiability_check`. |
| Exact / set-level / no match utilities | `open_set_decision`, gate status, `publication_status` | Status vocabulary is not productized | Add `match_level` enum: `EXACT_CARD_MATCH`, `SET_LEVEL_MATCH`, `PRODUCT_LEVEL_MATCH`, `SAFE_DRAFT_ONLY`, `CATALOG_GAP_REQUIRED`, `NO_MATCH`. |
| Segment identify | renderer selector and prompt examples | Segment is inferred late and inconsistently | Add segment detection/scope before prompt, retrieval, schema, and renderer. |
| Catalog segments | `catalogSourceTypes`, product filters | We have source types, not formal market segments | Add `catalog_segments` and segment-specific source scopes. |
| Manufacturers | `manufacturer` / `brand` fields | Mostly field-level, not fully normalized catalog entity | Add manufacturer aliases and source trust. |
| Releases | product/set fields | Product and set are overloaded | Add `catalog_releases` between manufacturer and set. |
| Sets | `catalog_sets` | Useful but needs release parent and set type | Keep but normalize as release child; model insert/subset/autograph/relic sets. |
| Cards | `catalog_cards` | Identity vs instance not fully separated | Keep identity-only; never store serial numerator/grade as identity facts. |
| Parallels | `catalog_parallels`, `parallel-policy.mjs` | Object exists but exact vs surface color contract needs hardening | Add formal `parallel_id`, legality scope, writer confirmation flag, source trust. |
| Flexible fields | none formal; many fields in resolved object | TCG fields will not scale in fixed schema | Add `flex_fields` per segment with official/observed status. |
| Grading object | grade fields in evidence/resolved | Slab/grade not formal enough as instance observation | Add `grading_observations` tied to physical instance and image region evidence. |
| Feedback endpoints | feedback endpoint and corrected title loop | Feedback is not split by training purpose | Add title/field/candidate/retrieval/catalog-gap/hard-negative feedback contracts. |
| Pricing / marketplace / population | eBay reference, no identity-linked market tables | Current marketplace is intentionally reference-only | Future: attach market data to `card_identity_id`, never to provider truth. |
| Demo processing/no-detection UX | frontend progress and failed panels | LYNCA UI has improved but detect conclusions should be clearer | Show preflight conclusion: front/back, card count, slab, rescan reason, match level. |

## 7. Recommended Architecture Upgrades

### P0

1. **Match Level Normalization**
   - Add stable enum: `EXACT_CARD_MATCH`, `SET_LEVEL_MATCH`, `PRODUCT_LEVEL_MATCH`, `SAFE_DRAFT_ONLY`, `CATALOG_GAP_REQUIRED`, `NO_MATCH`.
   - Expose it in API output, eval reports, and writer UI.
   - It should be derived from evidence, catalog coverage, conflicts, and resolver state, not provider confidence.

2. **Segment-specific Scope**
   - Add `segment_scope` before recognition/retrieval/rendering.
   - Start with sports, basketball, baseball, football, soccer, hockey, pokemon, yugioh, one_piece, mtg, generic_tcg.
   - Use segment to limit prompt examples, catalog sources, parsing rules, field schema, and renderer grammar.

3. **Preflight / Detect**
   - Add a lightweight `listing_preflight` object.
   - Include card presence, multi-card, front/back decision, slab, image quality, catalog coverage, set identifiability, rescan.
   - Use it to reduce wasted provider calls and guide UI state.

4. **Parallel Object**
   - Formalize exact parallel candidates as catalog objects.
   - Keep first output layer as `surface_color`.
   - Exact optical parallel remains candidate/writer confirmation unless directly supported.

5. **Grading / Physical Instance Object**
   - Separate identity facts from physical copy facts.
   - Grade, cert, and serial numerator are image-only observations.

6. **Feedback API**
   - Split writer feedback into title, field, candidate, catalog gap, retrieval, and hard negative events.

### P1

1. **Catalog hierarchy normalization**
   - Adopt `segment -> manufacturer -> release -> set -> card -> parallel`.
   - `release` is the high-value missing layer.

2. **Flexible field schema**
   - Keep core fields stable.
   - Store TCG and segment-specific facts in `flex_fields`.

3. **Catalog coverage preflight**
   - Before provider call or before vector assist, decide whether the identity is known catalog, weak catalog, or catalog gap.

4. **Set-level / product-level safe draft mode**
   - Let the renderer produce safe drafts from directly observed fields even when exact catalog identity is missing.

### P2

1. **Pricing / marketplace / population by identity**
   - Only after identity reliability is stable.
   - Attach to `card_identity_id`, `parallel_id`, and grading filters.

2. **SDK / OpenAPI contract for internal tools**
   - Internal generated clients would reduce front/back-end drift.

3. **External legality provider interface**
   - Official/community directories can answer legality and candidate generation, but never truth.

## 8. Proposed Data Model Changes

These are schema drafts only. Do not migrate yet.

### `catalog_segments`

- **Purpose:** top-level category/sport/IP scope for prompt, parser, catalog source, and renderer.
- **Key fields:** `segment_id`, `slug`, `name`, `parent_segment_id`, `grammar_type`, `default_renderer`, `source_trust_policy`, `created_at`, `updated_at`.
- **Source trust:** `REVIEWED_INTERNAL`, `OFFICIAL_SOURCE`, `COMMUNITY_CANDIDATE`, `EXTERNAL_WEAK`.
- **Never copy from reference:** no serial numerator, grade, cert, condition, seller title.

### `catalog_manufacturers`

- **Purpose:** normalize Topps/Fanatics/Panini/Upper Deck/Bandai/Konami/etc.
- **Key fields:** `manufacturer_id`, `segment_id`, `canonical_name`, `aliases`, `official_site_url`, `source_type`, `source_trust`, `review_status`.
- **Source trust:** official manufacturer pages are support; reviewed internal remains highest.
- **Never copy from reference:** no card-instance facts.

### `catalog_releases`

- **Purpose:** formal product/release layer, e.g. `2025-26 Topps Chrome Basketball`.
- **Key fields:** `release_id`, `segment_id`, `manufacturer_id`, `year`, `season_year`, `release_name`, `product_family`, `language`, `release_date`, `official_url`, `source_type`, `source_trust`, `review_status`.
- **Source trust:** official checklist/release pages can create candidate releases; writer review promotes.
- **Never copy from reference:** serial numerator, grade, cert, current copy condition.

### `catalog_sets`

- **Purpose:** release child layer for base sets, inserts, autograph sets, relic sets, subsets, TCG expansion sections.
- **Key fields:** `set_id`, `release_id`, `set_name`, `set_type`, `insert_type`, `is_autograph_set`, `is_relic_set`, `is_base_set`, `language`, `source_type`, `source_trust`, `review_status`.
- **Source trust:** official checklists can support set existence; exact identity still needs card-level support.
- **Never copy from reference:** physical copy fields.

### `catalog_cards`

- **Purpose:** canonical card identity, not a physical copy.
- **Key fields:** `card_identity_id`, `set_id`, `card_name`, `subjects`, `subject_count`, `team`, `collector_number`, `checklist_code`, `card_type`, `expected_serial_denominator`, `core_fields`, `flex_fields`, `source_type`, `source_trust`, `review_status`.
- **Source trust:** reviewed internal and official cardlists can support identity; marketplace remains weak.
- **Never copy from reference:** serial numerator, slab grade, cert number, condition, price.

### `catalog_parallels`

- **Purpose:** exact parallel legality and writer-confirmable variants.
- **Key fields:** `parallel_id`, `release_id`, `set_id`, `card_identity_id`, `name`, `surface_color`, `family`, `pattern`, `numbered_to`, `rarity_type`, `source_type`, `source_trust`, `applies_to_set`, `applies_to_card`, `requires_writer_confirmation`, `review_status`.
- **Source trust:** official checklist is support; exact optical claim requires image or writer confirmation.
- **Never copy from reference:** serial numerator of an individual card.

### `physical_card_instances`

- **Purpose:** particular copy or intake item, separate from identity.
- **Key fields:** `physical_instance_id`, `card_identity_id`, `asset_group_id`, `serial_number`, `serial_numerator`, `serial_denominator`, `condition_notes`, `raw_or_slab`, `created_from_review_id`, `training_eligible`, `review_status`.
- **Source trust:** current image and writer confirmation.
- **Never copy from reference:** any instance field from catalog/reference.

### `grading_observations`

- **Purpose:** slab label observations from current image.
- **Key fields:** `grading_observation_id`, `physical_instance_id`, `company`, `grade_value`, `grade_condition`, `qualifier`, `auto_grade`, `cert_number`, `source_image_id`, `region`, `evidence_status`, `confidence`, `writer_confirmed`.
- **Source trust:** slab label direct evidence, writer confirmation.
- **Never copy from reference:** grade/cert from catalog or another physical copy.

### `field_feedback`

- **Purpose:** writer correction at field level.
- **Key fields:** `field_feedback_id`, `query_card_id`, `field_name`, `ai_value`, `writer_value`, `display_status`, `correction_type`, `source_evidence_ids`, `training_eligible`, `created_by`, `created_at`.
- **Source trust:** writer-reviewed feedback can become training/eval asset.
- **Never copy from reference:** do not use unreviewed marketplace titles as writer value.

### `candidate_feedback`

- **Purpose:** candidate accepted/rejected feedback for reranking and catalog learning.
- **Key fields:** `candidate_feedback_id`, `query_card_id`, `candidate_id`, `candidate_source_type`, `selected_by_system`, `writer_decision`, `conflicting_fields`, `reason_code`, `training_eligible`.
- **Source trust:** writer decision and direct evidence conflicts.
- **Never copy from reference:** instance fields from rejected/accepted candidates.

### `catalog_gap_feedback`

- **Purpose:** queue and resolve unknown cards that are not covered by approved catalog.
- **Key fields:** `catalog_gap_feedback_id`, `query_card_id`, `observed_fields`, `unresolved_fields`, `candidate_sources`, `writer_final_title`, `writer_confirmed_fields`, `promoted_identity_id`, `promotion_status`, `training_eligible`.
- **Source trust:** starts as gap; only reviewed promotion creates approved identity.
- **Never copy from reference:** external/marketplace title as canonical truth without review.

### `hard_negative_examples`

- **Purpose:** store high-similarity or high-rank wrong candidates and direct-conflict cases for reranker learning.
- **Key fields:** `hard_negative_id`, `query_card_id`, `correct_identity_id`, `wrong_candidate_id`, `error_type`, `similarity_features`, `matched_fields`, `conflicting_fields`, `writer_resolution`, `training_eligible`.
- **Source trust:** writer-reviewed or eval-confirmed only.
- **Never copy from reference:** this table teaches the reranker what not to choose; it should not provide identity fields.

## 9. Proposed API Contract

These are future internal contracts. Do not implement in this research task.

### `POST /api/listing/identify`

**Purpose:** image/evidence to identity state, not final publication.

Request:

```json
{
  "assets": [{ "image_id": "front-1", "role_hint": "unknown", "object_path": "..." }],
  "segment_hint": "basketball",
  "mode": "catalog_vector_gpt",
  "options": {
    "enable_catalog_assist": true,
    "enable_vector_assist": true,
    "writer_review_required": true
  }
}
```

Response:

```json
{
  "preflight": {
    "card_presence": "PRESENT",
    "card_count": 1,
    "front_back_assignment": [{"image_id": "front-1", "role": "front"}],
    "slab_detected": false,
    "quality_status": "USABLE",
    "rescan_required": false
  },
  "match_level": "SAFE_DRAFT_ONLY",
  "segment_scope": "basketball",
  "identity": {},
  "field_states": {},
  "candidate_summary": {
    "catalog_candidate_count": 0,
    "vector_candidate_count": 5,
    "prompt_candidate_count": 0
  },
  "writer_review": {
    "required": true,
    "highlight_fields": ["parallel_exact"]
  }
}
```

### `POST /api/listing/detect`

**Purpose:** cheap input routing before paid recognition.

Response fields:

- `card_presence_detection`
- `multi_card_detection`
- `slab_detection`
- `front_back_assignment`
- `image_quality_preflight`
- `catalog_coverage_preflight`
- `set_identifiability_check`
- `rescan_required`

### `GET /api/catalog/search`

**Purpose:** human/operator catalog lookup.

Query fields:

- `q`
- `segment`
- `manufacturer`
- `release`
- `year`
- `subject`
- `collector_number`
- `checklist_code`
- `source_trust_min`

### `GET /api/catalog/candidates`

**Purpose:** machine candidate generation for recognition.

Query fields:

- `observed_subject`
- `observed_year`
- `observed_product`
- `collector_number`
- `checklist_code`
- `serial_denominator`
- `surface_color`
- `segment`

Response must separate:

- `approved_candidates`
- `official_candidates`
- `community_candidates`
- `weak_external_candidates`
- `conflict_blocked_candidates`

### `POST /api/title/render`

**Purpose:** deterministic rendering only.

Request:

```json
{
  "grammar": "STANDARD_CARD_GRAMMAR",
  "resolved_fields": {},
  "field_display_status": {},
  "max_length": 85
}
```

Response:

- `modules`
- `final_title`
- `omitted_modules`
- `highlighted_modules`
- `length_policy`

### `POST /api/feedback/title`

**Purpose:** final title correction.

Fields:

- `query_card_id`
- `ai_title`
- `writer_title`
- `correction_type`
- `training_eligible`

### `POST /api/feedback/field`

**Purpose:** field-level correction.

Fields:

- `query_card_id`
- `field_name`
- `ai_value`
- `writer_value`
- `display_status`
- `evidence_region`
- `correction_type`

### `POST /api/feedback/candidate`

**Purpose:** accepted/rejected candidate learning.

Fields:

- `query_card_id`
- `candidate_id`
- `candidate_source_type`
- `writer_decision`
- `conflicting_fields`
- `reason_code`

### `POST /api/catalog-gap/promote`

**Purpose:** writer-reviewed unknown card to approved catalog identity.

Must be atomic:

- identity row;
- card/release/set/parallel rows as needed;
- reference image eligibility;
- embedding/index status;
- promotion event;
- hard negatives if a wrong candidate was rejected.

### `GET /api/eval/report`

**Purpose:** read-only evaluation summary.

Group by:

- provider mode;
- segment;
- known catalog vs cold start;
- match level;
- catalog assist;
- vector assist;
- feedback availability.

## 10. Immediate Implementation Plan

### 10.1 Match Level Normalization v1

- **Files likely touched:** `lib/identity-resolution/listing-resolution-gate.mjs`, `api/listing-copilot-title.js`, `lib/listing/evaluation/blind-eval.mjs`, `scripts/evaluate-cloud-listing-api.mjs`, UI presentation code.
- **Expected benefit:** separates exact identity success from safe draft usefulness; makes eBay cold-start results easier to evaluate without pretending every unknown card is GPT failure.
- **Risk:** if applied too aggressively, product may show "exact" when only set-level is known.
- **Tests needed:** exact candidate, set-only candidate, product-only candidate, no candidate, direct-conflict candidate, marketplace-only candidate.

### 10.2 Segment-specific Scope v1

- **Files likely touched:** `api/listing-copilot-title.js`, `lib/listing/orchestration/field-task-orchestrator.mjs`, `lib/listing/retrieval/query-planner.mjs`, `lib/listing/catalog/catalog-contract.mjs`, renderer selector, prompt loader.
- **Expected benefit:** faster prompts, less field confusion, cleaner catalog lookup, better TCG handling.
- **Risk:** wrong segment can suppress useful candidates; must allow fallback to broader scope.
- **Tests needed:** basketball, baseball, football, Pokemon, Yu-Gi-Oh, One Piece, generic TCG, multi-card mixed sports/TCG.

### 10.3 Feedback API / Field Feedback v1

- **Files likely touched:** feedback API route, Supabase feedback store, `lib/listing/memory/title-field-parser.mjs`, candidate reranker export scripts, hard negative export.
- **Expected benefit:** every writer correction becomes a structured training/eval asset; reduces dependence on corrected_title-only proxy.
- **Risk:** test/eBay data could contaminate training if retention flags are wrong.
- **Tests needed:** retention disabled, retention enabled, test data training-ineligible, field correction, candidate rejection, catalog gap promotion, hard negative creation.

## 11. Risks

| Risk | Why it matters | Control |
| --- | --- | --- |
| Overfitting to CardSight structure | Their API is built for a platform/catalog business; LYNCA is a listing workflow with writer review. | Use only concepts that solve our evidence/candidate/gate/feedback problems. |
| Too many abstractions too early | More tables and states can slow delivery if not tied to eval gains. | Implement match level, segment scope, and feedback first; delay pricing/population. |
| Source trust confusion | Official/community/marketplace sources have different truth levels. | Keep staging/candidate/reviewed separation; fail closed. |
| External catalog mistaken as truth | Imported rows can be incomplete or wrong. | External rows support candidate generation and legality only until reviewed. |
| Schema migration complexity | Release/set/card/parallel refactor can break existing imports. | Add release as an additive layer; migrate gradually with compatibility views. |
| Confidence treated as fact | Provider confidence can be high and wrong. | Gate reads evidence, source type, conflicts, constraints, catalog support, not confidence prose. |
| Copying instance fields from catalog | Serial numerator, grade, cert errors are high-risk. | Enforce identity vs physical instance split in schema and tests. |

## 12. Top 10 Structures Worth Borrowing

1. API-first capability boundaries.
2. Identify vs detect vs catalog vs feedback separation.
3. Match-level states that are visible to SDK/UI logic.
4. Segment-scoped identification and catalog filtering.
5. Preflight set/catalog identifiability before expensive recognition.
6. Catalog hierarchy with `release` between manufacturer and set.
7. Parallel as an object with legality/numbered metadata.
8. Grading/slab as a separate observation object.
9. Flexible metadata fields for TCG and segment-specific attributes.
10. Feedback endpoints tied to identify results and catalog entities.

## 13. Five Things We Should Not Copy

1. Do not import CardSight SDK or use CardSight API in production.
2. Do not copy their exact catalog schema without adapting to writer-reviewed LYNCA truth.
3. Do not treat exact optical parallel as automatic just because a catalog object exists.
4. Do not add collection/binder/wishlist features before identity accuracy is solved.
5. Do not let marketplace/pricing title search feed final identity or final title.

## 14. Three Near-term Architecture Moves

1. **Add `match_level` to API output and eval reports.**
   - This is the smallest product-contract change with the biggest diagnosis value.

2. **Add `segment_scope` to preflight, retrieval, and renderer.**
   - This should reduce prompt bloat and catalog noise without changing the core GPT provider.

3. **Add field/candidate feedback contracts while retention remains guarded.**
   - This converts writer review into candidate-reranker and hard-negative assets without training on dirty test data.

## 15. Final Recommendation

We should learn CardSight's skeleton, not its eyes.

CardSight's public structure reinforces the first-principles direction we already moved toward: recognition is not the product; the product is a reliable identity decision system with explicit match level, segment scope, catalog coverage, safe draft fallback, deterministic rendering, and writer feedback that compounds into a better catalog.
