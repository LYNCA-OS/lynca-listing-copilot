# Subset C Training Report

Date: 2026-06-20

## Overview

Subset C primarily stress-tested:

- Registry Coverage
- Official Card Type Recognition
- Parallel Classification
- RC Preservation
- Commercial Importance Ranking

Compared to previous subsets:

Subset A focused on Grammar.

Subset B focused on Taxonomy and Registry.

Subset C focused on determining which recognized information should actually appear in the final marketplace title.

## Asset 1

Joel Embiid

Marketplace Title:

`2017-18 Panini Flawless Joel Embiid Horizontal Patch Auto Gold 06/10`

Copilot:

`2017-18 Panini Flawless Joel Embiid Patch Auto 06/10`

Finding:

Horizontal Patch Auto should be treated as an official Card Type.

Gold should be treated as Parallel.

06/10 should be preserved as Serial.

Future Registry target:

- Horizontal Patch Auto
- Vertical Patch Auto

Layer:

- Registry
- Card Type Recognition

## Asset 2

Kon Knueppel

Marketplace Title:

```text
2025-26 Topps Chrome Cosmic
Kon Knueppel RC
Re-Entry
Orange Raywave
/25
SSP
```

Copilot:

`Orange Refractor`

Finding:

Orange Raywave was incorrectly generalized into Orange Refractor.

Re-Entry should be recognized as an official Card Type.

Layer:

- Evidence
- Registry

Priority:

Parallel Classification

## Asset 3

Cooper Flagg

Marketplace Title:

```text
2025-26 Bowman Chrome
#BRR-1
Cooper Flagg
RC
```

Copilot:

`Bowman Rookie Refresh`

Finding:

Copilot correctly resolved:

`BRR-1 -> Bowman Rookie Refresh`

However:

Bowman Rookie Refresh may not have enough commercial value to justify title inclusion.

Important distinction:

Registry Recognition != Title Inclusion

Future principle:

The system may recognize information internally without necessarily displaying it in the final title.

Layer:

Commercial Importance Ranking

Result:

Copilot Correct

## Asset 4

Cade Cunningham

Marketplace Title:

```text
2024-25 Panini National Treasures
Auto
15/75
Encased
```

Copilot:

```text
2024-25 Panini National Treasures
Cade Cunningham Auto
15/75
```

Finding:

Copilot preferred.

Encased is not considered a core identity field.

Layer:

Pass

## Asset 5

Shai Gilgeous-Alexander

Marketplace Title:

```text
2026 Topps Cosmic
Shai Gilgeous-Alexander
Variation Auto
Orange
20/25
```

Copilot:

```text
Orange Auto
20/25
```

Finding:

Variation appears to be seller wording rather than a meaningful official identity term.

Orange and 20/25 are the important marketplace fields.

Layer:

Evidence

Priority:

Parallel Classification

## Asset 6

LeBron James

Marketplace Title:

```text
2025 Topps Chrome
LeBron James
Ultra Violet SSP
```

Copilot:

`Ultraviolet`

Finding:

Ultraviolet should be treated as an official Card Type.

SSP is an attribute.

Card Type should have priority.

Layer:

Registry

Result:

Copilot Preferred

## Asset 7

Amen Thompson

Marketplace Title:

```text
2023-24 Panini Crown Royale
Amen Thompson
RC
Kaboom
SSP
```

Copilot:

```text
Kaboom
Amen Thompson
```

Finding:

Kaboom recognized correctly.

RC missing.

This is another RC Preservation failure.

Layer:

RC Preservation

## Asset 8

Stephen Curry

Marketplace Title:

```text
2024 Leaf Metal
Crystal Red
1/1
```

Copilot:

```text
Autographed Pre-Production Proof
Crystal Red
1/1
```

Finding:

Copilot preferred.

Pre-Production Proof is official card-type information.

Crystal Red functions as a parallel.

Official Card Type should have priority over marketplace simplification.

Layer:

Registry

Result:

Copilot Preferred

## Major Discovery 1

Commercial Importance Ranking Is Emerging

Subset C introduced a new problem category.

The system increasingly knows what the card is.

The remaining question becomes:

Which information should actually appear in the final title?

Examples:

Internal Knowledge:

- BRR-1
- Bowman Rookie Refresh

May not necessarily belong in title output.

Examples:

- RC
- Kaboom
- Ultraviolet
- Crystal Red
- Pre-Production Proof

Likely belong in title output.

Future concept:

```text
Registry Knowledge
  |
Commercial Importance Filter
  |
Final Title
```

## Major Discovery 2

Registry Continues To Improve

Successful Registry Examples:

- Kaboom
- Ultraviolet
- Bowman Rookie Refresh
- Pre-Production Proof

Future Registry Targets:

- Re-Entry
- Horizontal Patch Auto
- Vertical Patch Auto

## Major Discovery 3

RC Preservation Remains A Systemic Issue

Subset A

Subset B

Subset C

all exposed RC visibility issues.

Examples:

- Amen Thompson

RC should remain visible whenever supported by evidence.

Priority:

Tier 1

## Major Discovery 4

Parallel Classification Still Needs Work

Examples:

- Orange Raywave
- Orange Refractor
- Gold
- Crystal Red

These remain common classification mistakes.

Layer:

Evidence

## Priority List

### Priority 1

Serial Recovery

Still the highest-value missing field category.

### Priority 2

RC Preservation

Recurring issue across all subsets.

### Priority 3

Registry Expansion

Targets:

- Re-Entry
- Horizontal Patch Auto
- Vertical Patch Auto
- Ultraviolet
- Pre-Production Proof

### Priority 4

Parallel Classification

Targets:

- Orange Raywave
- Orange Refractor
- Gold
- Crystal Red

### Priority 5

Commercial Importance Ranking

Future concept.

Determine:

What should be recognized internally

vs

What should be displayed in the final title.

## Final Conclusion

Subset A:

Grammar

Subset B:

Taxonomy

Subset C:

Registry + Commercial Importance

Current bottlenecks are increasingly:

- Serial Recovery
- RC Preservation
- Registry Coverage
- Parallel Classification
- Commercial Importance Ranking

rather than title grammar generation.

The system is gradually evolving from title generation toward collectible knowledge infrastructure.
