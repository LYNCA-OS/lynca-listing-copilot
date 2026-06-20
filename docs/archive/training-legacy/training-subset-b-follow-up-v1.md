# Listing Copilot Training Report - Subset B Follow-Up Upgrades (V1)

## Summary

Subset B follow-up work prioritizes commercial usefulness for listing writers over perfect parallel recognition.

## Findings

eBay is a reference, not ground truth. The system should optimize for useful, editable listings rather than matching marketplace titles exactly.

Serial extraction is more valuable than exact rainbow parallel guessing. A writer can quickly correct many parallel names, but a wrong or missing serial requires opening the image, zooming, inspecting, and retyping.

Parallel recognition across categories is not realistic for the MVP. Sports, Pokemon, Marvel, UFC, and entertainment cards all use different visual and checklist taxonomies.

Operator workflow benefits more from conservative, editable titles than ambitious titles that overclaim taxonomy.

## Implementation Direction

The MVP should:

- preserve visible serial and card number whenever possible
- use conservative generic parallel wording when exact taxonomy is not text-supported
- ignore background and seller branding such as `Metaverse Cards`, `LYNCA`, `CardLadder`, eBay UI text, mats, watermarks, and seller branding
- treat visually inferred parallel/insert terms as MEDIUM unless text-supported
- downgrade missing visible serial, auto, relic, patch, grade, rookie, or 1st Bowman to LOW

## Long-Term Direction

The long-term solution is a collectible knowledge layer and correction database, not infinite prompt rules.

Resolution Layer, Cloud Brain, and Foundation should capture corrected terminology over time so the system compounds through operator review.
