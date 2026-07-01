# Recognition Data Needed From Owner

The Recognition Accuracy Program needs owner-reviewed, image-backed, field-level data. Marketplace titles, legacy vision provider outputs, GPT outputs, or pilot test feedback cannot be treated as ground truth.

## Minimum Dataset

Commercial gate target:

- at least 300 cards with original front image
- back image whenever the card has checklist, product, serial, or year evidence on the back
- at least 100 slabbed or graded cards if graded cards are in launch scope
- at least 75 serial-numbered cards
- at least 75 complex parallel or insert cards
- at least 40 multi-subject cards
- at least 40 real-photo examples with glare, angle, sleeve, slab, or seller-background noise
- at least 30 non-standard or incomplete-title examples

## Required Fields

Each reviewed item must include:

- `asset_id`
- `physical_card_id`
- `capture_session_id`
- image object paths and image roles
- `category`
- `ground_truth`
- `critical_fields`
- `difficulty_tags`
- `ground_truth_sources`
- `reviewed_by`
- `review_status`

Ground truth fields:

- `year`
- `manufacturer`
- `product`
- `set`
- `players`
- `card_type`
- `insert`
- `parallel`
- `variation`
- `serial_number`
- `collector_number`
- `checklist_code`
- `attributes`
- `grade_company`
- `card_grade`
- `auto_grade`
- `grade_type`

## Critical Field Rules

Mark a field critical when a wrong value would make the listing commercially unsafe.

Default critical fields:

- `year`
- `product`
- `players`
- `serial_number` when present
- `collector_number` when useful for identification
- `checklist_code` when visible or category-specific
- `parallel` when color, pattern, refractor, numbered status, or insert family changes the card identity
- `grade_company`, `card_grade`, `auto_grade`, and `grade_type` when slabbed or authenticated

## Ground Truth Source Rules

Allowed source types:

- `CARD_FRONT`
- `CARD_BACK`
- `SLAB_LABEL`
- `OCR_REVIEW`
- `OPERATOR`
- `OFFICIAL_CHECKLIST`
- `INTERNAL_REGISTRY`
- `APPROVED_HISTORY`
- `UNKNOWN`

Owner review should prefer direct visual/card evidence first, then registry or official checklist evidence. Marketplace titles can explain why a card is commercially confusing, but cannot establish truth.

## Review Status

Use:

- `NEEDS_REVIEW` for exported candidates with no reviewed field truth
- `SINGLE_REVIEWED` after one reviewer confirms all critical fields
- `DOUBLE_REVIEWED` after two reviewers confirm all critical fields
- `ARBITRATED` when reviewers disagreed and a final reviewed value was selected
- `REJECTED` for unusable images or unresolved identity

Commercial gates should use only `DOUBLE_REVIEWED` or `ARBITRATED` held-out items unless explicitly documented otherwise.

## Difficulty Tags

Recommended tags:

- `slab`
- `raw`
- `glare`
- `sleeve`
- `angled_photo`
- `low_resolution`
- `card_back_required`
- `serial`
- `one_of_one`
- `complex_parallel`
- `insert_family`
- `multi_subject`
- `autograph`
- `patch`
- `relic`
- `rc`
- `first_bowman`
- `non_standard_title`
- `marketplace_title_misleading`

## Export From Supabase

Supabase feedback rows can seed candidates, but they are not ready ground truth.

Required process:

1. Export rows with durable front/back object paths.
2. Run `node scripts/export-recognition-dataset-candidates.mjs`.
3. Review and fill field-level truth.
4. Assign `physical_card_id` and `capture_session_id`.
5. Add `critical_fields`, `difficulty_tags`, and `ground_truth_sources`.
6. Split the dataset with `node scripts/generate-recognition-splits.mjs`.
7. Run leakage checks before using any held-out metrics.

## Do Not Include Yet

Do not upload or retain current Codex tests, manual experiments, or pilot feedback as training data until the commercial data-retention gate is explicitly enabled.

Do not create synthetic ground truth from:

- legacy vision provider output
- GPT output
- eBay listing titles
- seller descriptions alone
- OCR output alone
- public API card names when the specific physical card identity is not reviewed
