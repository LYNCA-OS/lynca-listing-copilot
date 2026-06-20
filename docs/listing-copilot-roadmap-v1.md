# Listing Copilot Roadmap v1

Implementation Roadmap for Sports Card Title Standard v1

Status: Draft v1
Owner: LYNCA Listing Intelligence
Companion Documents:

- `docs/sports-card-title-standard-v1.md`
- `docs/architecture-decisions-v1.md`

## Purpose

This roadmap converts Sports Card Title Standard v1 and Architecture Decisions v1 into a phased implementation direction.

It defines:

- where Listing Copilot is today
- where the system should go next
- why the future architecture matters

No runtime behavior is required by this document. It is an implementation roadmap, not an implementation patch.

## Phase A: Current Production System

### Current Architecture

The current V1.x production system is a pragmatic title-generation pipeline:

```text
Vision / AI Output
  |
Structured Fields
  |
Post-processing Normalizer
  |
Confidence Calibration
  |
Final Listing Title
```

The AI returns both structured fields and a proposed title. The backend then applies field normalization, registry resolution, title cleanup, confidence calibration, and marketplace formatting.

Current V1.x remains patch-based by design.

### Evidence Extraction

Current extraction relies on the Vision / AI response to provide:

- year
- brand
- product
- insert
- parallel
- player
- card number
- serial number
- grade company
- grade
- auto / relic / patch / sketch / redemption flags

Strength:

The system can already capture many commercially important sports-card facts.

Limitation:

The extracted fact and the generated title are still mixed together. The system does not yet maintain a separate Evidence Layer with provenance.

### Resolver Logic

Current resolver behavior exists through targeted normalization and registry-assisted repairs.

Examples:

- `TCAR-*` can resolve to `Chrome Rookie Auto`
- `SR-*` can resolve to `Star Swatch Signatures`
- `Topps Cosmic Chrome` is protected from collapsing into `Topps Chrome`
- `Dual Signatures` is protected from becoming `Dual Auto`
- season-year conflicts can be repaired when the structured field contains the season year

Strength:

The resolver behavior handles important high-value title risks.

Limitation:

The resolver is not yet a dedicated engine. It is distributed across field normalization, registry lookups, title cleanup, and confidence calibration.

### Title Cleanup

Current cleanup performs:

- manufacturer deduplication
- product protection
- checklist/card-code suppression
- serial simplification
- auto wording normalization
- auto deduplication
- grade normalization
- grade-at-end positioning
- pragmatic semantic repairs

Strength:

The cleanup layer is commercially useful and protects many common marketplace failures.

Limitation:

Cleanup currently performs semantic work. In the future, semantic decisions should move to the Resolver Engine and cleanup should focus on formatting.

### Registry System

Current registry behavior supports known inserts, card types, and high-value terms.

Examples:

- Kaboom
- Ultraviolet
- Shadow Etch
- Explosive
- Helix
- Chrome Rookie Auto
- Star Swatch Signatures

Strength:

Registry knowledge helps protect official card types and avoid generic downgrade errors.

Limitation:

The registry is lightweight. It is not yet a cloud knowledge system with checklist memory, historical product structure, or enterprise training data.

### Grading Semantics

Current grading semantics support:

- PSA card grade only
- PSA auto grade only
- PSA card grade + auto grade
- BGS card grade only
- BGS auto grade only
- BGS card grade + auto grade
- loose auto-grade folding
- serial `/10` preservation

Strength:

The system now distinguishes card grade from autograph grade in major PSA/BGS cases.

Limitation:

The current schema does not include separate `card_grade`, `auto_grade`, or `grade_type` fields. Grade semantics are inferred from title text and existing grade fields.

## Phase B: Evidence Engine

### Goal

Separate extracted facts from generated titles.

Future concept:

```json
{
  "value": "",
  "source": ""
}
```

Example evidence fields:

- year
- manufacturer
- product
- player
- card_type
- parallel
- serial
- attributes
- grade

### Why Provenance Matters

Provenance allows Listing Copilot to know where a fact came from.

Examples:

- `2025-26` from card back product text
- `2025` from PSA label shorthand
- `01/25` from card front serial
- `Dual Signatures` from printed card type
- `Gold Refractor` from visual inference only

Without provenance, the system can only guess which evidence should win when sources conflict.

### Evidence Hierarchy

Future evidence hierarchy:

```text
Card Design Evidence
  >
Grading Slab Evidence
  >
Registry / Historical Database
  >
Visual Guess
```

Card Design Evidence includes:

- card front
- card back
- printed product information
- printed card type
- printed serial number

Grading Slab Evidence includes:

- PSA label
- BGS label
- SGC label
- CGC label

Registry / Historical Database includes:

- checklist knowledge
- product structures
- known official card types
- SSP knowledge

Visual Guess includes:

- color inference
- foil pattern inference
- visual-only parallel guess

No implementation is required in this phase document.

## Phase C: Resolver Engine

### Goal

Conflict resolution based on evidence hierarchy.

The Resolver Engine should decide which structured fact is authoritative before the title is rendered.

Resolution priority:

```text
Card Design
  >
Grading Slab
  >
Registry
  >
Visual Guess
```

### Season Year Conflicts

Example:

Card back:

`2025-26 Topps Chrome Basketball`

PSA label:

`2025`

Resolved year:

`2025-26`

### Product Conflicts

Example:

Card/product evidence:

`Topps Cosmic Chrome`

Model or shorthand title:

`Topps Chrome`

Resolved product:

`Topps Cosmic Chrome`

### Card Type Conflicts

Example:

Printed card type:

`Dual Signatures`

Model guess:

`Dual Auto`

Resolved card type:

`Dual Signatures`

### Resolver Responsibilities

The Resolver Engine should own:

- conflict resolution
- official card type protection
- product identity protection
- season-year override
- serial authority
- card grade vs auto grade semantics
- visual-inference downgrade decisions

No implementation is required in this phase document.

## Phase D: Grammar Engine

### Goal

Render title from structured evidence.

Canonical grammar:

```text
Year
  ->
Manufacturer
  ->
Product
  ->
Player(s)
  ->
Card Type
  ->
Parallel
  ->
Serial
  ->
Attributes
  ->
Grade
```

### Current Patch Approach

Current V1.x starts with an AI-generated title and repairs it.

Examples of current patch behavior:

- move grade to the end
- dedupe manufacturer terms
- recover missing manufacturer
- protect `Topps Cosmic Chrome`
- suppress checklist codes
- preserve serials
- normalize PSA/BGS grade wording
- insert RC when structured evidence supports it

This approach is useful for V1.x because it improves marketplace quality without schema migration.

### Future Renderer Approach

The future Grammar Engine should render from resolved fields:

```text
resolved.year
resolved.manufacturer
resolved.product
resolved.player
resolved.card_type
resolved.parallel
resolved.serial
resolved.attributes
resolved.grade
```

The renderer should not infer semantics.

It should only apply ordering, spacing, field omission rules, and title-length strategy.

No implementation is required in this phase document.

## Phase E: Future Database Layer

### Goal

Create a future cloud knowledge system that improves resolution and consistency across Listing Copilot.

The database layer should support knowledge that is too large, too dynamic, or too historical for hardcoded prompt rules.

### Example Knowledge Domains

SSP knowledge:

- known SSP designs
- case-hit sets
- super short print indicators

Card type history:

- official insert names
- product-era terminology
- autograph subset naming
- relic / patch subset naming

Checklist memory:

- card codes
- player-to-card mappings
- product-year mappings
- serial parallel mappings

Enterprise training data:

- operator corrections
- accepted final titles
- rejected title patterns
- high-confidence examples
- repeated conflict resolutions

### Long-Term Role

The future database layer should feed:

```text
Evidence Engine
Resolver Engine
Grammar Engine
Confidence Calibration
```

No implementation is required in this phase document.

## Roadmap Summary

Phase A describes the current production system.

Phase B separates facts from generated titles.

Phase C resolves conflicts using evidence hierarchy.

Phase D renders titles from structured evidence.

Phase E introduces a future knowledge database for scalable card intelligence.

Together, these phases move Listing Copilot from patch-heavy title repair toward a structured, evidence-driven title engine.
