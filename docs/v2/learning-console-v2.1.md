# Listing Copilot V2.1 Learning Console

Status: Design Draft v2.1
Owner: LYNCA Listing Intelligence
Companion Documents:

- `feedback-loop-v2.md`
- `database-schema-v2.md`
- `image-evidence-v2b.md`
- `v2-scope-lock.md`

## Purpose

The V2.1 Learning Console turns V2.0B Supabase feedback records into human-approved system upgrade proposals.

V2.0B captures raw memory:

- `generated_title`
- `corrected_title`
- `front_image_url`
- `back_image_url`
- `operator_id`
- `created_at`

V2.1 reviews that memory and prepares possible improvements. It does not automatically apply them.

The target workflow is:

```text
Supabase Export
  |
Process Data
  |
Admin Review
  |
Propose Upgrade
  |
Install Upgrade
```

## Product Principle

V2.1 preserves the V2 operating principle:

```text
One Extra Click
```

Operators continue to generate, edit, and save listings. They should not classify errors, tag corrections, explain changes, or approve learning events.

All learning decisions happen after the fact through an admin workflow.

## V2.1 Scope

V2.1 includes only:

- export process
- data processing design
- admin review design
- proposal format
- install approval flow

V2.1 does not include:

- admin UI implementation
- runtime code changes
- schema migrations
- automatic registry updates
- automatic resolver updates
- automatic prompt updates
- model fine-tuning
- RAG or vector memory

## Current Data Source

The source of truth is the V2.0B Supabase feedback data.

Required fields:

| Field | Purpose |
| --- | --- |
| `generated_title` | Title Listing Copilot originally produced |
| `corrected_title` | Final title saved by the operator |
| `front_image_url` | Stable front image evidence URL |
| `back_image_url` | Stable back image evidence URL, when available |
| `operator_id` | Operator who saved the correction |
| `created_at` | Timestamp when the correction was saved |

Optional fields may be included when they already exist:

| Field | Purpose |
| --- | --- |
| `id` | Stable feedback event identifier |
| `listing_session_id` | Groups records from the same generation session |
| `source_listing_id` | Links to the saved listing, if present |
| `image_batch_id` | Groups records from the same uploaded image batch |

Optional fields should improve review traceability only. They must not add any new operator burden.

## 1. Export Workflow

### Export Goal

The export step creates a reviewable snapshot of Supabase feedback records while preserving image evidence and grouping metadata.

The export is not a learning action. It is a read-only extraction from raw feedback memory.

### Fields To Export

Minimum export fields:

- `id`, if available
- `generated_title`
- `corrected_title`
- `front_image_url`
- `back_image_url`
- `operator_id`
- `created_at`

Recommended export fields when available:

- `listing_session_id`
- `source_listing_id`
- `image_batch_id`
- Supabase storage object path or stable internal image reference, if distinct from URL
- export timestamp
- export batch id

Derived export fields may be added during export:

- `created_date`, derived from `created_at`
- `created_week`, derived from `created_at`
- `operator_batch_key`, derived from operator and date
- `has_front_image`
- `has_back_image`
- `title_changed`, expected to be true for feedback rows

### Image Evidence Preservation

The export must preserve image evidence as reviewable links, not as copied screenshots pasted into notes.

Each exported row should retain:

- stable `front_image_url`
- stable `back_image_url`, when present
- enough metadata to resolve private Supabase Storage URLs through trusted internal tooling

V2.1 should not depend on short-lived signed URLs. If a private bucket requires signed access, the stored export should keep the stable storage URL or object reference, and the review tool should resolve access at review time.

The export should never discard rows only because image URLs are missing. V2.0A-compatible rows without image evidence may still be useful for text-pattern review, but should be marked lower confidence for registry or visual distinction proposals.

### Grouping Strategy

Each export should support these groupings:

| Grouping | Purpose |
| --- | --- |
| Date | Review what changed on a specific day |
| Week | Detect repeated correction patterns over a working period |
| Export batch | Preserve the exact review snapshot used for decisions |
| Operator | Spot operator-specific wording preferences or training drift |
| Image batch | Connect related front/back card assets when available |
| Listing session | Reconstruct a generation session when available |

Recommended grouping keys:

```text
created_date = YYYY-MM-DD from created_at
created_week = ISO week from created_at
export_batch_id = learning-console-YYYY-MM-DD-N
operator_batch_key = operator_id + created_date
```

The admin review workflow should treat operator grouping carefully. Operator grouping helps diagnose workflow patterns, but should not be used to blame operators for title corrections.

## 2. Processing Workflow

### Processing Goal

The processing step compares `generated_title` and `corrected_title` to detect likely change types.

Processing creates review candidates. It does not create rules.

### Title Comparison

For each exported row, V2.1 should compare:

```text
generated_title -> corrected_title
```

The comparison should identify:

- tokens removed
- tokens added
- tokens replaced
- ordering changes
- punctuation changes
- casing changes
- serial number changes
- grade wording changes

The processor should preserve both original titles exactly as stored. Any normalized comparison should be derived metadata only.

### Likely Change Detection

The processor should detect likely changes in these categories:

| Category | What To Look For |
| --- | --- |
| Product | Brand or product line corrections, such as Prizm vs Select |
| Set | Year, release, subset, checklist, or named set correction |
| Insert | Insert name added, removed, or corrected |
| Parallel | Color, refractor, wave, sparkle, mojo, raywave, or other parallel wording |
| Serial | Serial numbering added, removed, or corrected |
| Player/subject | Player, character, subject, team, or entity correction |
| Auto/relic/patch | Autograph, relic, jersey, patch, RPA, logoman, or memorabilia terms |
| Grade | PSA, BGS, CGC, SGC, grade number, qualifier, or slab wording |
| Wording normalization | Order, capitalization, punctuation, abbreviation, or marketplace title style |

Each detected change should be stored as a suggestion with a confidence note, not as a final label.

Example processed record:

```text
Likely changes:
- parallel: generated "Gold Refractor", corrected "Gold Wave Refractor"
- serial: corrected title added "/50"
- wording normalization: moved card number after set name
```

### Pattern Grouping

Processed corrections should be grouped by repeated pattern when possible:

- same generated phrase replaced by same corrected phrase
- same corrected phrase added across many records
- same product or set confusion
- same operator correction pattern
- same image batch or release batch
- same missing serial or grade wording

Pattern grouping should include evidence count, but evidence count alone should not approve a change.

### No Auto-Apply Rule

The processing step must not:

- write to registries
- modify resolver logic
- edit prompts
- create tests automatically
- change runtime behavior
- fine-tune a model
- add RAG documents

The output of processing is a review queue only.

## 3. Admin Decision Workflow

### Admin Review Goal

The admin decides whether a processed correction is useful system knowledge and where that knowledge belongs.

V2.1 review is evidence-first. Each processed correction should present image evidence before title comparison so the admin can visually inspect what the model saw before deciding whether the title correction is valid.

Each processed correction should show, in this order:

- front image URL
- back image URL, when available
- generated title
- corrected title
- evidence count for the grouped pattern
- representative evidence package, for grouped patterns
- detected likely changes
- created date
- operator
- grouped pattern, if any

### Review Candidate Format

Each candidate should prominently include:

| Field | Purpose |
| --- | --- |
| `front_image_url` | Primary front image evidence for the representative example |
| `back_image_url` | Primary back image evidence for the representative example, when available |
| `generated_title` | Representative generated title for the candidate |
| `corrected_title` | Representative corrected title for the candidate |
| `evidence_count` | Number of feedback records supporting the candidate |
| `likely_change_types` | Suggested change categories for admin review |
| `suggested_decision_options` | Allowed admin choices |
| `risk_level` | Review hint only; not approval |
| `install_recommendation_placeholder` | Explicit reminder that install requires separate approval |

Image fields should appear before title fields in admin review surfaces, Markdown summaries, and proposal drafts.

### Representative Evidence Package

Grouped patterns should include a representative evidence package so admins can inspect recurring mistakes visually.

For each grouped candidate, include up to 5 representative examples:

- front image URLs
- back image URLs, when available
- generated titles
- corrected titles
- feedback ids

The evidence package is the primary review artifact. Title diffs explain what changed, but image evidence decides whether the correction should be trusted.

Recommended structure:

```text
Evidence Package:
- Feedback ID:
  Front Image URL:
  Back Image URL:
  Generated Title:
  Corrected Title:
```

### Decision Options

Each processed correction should allow one admin decision:

| Decision | Meaning |
| --- | --- |
| Accept as registry rule | The correction reflects canonical product, set, insert, parallel, subject, or card-identity knowledge |
| Accept as resolver rule | The correction reflects deterministic logic that should resolve ambiguous or competing interpretations |
| Accept as prompt rule | The correction reflects instruction wording, output format, extraction priority, or normalization behavior |
| Accept as test case | The correction is important and image-specific, but does not justify a registry, resolver, or prompt change |
| Ignore | The correction is not useful system knowledge or is too operator-specific |
| Needs more evidence | The correction may be useful, but the current evidence is insufficient |

### Decision Guidance

Use `Accept as registry rule` when the change belongs in durable card knowledge, such as:

- known set names
- known insert names
- known parallel names
- known product hierarchy
- known player or subject identity
- known serial or memorabilia naming conventions

Use `Accept as resolver rule` when the change is a repeatable decision procedure, such as:

- prefer back-image serial evidence over front-image styling guess
- resolve Gold Wave vs Gold Refractor when wave texture is visible
- distinguish patch/autograph wording when memorabilia and auto are both present
- handle graded slab title construction from visible cert and grade text

Use `Accept as prompt rule` when the change is about model instruction or title style, such as:

- put year before product
- normalize "Autograph" to "Auto" only in specific marketplace style
- include serial numbering when visible
- avoid unsupported player assumptions
- preserve exact insert names from card text

Use `Accept as test case` when:

- the correction is important
- the correction is image-specific
- the case should become a permanent regression example
- the image evidence is useful even if no registry or resolver rule is ready
- the correction does not justify registry, resolver, or prompt changes yet

Use `Ignore` when:

- the corrected title is itself likely wrong
- the change is pure operator preference
- the evidence is missing or unusable
- the case is a one-off without system relevance
- the generated title was acceptable

Use `Needs more evidence` when:

- the image evidence is unclear
- only one row supports a risky change
- the correction could be right but needs checklist confirmation
- the pattern may be release-specific
- the proposed rule could affect many listings

### Review State

V2.1 may track review state outside the raw feedback row.

Recommended review metadata:

- `review_decision`
- `reviewed_by`
- `reviewed_at`
- `review_notes`
- `proposal_id`, when promoted to an upgrade proposal

Raw feedback fields should remain immutable.

## 4. Upgrade Proposal Format

### Proposal Goal

An upgrade proposal converts one or more admin-approved corrections into a concrete, reviewable system change.

The proposal should be specific enough for an engineer or admin to install later, but it should not install itself.

### Proposal Generation Design

Proposal generation should be evidence-first.

Each proposed upgrade should start with:

```text
Evidence Package:
- representative image URLs
- generated titles
- corrected titles
- feedback ids
```

Only after the evidence package should the proposal describe:

- proposed change
- risk
- affected files
- recommended tests

This order keeps visual evidence ahead of interpretation. The proposal should make it easy for an admin to inspect the cards before reading the suggested system change.

### Required Proposal Fields

Each proposal should include:

| Field | Purpose |
| --- | --- |
| Evidence package | Representative image URLs, generated titles, corrected titles, and feedback ids |
| Evidence count | Number of feedback records supporting the proposal |
| Proposed change | Plain-language description of the system upgrade |
| Risk level | Low, medium, or high |
| Affected files | Expected files or document areas that would change |
| Recommended tests | Tests or review checks required before installation |

Evidence package must appear before proposed change, risk, affected files, and recommended tests. Proposals should lead with what the admin can verify visually.

### Proposal Template

```text
Proposal ID:
Decision Type:

Evidence Count:

Evidence Package:
- Feedback ID:
  Front Image URL:
  Back Image URL:
  Generated Title:
  Corrected Title:

Proposed Change:

Risk Level:

Likely Change Types:

Affected Files:

Recommended Tests:

Admin Notes:

Install Status:
```

### Risk Levels

Low risk:

- wording normalization
- prompt formatting rule
- narrow test case addition
- documentation-only update
- registry addition with clear repeated evidence and low ambiguity

Medium risk:

- new resolver rule with limited blast radius
- registry update affecting a known product family
- prompt rule that changes extraction priority
- correction supported by several examples but needing targeted tests

High risk:

- broad resolver behavior change
- change that could alter many existing titles
- visual distinction with subtle image evidence
- single-example registry mutation
- any proposal that could override visible card text

High-risk proposals should default to `Needs more evidence` unless the image evidence and external checklist knowledge are strong.

### Affected Files

The proposal should name expected affected areas, not edit them automatically.

Possible affected areas:

- registry data files
- resolver logic files
- prompt templates
- title normalization utilities
- test fixtures
- regression tests
- training or review documentation
- V2 design docs

The proposal should use exact file paths when known. If paths are not yet known, it should identify the area in plain language.

### Recommended Tests

Recommended tests should match the proposal type.

Registry update tests:

- known card or set resolves to canonical name
- generated title includes the approved product, set, insert, or parallel wording
- existing neighboring registry entries do not regress

Resolver rule tests:

- ambiguous examples resolve correctly
- negative examples do not trigger the rule
- front/back image evidence priority behaves as expected

Prompt rule tests:

- title output follows the approved wording pattern
- serial, grade, auto, relic, or patch terms are included only when supported
- prior successful examples still format correctly

Documentation update tests:

- docs match approved behavior
- examples include generated and corrected title pairs
- safety boundaries remain visible

## 5. Install Workflow

### Install Goal

Installation turns an admin-approved proposal into a controlled system change.

Installation is a separate step from review. Admin approval authorizes work; it does not mutate the system automatically.

### Install Flow

```text
Admin approves proposal
  |
Proposal is assigned for installation
  |
Installer edits the appropriate system area
  |
Recommended tests are added or updated
  |
Tests and review checks run
  |
Change is documented
  |
Proposal is marked installed
```

### Approved Upgrade Types

Admin-approved upgrades may become:

- registry updates
- resolver rules
- prompt rules
- test cases
- documentation updates

### Registry Updates

Registry updates are appropriate when the proposal adds or corrects durable card knowledge.

Installation should include:

- exact registry entry or field to change
- image-backed evidence summary
- at least one positive test or review case
- neighboring examples checked for regression risk

Registry updates must never be made directly from raw feedback without admin approval.

### Resolver Rules

Resolver rules are appropriate when repeated corrections reveal deterministic logic.

Installation should include:

- rule condition
- rule output
- positive examples
- negative examples
- risk notes for similar products, parallels, or wording

Resolver rules should stay narrow until enough evidence supports broader behavior.

### Prompt Rules

Prompt rules are appropriate when corrections show the model needs clearer instruction rather than new factual knowledge.

Installation should include:

- exact prompt behavior to change
- before/after title examples
- formatting or extraction priority tests
- regression check against accepted examples

Prompt rules should not encode large factual registries.

### Test Cases

Test cases may be installed with or without registry, resolver, or prompt changes.

Useful test cases include:

- representative generated/corrected title pairs
- image-backed examples for visual distinctions
- title normalization fixtures
- negative examples that should not trigger a rule

### Documentation Updates

Documentation updates are appropriate when a correction teaches an operating principle, review policy, or title standard.

Documentation should capture:

- what was learned
- what evidence supported it
- what the system should do next time
- what remains out of scope

## 6. Safety Principles

V2.1 is a human-approved learning console, not an automatic learning system.

Safety rules:

- No automatic learning
- No automatic registry mutation
- No automatic resolver mutation
- No automatic prompt mutation
- No fine-tuning
- No RAG yet
- No vector memory
- No operator labeling burden
- Human approval required before code change
- Preserve One Extra Click in the operator workflow

Raw feedback is evidence. It is not truth by itself.

The corrected title may be wrong, incomplete, operator-specific, or marketplace-style-specific. V2.1 should treat every correction as a candidate that needs human judgment.

## Non-Goals

V2.1 does not build:

- a production admin UI
- real-time learning
- auto-approval thresholds
- correction scoring that mutates behavior
- training datasets for fine-tuning
- RAG indexes
- card-image classifiers
- operator performance dashboards
- marketplace pricing or sales analytics

## Success Criteria

V2.1 is successful if:

- Supabase feedback can be exported with title pairs and image evidence intact
- processed rows show likely change types without applying them
- admins can decide where useful corrections belong
- approved corrections become explicit upgrade proposals
- proposals include evidence, risk, affected files, and recommended tests
- installed upgrades remain human-reviewed and test-backed
- the operator workflow remains unchanged

The Learning Console should make the system smarter only after a human has reviewed the evidence and approved the path from correction to upgrade.
