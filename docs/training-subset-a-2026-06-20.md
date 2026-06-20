# Training Report: Subset A QA Findings 2026-06-20

Status: Training report
Owner: LYNCA Listing Intelligence
Related foundation docs:

- `docs/foundation-v1.md`
- `docs/sports-card-title-standard-v1.md`
- `docs/architecture-decisions-v1.md`
- `docs/listing-copilot-roadmap-v1.md`

## 1. Overview

Subset A compares:

- Copilot output
- actual Metaverse eBay listing title
- Sports Card Title Standard v1

This report documents real-world QA findings after V1.2.x and Foundation v1.

The goal is not to immediately patch every case. The goal is to preserve observed failure patterns as training material for future Evidence, Resolver, Grammar Engine, Cleanup, and Knowledge Database improvements.

## 2. Case Summary Table

| Asset | Card | Copilot output issue | Expected direction | Root cause layer |
| --- | --- | --- | --- | --- |
| 1 | Cooper Flagg | Current output acceptable; season year may need stronger support. | Prefer `2025-26` when card back supports season year. | Evidence / Resolver |
| 2 | Ace Bailey | Refractor parallel and serial precision have room for improvement. | Preserve actual detected parallel and serial with stronger precision. | Evidence |
| 3 | Stephen Curry Red Propulsion | `Topps Cosmic Chrome` not visible on card face; product identity needs support beyond face text. | Reinforce Red Propulsion / SSP and product identity through web/search support or future knowledge database. | Knowledge Database / Resolver |
| 4 | Shaquille O'Neal / Anfernee Hardaway | Serial `01/25` missing. | Preserve visible serial in final title. | Evidence |
| 5 | Jayson Tatum | RC missing even though RC appears on card/slab. | Preserve RC when visible or slab-supported. | Evidence / Grammar |
| 6 | PJ Washington Jr / Tyler Herro | Expected card type is `Dual Logoman Autographs`; current recognition needs stronger evidence/resolution. | Resolve two Logoman patches + two autographs to official card type. | Evidence / Resolver / Registry |
| 7 | Stephen Curry Ultraviolet | Redundant Ultraviolet wording. | Normalize `Ultra Violet` / `Ultraviolet` to one official card type. | Cleanup / Registry |
| 8 | Kevin Durant Star Swatch | Serial `04/10` missing. | Preserve visible serial in final title. | Evidence |

## 3. Individual Cases

### Asset 1: Cooper Flagg

Finding:

- Current output acceptable.
- Future improvement: prefer `2025-26` if card back supports season year.

Expected direction:

- Card/back season product year should override PSA shorthand or copyright year.

Layer:

- Evidence
- Resolver

### Asset 2: Ace Bailey

Finding:

- Refractor parallel and serial precision have room for improvement.
- Other title structure acceptable.

Expected direction:

- Continue preserving strong title grammar.
- Improve parallel and serial evidence extraction when visible.

Layer:

- Evidence

### Asset 3: Stephen Curry Red Propulsion

Finding:

- `Topps Cosmic Chrome` is not visible on card face.
- Requires better web/search support or future cloud knowledge database.
- Red Propulsion / SSP knowledge should be reinforced.

Expected direction:

- Treat Red Propulsion / SSP product knowledge as registry or future database-backed resolution.
- Avoid relying only on card-face text when product identity requires known checklist/product context.

Layer:

- Knowledge Database
- Resolver

### Asset 4: Shaquille O'Neal / Anfernee Hardaway

Finding:

- Serial `01/25` missing.

Expected direction:

- Serial is Tier 1 evidence.
- If visible on card front or back, it must appear in the final title.

Layer:

- Evidence

### Asset 5: Jayson Tatum

Finding:

- RC missing even though RC appears on card/slab.

Expected direction:

- RC visibility needs stronger preservation.
- If card or slab indicates RC, final title should include RC unless an official card type already represents it clearly.

Layer:

- Evidence
- Grammar

### Asset 6: PJ Washington Jr / Tyler Herro

Finding:

- Expected card type: `Dual Logoman Autographs`.
- Evidence: two Logoman patches + two autographs.

Expected direction:

- Resolve two Logoman patches plus two autographs into the official card type.
- Reinforce registry-backed examples for high-value multi-player autograph patch cards.

Layer:

- Evidence
- Resolver
- Registry

### Asset 7: Stephen Curry Ultraviolet

Finding:

- Redundant Ultraviolet wording.
- Normalize `Ultra Violet` / `Ultraviolet` to one official card type.

Expected direction:

- Preserve official card type once.
- Avoid duplicate wording in final title.

Layer:

- Cleanup
- Registry

### Asset 8: Kevin Durant Star Swatch

Finding:

- Serial `04/10` missing.

Expected direction:

- Serial is Tier 1 evidence.
- Preserve visible serial in final title.

Layer:

- Evidence

## 4. Product Conclusions

- Most Subset A issues are Evidence / Resolver / Knowledge Database problems.
- Grammar is mostly stable.
- Serial detection remains a high-priority evidence problem.
- RC visibility still needs stronger preservation.
- Official card type recognition is improving but needs more registry-backed examples.

## 5. Future Actions

Do not immediately patch all cases.

Use this report as training material for future resolver/evidence improvements.

Priority order:

1. Serial recovery
2. RC visibility
3. Official card type recognition
4. Ultraviolet normalization
5. Future knowledge database for product identity such as `Topps Cosmic Chrome`
