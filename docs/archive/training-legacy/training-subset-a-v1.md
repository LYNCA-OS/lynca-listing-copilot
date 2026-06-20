# Listing Copilot Training Report - Subset A (V1)

## Objective

Evaluate the current Listing Copilot pipeline against real-world collectible cards.

Current pipeline:

```text
Image
-> Vision/OCR
-> JSON Extraction
-> Resolution Layer
-> Title Generator
```

Approximate sample size: 20 cards.

Coverage:

- Bowman Chrome Baseball
- Bowman Inserts
- Bowman Autos
- PSA Slabs
- UFC
- Panini Select Euroleague
- Dual Autos
- Numbered Cards
- Parallel Variants

## Executive Summary

The current system can already see the card.

The current bottleneck is no longer Vision.

The primary bottlenecks are:

1. Resolution Layer
2. Collectible Taxonomy Layer
3. Title Prioritization Layer

Vision/OCR performance is significantly stronger than expected.

## Layer Assessment

### Vision / OCR

Status: PASS

Current strengths:

- Player identification
- Team identification
- Brand identification
- Product identification
- Auto detection
- Dual Auto detection
- Grade detection
- PSA label extraction
- Serial number extraction
- Card number extraction

Observed performance is already sufficient for MVP.

Recommendation: do not spend engineering resources replacing Vision models at this stage.

### JSON Extraction

Status: PASS

The system is generally extracting the correct information.

Most failures observed later in the pipeline are not OCR failures.

Recommendation: no major architecture changes required.

### Resolution Layer

Status: NEEDS IMPROVEMENT

Most failures originate here.

The system often sees information correctly but cannot resolve it into collectible-industry terminology.

Examples:

- UI Goku -> Son Goku Ultra Instinct
- Wave Pattern -> not resolved
- Spotlight -> not resolved
- Gold Wave -> not resolved

Recommendation: introduce a dedicated Resolution Layer with taxonomy lookup, product-specific mappings, parallel mappings, insert mappings, player alias mappings, and franchise/team mappings.

## Collectible Taxonomy Findings

This is currently the largest weakness in the system.

### Parallel Recognition

Observed weakness:

The system frequently misses:

- Gold Wave
- Yellow Wave
- Orange Pattern
- Aqua Shimmer
- Fuchsia Wave
- Red Logo
- Gold Foil

Important observation:

The system often recognizes color. It does not reliably recognize pattern.

Example:

- Correct: Yellow Wave
- Output: Yellow

Meaning: color recognition is stronger than pattern recognition.

Recommendation: create a Parallel Taxonomy Database.

Example groups:

```json
{
  "wave": [],
  "shimmer": [],
  "lava": [],
  "speckle": [],
  "mojo": [],
  "mini_diamond": [],
  "pattern_foil": []
}
```

Future training should focus heavily on parallel classification.

### Insert Recognition

Observed weakness:

The system often misses insert names.

Examples:

- Spotlight
- Power Chords
- Draft Pick Pairings

Important observation:

Insert cards represent a separate knowledge category from parallels.

Recommendation: build an Insert Taxonomy Layer.

Examples:

```json
{
  "spotlight": {},
  "power_chords": {},
  "draft_pick_pairings": {}
}
```

Insert recognition should be evaluated independently from parallel recognition.

## PSA Label Findings

Major discovery:

PSA labels dramatically improve recognition quality.

Examples:

- Gold Disco Prizm
- Pink Pulsar
- Grade
- Auto
- Product

When PSA label exists, recognition accuracy increases significantly.

Recommendation: use an evidence ranking system.

Priority:

1. PSA Label
2. Card Text
3. Visual Pattern Guessing

Never override PSA label information with visual guesses.

## Title Generator Findings

This is now one of the most important upgrade targets.

Many failures are not recognition failures. They are title construction failures.

Examples:

The system includes:

- Team
- Product repetition

while excluding:

- Auto
- Serial
- Parallel

These omitted fields are more important for market value and searchability.

## Title Priority Framework

Tier 1 - Highest:

- Player
- Auto
- Dual Auto
- Patch
- Grade
- Parallel
- Serial

Tier 2:

- Insert
- Rookie
- 1st Bowman

Tier 3:

- Team
- Product
- League

Tier 4:

- Card Number
- Redundant Product Terms

Recommendation: title generation should prioritize Tier 1 information first.

## Important Evaluation Rule Change

eBay titles are not ground truth.

eBay titles are only market references.

Future evaluation should use:

1. Information Accuracy
2. Listing Completeness
3. Commercial Searchability
4. Reference Listing Similarity

Do not evaluate only by exact eBay title match.

Reason:

Many Copilot outputs are actually better than the reference eBay listing. Including team names can improve searchability when space permits.

## Engineering Priorities

P0:

- Title Prioritization Layer

P1:

- Parallel Taxonomy Layer
- Insert Taxonomy Layer

P2:

- Resolution Layer Expansion

P3:

- Additional Vision Improvements

Current evidence suggests Vision is not the bottleneck.

## Final Conclusion

Current estimated layer performance:

- Vision/OCR: 80-90%
- Resolution Layer: 40-60%
- Title Prioritization: 40-60%

The project has successfully demonstrated card understanding capability.

The next phase should focus on:

```text
Collectible Knowledge Layer
+
Resolution Layer
+
Commercial Listing Logic
```

Subset A proves that the system already can see cards. The next phase is making the system understand cards and know which information is most worth writing into the title.
