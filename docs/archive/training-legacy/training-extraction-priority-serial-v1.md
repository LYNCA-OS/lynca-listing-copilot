# Listing Copilot Training Report - Serial Priority Philosophy (V1)

## Conclusion

Subset A showed that the system was overweighting advanced parallel identification.

For commercial listing workflows, serial number extraction has higher business value than fine-grained rainbow parallel classification.

## Why

Parallel errors are usually cheap to correct. A writer can often change `Fuchsia Wave` to `Pink Shimmer` in seconds.

Serial errors are expensive. If `137/199` is missing or becomes `13/199` or `137/99`, the writer must open the image, zoom, inspect manually, and retype.

## MVP Philosophy

Do not optimize for perfect parallel recognition.

Optimize for maximum listing utility.

## Field Priority System

### Tier 1 - Critical

- Player
- Serial number
- Grade
- Auto
- Patch
- Relic
- Card number
- 1/1 indicator

Missing or incorrect Tier 1 fields should heavily impact confidence.

### Tier 2 - Important

- Team
- Product
- Insert
- Rookie
- 1st Bowman

### Tier 3 - Best Effort

- Rainbow parallel classification
- Wave
- Shimmer
- Pattern
- Foil
- Lava
- Velocity
- Disco
- Pulsar
- Mojo

## Implementation Rule

If a tradeoff exists between extracting serial number and classifying parallel, prioritize serial number every time.

Prefer `Orange Refractor 02/25` over `Orange Pattern Foil` with missing serial.

Prefer `Purple Parallel 137/199` over `Fuchsia Wave Refractor` without confidence.

## Confidence Alignment

HIGH confidence should require Tier 1 fields correctly resolved, not advanced parallel confidence.

Acceptable HIGH:

- Player, serial, auto, and grade are visible and resolved, even if parallel is generic.

Not HIGH:

- Fuchsia Wave is confidently guessed but serial is missing.

## Architecture Alignment

Vision Layer should primarily optimize for OCR accuracy, serial accuracy, label accuracy, and card number accuracy.

Resolution Layer, Cloud Brain, and Foundation can gradually improve parallel taxonomy, checklist mapping, and rainbow classification over time.

Vision = Facts.

Cloud Brain = Knowledge.

Foundation = Institutional Memory.

The goal is to reduce writer review time, not maximize parallel naming accuracy.
