# Listing Copilot Training Report - Subset A Retest Confidence Philosophy (V1)

## Conclusion

The largest current risk is no longer parallel accuracy. The P0 risk is confidence philosophy.

The system must treat confidence as commercial listing readiness, not model self-confidence.

## Problem

The system marked nearly all results as HIGH even when outputs contained:

- wrong year
- wrong serial
- wrong parallel
- missing insert
- missing SSP
- missing Wave, Shimmer, Pattern, or Foil
- missing auto
- missing key collectible terminology

This can cause operators to over-trust bad outputs and create systematic listing errors.

## New Principle

HIGH does not mean "the model generated a title."

HIGH means a professional listing operator can likely publish this title without review.

For collectible listings, under-confidence is acceptable. Over-confidence is dangerous.

## Confidence Definitions

### HIGH

Use HIGH only when core collectible fields are supported by strong evidence, no major uncertainty exists, no obvious high-value field is missing, and the title is likely publish-ready.

Expected rate: 10-20%.

Examples:

- PSA/BGS/CGC label cases
- clear auto cases
- clear grade cases
- clear serial cases
- clear parallel confirmed by label or card text

### MEDIUM

Use MEDIUM when core identity is correct and the listing is usable, but collectible terminology may require review.

Expected rate: 60-70%.

Examples:

- parallel inferred visually
- insert inferred visually
- pattern uncertain
- serial partially uncertain
- team, player, and year are correct

### LOW

Use LOW when high-value information is likely missing, core fields conflict, or significant uncertainty exists.

Expected rate: 10-20%.

Examples:

- wrong year
- missing serial
- missing auto
- missing insert
- missing SSP
- wrong parallel family
- reasoning contradicts title

## Immediate Downgrade Rules

Do not allow HIGH when:

- Wave, Shimmer, Pattern, or Foil classification is visual-only
- Insert identification is visual-only
- SSP is not confirmed
- Serial appears incomplete
- Year is not supported by strong evidence
- Parallel family is uncertain
- Auto is visible but omitted
- Serial is visible but omitted
- Reasoning says resolved but the title omits the field

## Subset A Examples

- Dasan Hill: MEDIUM because Blue Wave vs Wave Refractor remains uncertain.
- Wei-En Lin: LOW because year, parallel, and serial mismatched.
- Ethan Dorchies: LOW because Aqua Shimmer was not recognized and serial was incorrect.
- Dauri Fernandez: MEDIUM because Yellow Wave is likely but visual-only.
- Michael Harris II: MEDIUM because Orange Pattern Foil was not fully resolved.

## Goal

The system should become more conservative. Trustworthiness is more important than optimism.

## Implementation Rule

Prompt instructions alone are not enough. The API should run a final confidence audit after model output.

The audit should only downgrade, never upgrade.

Downgrade HIGH to MEDIUM when:

- evidence is not label/card-text/back-text supported
- unresolved fields exist
- reasoning contains uncertainty language
- parallel or insert classification is visual-only
- Wave, Shimmer, Pattern, Foil, Refractor, Disco, Pulsar, or Prizm terminology is not evidence-backed

Downgrade to LOW when:

- title omits a high-value field present in extracted fields
- year conflicts with the title
- serial, auto, grade, card number, relic, patch, sketch, redemption, or 1/1 is extracted but missing from the title
- reasoning explicitly mentions wrong/missing year, serial, auto, grade, card number, or contradiction

Downgrade HIGH to MEDIUM, not LOW, when:

- Tier 1 fields are complete but parallel terminology is generic
- Tier 1 fields are complete but insert or parallel classification requires operator review
- the title preserves serial number but uses a best-effort rainbow parallel term

The main failure mode to avoid is HIGH + wrong.
