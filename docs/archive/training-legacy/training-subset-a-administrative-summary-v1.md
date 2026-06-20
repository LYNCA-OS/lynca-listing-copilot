# Listing Copilot - Subset A Training Administrative Summary (V1)

Date: 2026-05-30  
Phase: MVP Validation & Prompt Training  
Dataset: Subset A  
Sample Size: 21 Card Assets / 42 Images  
Objective: Validate end-to-end Listing Copilot workflow and identify highest-ROI improvements before broader deployment.

## Executive Summary

Subset A successfully validated the core architecture:

```text
Vision/OCR
↓
Structured Facts
↓
Resolution
↓
Title Generation
↓
Human Review
```

The testing process confirmed:

1. Vision/OCR is not the primary bottleneck.
2. Resolution logic is now the dominant source of error.
3. Confidence calibration is operationally more important than marginal title accuracy improvements.
4. Serial number extraction delivers higher workflow value than advanced parallel classification.
5. Human-in-the-loop review remains a core part of the MVP workflow.

## Major Findings

### Finding 1 - Vision Is Not The Bottleneck

Most failures were not caused by player recognition, OCR extraction, or card identification.

Failures were primarily caused by:

- parallel classification
- insert resolution
- taxonomy interpretation

Examples:

- Fuchsia Wave vs Pink Shimmer
- Aqua Shimmer vs Blue Wave
- Orange Pattern Foil vs Orange Parallel

Conclusion:

```text
Vision Layer != Primary Problem
Resolution Layer = Primary Problem
```

### Finding 2 - eBay Is Reference, Not Ground Truth

eBay titles were used for comparison only.

The project does not optimize for matching eBay titles. The project optimizes for commercially useful listings.

Example: `Minnesota Twins` may be omitted by an eBay seller but still provide valuable search and catalog information.

Future improvements should not blindly follow marketplace conventions.

### Finding 3 - Confidence Philosophy Was Incorrect

Original behavior:

```text
Nearly every asset -> HIGH
```

This created operational risk because writers may trust incorrect outputs and skip verification.

New philosophy:

- HIGH = commercially ready, not model feels confident
- MEDIUM = usable draft, human review recommended
- LOW = missing critical information, manual correction required
- FAILED = insufficient evidence, no listing recommendation

### Finding 4 - Confidence Must Be Conservative

False HIGH is more dangerous than false MEDIUM.

Reason:

```text
False HIGH -> Writer trusts bad data
False MEDIUM -> Writer verifies data
```

Operationally:

```text
Conservative Confidence > Aggressive Confidence
```

### Finding 5 - Serial Number > Parallel Classification

This became the most important operational insight from Subset A.

Initial assumption:

```text
Parallel accuracy = highest priority
```

Real-world observation:

Writers can quickly correct `Pink Shimmer` to `Fuchsia Wave` in seconds.

Writers cannot quickly correct `137/199` to missing, `13/199`, or another wrong serial without opening images and manually inspecting cards.

New extraction hierarchy:

Tier 1 - Critical:

- Player
- Serial Number
- Grade
- Auto
- Patch
- Relic
- Card Number
- 1/1 Indicator

Tier 2 - Important:

- Team
- Product
- Insert
- Rookie
- 1st Bowman

Tier 3 - Best Effort:

- Wave
- Shimmer
- Pattern
- Foil
- Velocity
- Disco
- Mojo
- Pulsar

Future Vision optimization should prioritize OCR, serial detection, label detection, and card number detection before advanced rainbow taxonomy.

## UX Findings

### Asset Preview Modal

New functionality added:

```text
Click Thumbnail
↓
Open Modal
↓
Switch Front / Back
↓
Review
↓
Copy Title
```

Result: significantly reduces writer verification friction.

This feature aligns directly with the intended human-review workflow.

## Strategic Conclusion

Subset A confirms that Listing Copilot is not evolving into an AI Title Generator.

It is evolving into a Collectible Listing Intelligence System.

Future moat construction should focus on:

```text
Model
+
Cloud Brain
+
Resolution Layer
+
Foundation
```

rather than model upgrades alone.

## Long-Term Architecture

```text
Upload
↓
Vision / OCR
↓
Structured Facts
↓
Resolution Layer
↓
Cloud Brain
↓
Foundation Knowledge
↓
Title Engine
↓
Confidence Engine
↓
Human Review
↓
Corrections
↓
Cloud Brain
↓
Foundation
```

This creates a compounding loop:

```text
Usage
↓
Correction
↓
Learning
↓
Better Usage
```

## Subset A Outcome

Status: PASSED

Primary achievements:

- Confidence philosophy established
- Confidence audit implemented
- Serial-first extraction philosophy established
- Asset preview modal implemented
- Resolution Layer identified as next major improvement area

## Next Phase

Subset B Validation should focus on:

- cross-category robustness
- confidence calibration
- serial extraction reliability
- resolution-layer learning

The next phase should not optimize around pure title matching accuracy.
