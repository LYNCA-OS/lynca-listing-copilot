# Prompt Modernization Plan v1

Modernization plan for `prompts/listing-intelligence-v1.md`

Status: Draft v1
Owner: LYNCA Listing Intelligence
Companion Documents:

- `docs/sports-card-title-standard-v1.md`
- `docs/architecture-decisions-v1.md`
- `docs/listing-copilot-roadmap-v1.md`

## Purpose

This document plans how the current Listing Intelligence prompt should evolve as Listing Copilot moves from patch-heavy title repair toward an evidence-driven title system.

The goal is to reduce prompt complexity over time while preserving output quality.

This document does not require prompt, code, schema, or runtime changes.

## Current Prompt Role

`prompts/listing-intelligence-v1.md` currently acts as several systems at once:

- vision extraction guide
- evidence prioritization guide
- lightweight resolver instructions
- category-specific taxonomy guide
- title grammar guide
- cleanup rule guide
- confidence policy guide
- JSON output contract

This is appropriate for V1.x, but it should become simpler as future system layers take over resolver and grammar responsibilities.

## 1. Prompt Responsibilities That Should Remain In Prompt

The prompt should continue to own instructions that depend on model perception, image reading, and operator-facing explanation.

Keep in prompt:

- Extract observable facts from images.
- Avoid hallucinating unseen fields.
- Ignore background/seller branding.
- Preserve visible player, character, team, product, serial, grade, auto, patch, relic, and other collectible facts.
- Mark uncertain or ambiguous facts in `unresolved`.
- Return the required JSON shape.
- Explain uncertainty in `reason`.
- Preserve category-specific visual reading guidance for sports, Pokemon, Marvel, sketch, and redemption cards.
- Enforce that multiple unrelated cards / lot images remain unsupported in V1.x.
- Maintain confidence philosophy as operator-readiness guidance until confidence calibration is fully system-owned.

Prompt should become best at:

```text
Look carefully.
Extract facts.
Explain uncertainty.
Return structured JSON.
```

## 2. Rules That Should Move To Future Resolver Engine

The Resolver Engine should own semantic decisions and conflict resolution.

Move from prompt to Resolver over time:

- Card Design Evidence vs Grading Slab Evidence vs Registry vs Visual Guess priority.
- Season-year override rules.
- Product identity protection.
- Official card type protection.
- Registry/card-code resolution.
- Card Type vs Parallel vs Variation classification.
- SSP / Case Hit / high-value insert classification.
- Serial conflict resolution.
- Grading semantics:
  - card grade vs auto grade
  - card-grade-only
  - auto-grade-only
  - PSA/BGS slash format
- Deciding when visual-only parallel inference is allowed.
- Deciding when a registry mapping can override a model guess.

Future Resolver input:

```text
raw extracted evidence
registry knowledge
source hierarchy
```

Future Resolver output:

```text
resolved title fields
resolution notes
remaining unresolved issues
```

## 3. Rules That Should Move To Future Grammar Engine

The Grammar Engine should own title rendering from resolved fields.

Move from prompt to Grammar Engine over time:

- Canonical sports card title order:
  `Year -> Manufacturer -> Product -> Player(s) -> Card Type -> Parallel -> Serial -> Attributes -> Grade`
- Grade placement at the end.
- Player(s) before Card Type.
- Attribute placement:
  - RC
  - SSP
  - Case Hit
  - JPN
  - Korea
- Serial placement.
- Multi-player formatting.
- Title length strategy.
- Product/manufacturer omission rules when space is tight.
- Avoiding duplicate field output.
- Choosing whether low-priority terms such as team should appear.

Future Grammar Engine should not infer facts.

It should render already-resolved facts.

## 4. Rules That Should Remain In Cleanup Layer

Cleanup should eventually become formatting-focused.

Keep in Cleanup Layer:

- whitespace normalization
- duplicate word cleanup
- simple serial formatting:
  - `#31/150` -> `31/150`
  - `Serial 31/150` -> `31/150`
  - `Numbered 31/150` -> `31/150`
- checklist/card-number suppression after Resolver has used the code
- final title trimming
- final duplicate manufacturer cleanup
- final duplicate auto cleanup

Allowed in V1.x cleanup:

- pragmatic semantic repairs

Per `architecture-decisions-v1.md`, V1.x cleanup may keep semantic patches until Resolver and Grammar Engine exist.

Future cleanup should not decide:

- which year wins
- whether a term is Card Type or Parallel
- whether a product is `Topps Cosmic Chrome`
- whether `PSA 9 Auto 10` means `PSA 9/10`

Those should move upstream.

## 5. Prompt Sections Currently Outdated

### Architecture

Current prompt architecture:

```text
Vision Engine
Knowledge Registry / Resolution Engine
Collectible Category Logic
Title Engine
Confidence Audit
```

This is directionally correct, but it does not match the newer roadmap language:

```text
Evidence
Resolver
Grammar Engine
Cleanup
Final Title
```

Modernization priority: Medium

### Evidence Hierarchy

Current prompt says general resolution priority starts with PSA/BGS/CGC label text.

New standard says:

```text
Card Design Evidence
  >
Grading Slab Evidence
  >
Registry / Historical Database
  >
Visual Guess
```

This is the most important prompt-standard conflict.

Modernization priority: High

### Serial Evidence Priority

Current prompt says serial extraction priority is:

```text
PSA/BGS/CGC label > card front text > card back text
```

New standard says printed card design evidence is highest authority, including printed serial number.

Modernization priority: High

### Title Grammar

Current prompt title order places Official Card Type / Insert before Subject.

New standard places Player(s) before Card Type:

```text
Year -> Manufacturer -> Product -> Player(s) -> Card Type -> Parallel -> Serial -> Attributes -> Grade
```

Modernization priority: High

### Attributes

Current prompt treats Auto, Patch, and Relic as title terms/Tier 1 fields.

ADR-004 says:

- RC, SSP, Case Hit, JPN, Korea are Attributes.
- Auto, Patch, Relic belong to Card Type.

Modernization priority: Medium

### Grading Semantics

Current prompt tells the model to extract grade company and grade, but it does not fully express:

- card grade vs auto grade
- auto-grade-only semantics
- card-grade-only semantics
- PSA/BGS slash grade output

Modernization priority: High

### Cleanup Responsibilities

Current prompt asks the model to perform many cleanup and grammar decisions.

ADR-006 allows semantic cleanup in V1.x, but future architecture should move semantics to Resolver and formatting to Cleanup.

Modernization priority: Medium

## 6. Prompt Sections Still Correct

The following prompt areas remain useful and aligned:

- The objective is commercially useful listing titles, not generic card identification.
- The model should extract structured facts before writing a title.
- The model should not hallucinate.
- Background/seller branding must be ignored.
- Serial accuracy is commercially important.
- Advanced parallel classification should not displace Tier 1 facts.
- Visual-only guesses should not override stronger evidence.
- Official card types should be protected.
- Product hierarchy should be protected.
- Checklist/card codes should be extracted but usually omitted from final title.
- Confidence should mean listing readiness, not model confidence.
- HIGH should be conservative.
- MEDIUM should be acceptable for usable but review-needed titles.
- FAILED should cover lots, unreadable images, and unsafe identification.
- Output must remain valid JSON in the current V1.x schema.

## 7. Migration Priority

### High Priority

These should be addressed first when prompt modernization begins:

- Align evidence hierarchy with Sports Card Title Standard v1.
- Change serial evidence priority so printed card serial has highest authority.
- Align sports title grammar order with the standard.
- Add explicit PSA/BGS grading semantics:
  - card grade + auto grade
  - card grade only
  - auto grade only
- Reduce prompt responsibility for resolving official card types once Resolver exists.

### Medium Priority

These should follow after high-priority alignment:

- Rename conceptual `brand` language to `manufacturer` in explanatory text while keeping V1.x schema unchanged.
- Clarify Card Type vs Parallel vs Variation using ADR-003.
- Clarify Attributes using ADR-004.
- Move product protection and registry mapping instructions into Resolver documentation once implemented.
- Move title-length strategy into Grammar Engine documentation once implemented.

### Low Priority

These can wait:

- Reduce long lists of examples once registry/database coverage improves.
- Split non-sports category guidance into smaller category prompt modules.
- Remove V1.x patch wording after the future architecture exists.
- Update legacy naming such as `Metaverse Listing Intelligence Engine` if product naming changes.

## Recommended End State

The future prompt should be shorter and narrower.

Target prompt role:

```text
You are the visual evidence extractor.
Read the images carefully.
Return structured facts.
Flag uncertainty.
Do not resolve conflicts beyond what is visible.
```

Target system-owned layers:

```text
Evidence Engine
  |
Resolver Engine
  |
Grammar Engine
  |
Cleanup Layer
  |
Final Title
```

This preserves output quality while making behavior easier to test, debug, and evolve.
