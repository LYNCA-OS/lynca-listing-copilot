# Listing Copilot Training Report - Subset A Retest Confidence Calibration (V1)

## P0 Finding

Subset A Retest discovered a new P0 issue:

```text
Confidence Calibration Failure
```

The system improved title generation, but confidence levels became distorted. The system marked nearly all outputs as HIGH even when titles contained obvious commercial listing errors.

This is a program-layer and evaluation-layer problem, not only a title wording problem.

## Examples

The system returned HIGH despite errors such as:

- `2026` identified as `2025`
- Wave Refractor identified as Blue Refractor
- Aqua Shimmer identified as Blue Wave
- Fuchsia Wave identified as Purple Refractor
- Gold Foil, Orange Pattern, Spotlight, or SSP information missing
- Serial incomplete or wrong, such as `137/199` becoming `/99`
- Title missing high-value fields while still marked HIGH

## Core Diagnosis

The current system treats confidence as if it means:

```text
The model feels good about the answer.
```

That is wrong.

For Listing Copilot, confidence must mean:

```text
This listing is commercially safe to copy directly into eBay.
```

The system is allowed to be wrong during MVP, but it cannot be wrong and confident.

## New Confidence Rules

### HIGH

HIGH can only be used when:

- PSA/BGS/CGC label clearly supports the core fields; or
- card text/back text clearly supports the core fields; and
- year, player, brand/product, key variant/parallel/insert, serial, grade, auto, patch, relic, or other high-value fields have no obvious conflict or omission.

HIGH means ready for commercial listing.

### MEDIUM

Use this when:

- player, brand, year, and serial are mostly correct; but
- parallel, insert, pattern, SSP, or exact variant needs review; or
- the classification is visual-only and not supported by label/card text.

### LOW

Use this when:

- year has a conflict
- serial is incomplete
- parallel or insert is guessed
- reference/card text shows key transaction information missing from output
- reasoning says `clearly resolved` but title omits a core field

### FAILED

Use FAILED only for unreadable, multi-card lot, severe blur, or unsafe identification.

## Reasoning Consistency Rule

Confidence must match reasoning.

If reasoning says:

- `parallel visible`
- `serial visible`
- `insert visible`
- `all key fields`

then the title must include those fields.

Otherwise confidence cannot be HIGH.

## Uncertainty Language

Do not say:

```text
All key fields are clearly visible and resolved.
```

when any high-value field is uncertain.

Say:

```text
Core identity fields are visible; parallel or insert classification requires review.
```

## Downgrade Triggers

Downgrade from HIGH when any of these occur:

- missing serial when numbered card is visible
- missing auto when autograph is visible
- missing or wrong year
- missing Wave, Shimmer, Pattern, Foil, SSP, or Insert
- color-only output when pattern-specific reference is visible
- visual guess without text evidence
- title omits a visible high-value field
- reasoning claims a field is resolved but title omits it

## Expected Behavior

- Clean PSA/BGS/CGC label cases can be HIGH.
- Basic correct but missing parallel/insert should be MEDIUM.
- Wrong year or missing high-value variant should be LOW or FAILED, never HIGH.

## Final Principle

Confidence does not represent model confidence.

Confidence represents commercial listing readiness.

The system now needs a self-audit layer before finalizing confidence.
