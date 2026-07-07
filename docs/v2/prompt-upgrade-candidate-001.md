# Prompt Upgrade Candidate #001

Status: Candidate Only, Not Installed
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

## Scope

This candidate is a reversible prompt-only preservation upgrade for evaluation against Smoke Benchmark rows 1-25.

It includes only:

- Serial preservation
- Product retention
- Set retention

It explicitly excludes:

- Sapphire inference
- SSP / SP / case-hit inference
- named parallel inference
- checklist logic
- year normalization

No production prompt, runtime behavior, registry, resolver, deployment, or benchmark data is modified by this candidate file.

## Candidate Prompt Text

```text
Preservation-only candidate rules:

1. Serial preservation

Preserve serial numbers exactly as provided by explicit source evidence or visibly read from the card, slab, or label. Do not invent serial numbers, change denominators, remove leading digits, duplicate serial numbers, or normalize serial formatting unless the source evidence explicitly shows the corrected value.

If a serial number is unclear, conflicting, partially obscured, or not visible, leave it unresolved or omit it from the title. Do not guess a numerator or denominator.

2. Product retention

Preserve manufacturer and product-family words when they are present in the input, slab text, card text, back text, filename evidence, resolution hint, or visible evidence. Do not drop evidence-backed brand or product terms such as Topps, Bowman, Panini, Upper Deck, Leaf, Skybox, Chrome, Prizm, Optic, Finest, Donruss, Fleer, Cosmic Chrome, Metal, Masterwork, Immaculate, Certified, or similar product identifiers merely to shorten the title.

Do not create product terms that are not explicitly supported by evidence.

3. Set retention

Keep set, subset, edition, insert line, and product-line names as first-class title fields when they are explicitly supplied by source evidence. Preserve specific set or product-line wording near the front of the title after year/manufacturer/product when it fits normal eBay title grammar.

Do not replace a specific evidence-backed set or product-line name with a generic sport, team, card, or product word.

4. Exclusions

These rules are preservation rules only. They must not cause new inference of Sapphire, SSP, SP, case-hit status, named parallels, checklist-dependent terms, or year/season normalization. Use those terms only when explicit source evidence supplies the exact language.
```

## Rollback

Rollback is immediate: stop injecting this candidate file in the evaluation runner. Because this file is not installed into the production prompt, no production rollback is required.
