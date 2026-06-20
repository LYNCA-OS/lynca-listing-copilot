# Listing Copilot Training Note - Subset C Case Summary (V1)

## Source Note

This memo records human-reviewed Subset C case study findings.

Codex did not inspect the original Subset C images for this implementation. Treat these notes as operator annotations and engineering rules, not as automated visual conclusions.

## Problems Observed

Subset C reinforced that the system can usually see enough visible facts, but it still needs a clearer knowledge layer and confidence audit.

The key risks were:

- Classic case-hit or insert terms such as Kaboom and Ultraviolet can be underweighted and reduced to ordinary rookie/base listings.
- Insert/card codes such as `UV-16`, `SE-28`, `BRR-1`, and `IMP-OTI` are strong registry signals and should influence insert resolution.
- Complex rainbow terminology can be over-guessed from foil visuals.
- Clear PSA/BGS/CGC label cases should not be over-downgraded when label evidence supports the core identity.
- `01/01` and other serial formats must be preserved because they save operators more time than exact parallel taxonomy.
- Multi-subject cards need Duo / Dual / Pairing / Partnership wording when supported by text or registry evidence.
- Pokemon illustrator names remain metadata and must not replace trainer, character, or card subject identity.

## Vision Is Not The Primary Bottleneck

The practical MVP bottleneck is not simply whether the model can read the card. The more important issue is whether visible facts are turned into market terminology and commercially useful eBay titles.

The V2 architecture separates responsibilities:

1. Vision Extraction: extract visible facts.
2. Knowledge Registry: resolve high-frequency insert, case-hit, product identity, and card code signals.
3. Confidence Audit: decide whether the output is commercially listable.

## Serial And Card Number Priority

Serial number and card number accuracy are higher value than exact parallel taxonomy.

Operators can often correct a parallel word quickly. They cannot safely correct a missing or wrong serial without opening the image, zooming, and manually retyping.

Rule:

`serial/card number correct + generic parallel` is preferred over `complex parallel guess + missing serial`.

## Insert Registry V1 Scope

Initial registry coverage:

- Kaboom
- Ultraviolet
- Shadow Etch
- Future Script
- Imperial Ink
- Regalia Relics
- All-Star Game
- Power Partnership
- Bowman Rookie Refresh
- Fantasma
- Cactus Jack
- Finest Autographs
- Finest Performance
- Chrome Autograph Variation

Initial card code mappings:

- `UV` -> Ultraviolet
- `SE` -> Shadow Etch
- `BRR` -> Bowman Rookie Refresh
- `IMP` -> Imperial Ink

These terms should be treated as insert / case-hit / product identity, not ordinary parallels.

## Confidence V3

HIGH:

Ready to copy into eBay with no meaningful correction. Requires strong evidence from PSA/BGS/CGC label, card text, or back text, with no conflict in subject, year/product, serial, grade, auto, or other high-value fields.

MEDIUM:

Usable title draft. Core identity is clear and serial/auto/grade/card number are mostly usable, but insert, case-hit, variant, or parallel terminology needs operator review.

LOW:

Requires meaningful manual correction. Use when core identity, subject, year/product, grade, serial, auto, or another high-value field is missing or conflicting.

FAILED:

No safe listing title can be formed, or front/back pairing is wrong, or the image is not readable enough.

Special rule:

1/1, SSP, case-hit, and high-value insert cards should not become LOW only because variant taxonomy needs review. If core identity and serial/card number are clear, MEDIUM is usually the right conservative route.
