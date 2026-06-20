# Listing Copilot Foundation v1

Top-level map of the Listing Copilot foundation documents.

Status: Draft v1
Owner: LYNCA Listing Intelligence

## Purpose

This document gives future engineers and future Codex sessions a single entry point for understanding Listing Copilot.

It explains:

- what the product is
- how the current production system works
- which documents are source-of-truth
- what architecture the project is moving toward
- how current implementation differs from future architecture

## 1. What Listing Copilot Is

Listing Copilot is an internal LYNCA webtool for turning collectible card images into copy-paste-ready English eBay listing titles.

It is not:

- an eBay auto-listing system
- an eBay API integration
- a general OCR tool
- a grading tool
- a full card database

It is:

- a listing-title assistant
- an evidence-aware card intelligence workflow
- a commercial title quality system
- an internal operator productivity tool

The product goal is to generate commercially accurate titles using structured evidence, marketplace conventions, and conservative confidence calibration.

## 2. Current Architecture

Current V1.x architecture:

```text
Image Upload
  |
Prompt / Vision Model
  |
Structured JSON + Draft Title
  |
Backend Normalization
  |
Cleanup / Pragmatic Semantic Repairs
  |
Confidence Calibration
  |
Final Title
```

The system currently relies on:

- prompt instructions
- OpenAI vision/title generation
- local registry knowledge
- backend title post-processing
- confidence audit logic
- operator review

## 3. Current Production State

The current production system supports:

- single-image mode
- front/back pair mode
- batch generated title summary
- individual title copy
- copy-all title workflow
- confidence states:
  - HIGH
  - MEDIUM
  - LOW
  - FAILED
- filename fallback when `OPENAI_API_KEY` is unavailable

Core technical areas:

- `app/` contains the browser UI.
- `api/` contains auth/session/title-generation endpoints.
- `prompts/` contains the active model prompt and category examples.
- `lib/` contains local registry knowledge.
- `scripts/` contains local validation scripts.
- `docs/` contains product, architecture, roadmap, and training documentation.

Current V1.x implementation remains patch-based by approved decision.

## 4. Source-of-Truth Documents

### `spec-v1.md`

Original MVP product specification.

Use for:

- initial product context
- workflow background
- original system boundaries

Do not treat it as the newest sports-card title authority when it conflicts with newer foundation docs.

### `sports-card-title-standard-v1.md`

Current source of truth for sports card title quality.

Use for:

- evidence layer expectations
- evidence hierarchy
- canonical sports title grammar
- cleanup standards
- PSA/BGS grading semantics

This is the highest-level standard for sports-card title generation.

### `architecture-decisions-v1.md`

Approved architecture decisions for V1.x and future migration.

Use for:

- schema boundaries
- evidence provenance decision
- parallel vs card type vs variation classification
- attributes classification
- grammar engine deferral
- cleanup responsibility boundaries
- grading semantics direction

### `listing-copilot-roadmap-v1.md`

Implementation roadmap from current system to future architecture.

Use for:

- current production-state explanation
- Evidence Engine roadmap
- Resolver Engine roadmap
- Grammar Engine roadmap
- future knowledge database direction

### `prompt-modernization-plan-v1.md`

Plan for reducing prompt complexity over time.

Use for:

- what should remain in prompt
- what should move to Resolver
- what should move to Grammar Engine
- what should stay in Cleanup
- prompt sections that are outdated
- prompt migration priority

## 5. Current Architectural Philosophy

Target architecture:

```text
Evidence
  |
Resolver
  |
Grammar
  |
Cleanup
  |
Final Title
```

Meaning:

- Evidence extracts facts.
- Resolver decides which facts win.
- Grammar renders the title from resolved facts.
- Cleanup formats the final string.
- Final Title is copy-paste-ready for the operator.

This architecture separates seeing, deciding, writing, and formatting.

## 6. Current Implementation Reality

Current implementation reality:

```text
Prompt
  |
Cleanup
  |
Final Title
```

In V1.x, the prompt still carries many responsibilities:

- visual extraction
- evidence prioritization
- partial conflict resolution
- taxonomy guidance
- title grammar
- cleanup hints
- confidence philosophy

The backend cleanup layer also performs pragmatic semantic repairs:

- product protection
- official card type protection
- manufacturer recovery
- serial preservation
- auto dedupe
- PSA/BGS grading normalization
- grade-at-end formatting

This is acceptable for V1.x, but it is not the long-term architecture.

## 7. Future Migration Path

### Phase A: Current Production

Keep the current product stable.

Focus:

- title quality
- confidence safety
- operator workflow
- validation coverage
- documentation clarity

### Phase B: Evidence Engine

Separate extracted facts from generated titles.

Future evidence concept:

```json
{
  "value": "",
  "source": ""
}
```

Purpose:

- track where facts came from
- enable source-aware conflict resolution
- reduce prompt ambiguity

### Phase C: Resolver Engine

Resolve conflicts using hierarchy:

```text
Card Design
  >
Grading Slab
  >
Registry
  >
Visual Guess
```

Purpose:

- choose correct season year
- protect product identity
- protect official card type
- resolve card type vs parallel vs variation
- resolve grading semantics
- preserve authoritative serials

### Phase D: Grammar Engine

Render titles from resolved evidence.

Canonical sports grammar:

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

Purpose:

- replace title repair with deterministic rendering
- reduce prompt complexity
- make output easier to test
- make title behavior easier to reason about

### Phase E: Knowledge Database

Build a future cloud knowledge system.

Possible knowledge domains:

- SSP knowledge
- card type history
- checklist memory
- product-year mappings
- serial parallel mappings
- enterprise training data
- operator corrections

Purpose:

- reduce hardcoded rules
- improve long-term consistency
- support broader card categories and products
- make Listing Copilot smarter over time

## Operating Principle

V1.x should remain stable and useful.

Future work should move complexity out of the prompt and regex cleanup layer into structured, testable system layers.

The foundation documents define that path.
