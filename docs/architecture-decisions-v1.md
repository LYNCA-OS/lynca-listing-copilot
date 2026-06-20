# Architecture Decisions v1

Listing Copilot Architecture Decision Record

Status: Draft v1
Owner: LYNCA Listing Intelligence
Companion Spec: `docs/sports-card-title-standard-v1.md`

## Purpose

This document captures approved architecture decisions that complement Sports Card Title Standard v1.

These decisions define the boundary between current V1.x implementation constraints and future Evidence Engine / Grammar Engine evolution.

## ADR-001: Schema

Decision:

No schema migration in V1.x.

Current fields remain:

- year
- brand
- product
- insert
- parallel
- player
- serial
- grade

Future Evidence Engine may redesign schema.

## ADR-002: Evidence Provenance

Decision:

Future feature only.

Future concept:

```json
{
  "value": "",
  "source": ""
}
```

Current V1.x:

No provenance tracking required.

## ADR-003: Parallel vs Card Type vs Variation

### Refractor Parallel

Examples:

- Gold Refractor
- Orange Refractor
- Blue Refractor
- Green Refractor
- Black Refractor
- Wave Refractor
- Gold Wave Refractor
- Blue Wave Refractor

Classification:

Parallel

### Official Card Type

Examples:

- Kaboom
- Downtown
- Color Blast
- Propulsion
- Red Propulsion
- Ultraviolet
- Shadow Etch
- Explosive
- Helix
- Dual Signatures
- Duo Logoman Autographs
- Star Swatch Signatures
- Chrome Rookie Auto

Classification:

Card Type

Definition:

Publisher-defined official card design names.

### Variation

Examples:

- Vertical
- Horizontal
- World Series 2024
- Image Variations
- Special Event Variations

Classification:

Variation

Definition:

Occasional version descriptors.

Not Parallel.

Not Card Type.

## ADR-004: Attributes

Attributes:

- RC
- SSP
- Case Hit
- JPN
- Korea

Classification:

Attributes

Not Attributes:

- Auto
- Patch
- Relic

These belong to Card Type.

## ADR-005: Grammar Engine

Decision:

Deferred.

Target future architecture:

```text
Evidence
  |
Resolver
  |
Grammar Engine
  |
Cleanup
  |
Final Title
```

Current V1.x remains patch-based.

## ADR-006: Cleanup Responsibilities

Decision:

Current Cleanup Layer is allowed to perform:

- Formatting
- Pragmatic Semantic Repairs

Future:

Resolver owns semantics.

Cleanup owns formatting.

## ADR-007: Grading Semantics

Decision:

Approved.

Future possible fields:

- card_grade
- auto_grade
- grade_type

No schema changes required in V1.x.
