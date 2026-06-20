# Training Index v1

Consolidated operating summary for Listing Copilot QA learnings.

Status: Draft v1
Owner: LYNCA Listing Intelligence

## Purpose

This document reduces training entropy.

Raw subset reports remain evidence records. This index captures repeated patterns that should guide future Evidence, Resolver, Grammar Engine, Cleanup, and Knowledge Database work.

## Registry Expansion

Repeated across Subsets B-F.

The largest current bottleneck is collectible knowledge: official card types, insert names, product-family terms, and known set structures.

Recurring targets:

- Ultraviolet
- Planet Earth
- Planet Mercury
- Planet Portraits
- Planetary Pursuit
- Planetary Pursuit Sun
- Alien Autographs
- Instinct
- Re-Entry
- Apprentice Ink
- Game Floor
- Kaleidoscopic
- Rated Rookie
- Rookie Threads
- Rookie Materials
- Dual Jerseys Prime
- Dual Patch
- Horizontal Patch Auto
- Vertical Patch Auto
- Jumbo Material
- Next Episode
- 2010 NBA Champions
- Silver Bar

Direction:

Future registry infrastructure should support families, aliases, classification, product scope, commercial importance, and default title-inclusion behavior.

## Parallel Classification

Repeated across Subsets B-E.

The system often recognizes the card identity but loses exact parallel language or collapses specific variants into generic terms.

Recurring misses:

- Gold
- Silver
- Purple
- Gold Vinyl
- Black Gold
- Orange Raywave
- Starfractor
- Gold Refractor
- Red Refractor
- Orange Geometric Refractor

Direction:

Parallel terms should be preserved when supported by visible evidence or reliable registry knowledge. Specific named parallels should not collapse into generic color terms.

## RC Preservation

Repeated across Subsets A, C, D, E, and F.

`RC` remains commercially meaningful and should remain visible whenever card, slab, or reliable evidence supports rookie status.

Important distinction:

- `RC` is an attribute.
- Official rookie card type names are card types and must also be preserved.

Examples:

- Rated Rookie
- Rookie Threads
- Rookie Materials
- Chrome Rookie Auto

Direction:

Do not collapse official rookie card types into generic `RC`. Preserve both when both are title-worthy.

## Serial Recovery

Repeated across Subsets A-D and earlier serial-priority notes.

Serial numbers are Tier 1 commercial evidence because they directly affect value, searchability, and operator review cost.

Examples:

- `01/25`
- `04/10`
- `06/10`
- `31/50`
- `33/100`
- `/10`

Direction:

Serial extraction and preservation should remain a high-priority evidence problem. Checklist/card-code suppression must never remove true serial numbers.

## Multi-player Logic

Introduced in Subset A and strengthened in Subset F.

Dual-subject relic and autograph cards need stronger handling.

The system should preserve:

- both player names
- original player ordering when supported
- dual relic / patch / jersey / autograph terminology
- official multi-player card types
- serial number

Examples:

- Dual Logoman Autographs
- Dual Patch
- Dual Jersey
- Dual Relic
- Dual Auto

Direction:

Future Resolver logic should distinguish generic multi-player descriptions from official card type names.

## Commercial Importance

Repeated in Subsets C and F.

Registry recognition does not always mean title inclusion.

The system may know a term internally but decide not to display it if it does not improve marketplace title quality.

Examples:

- `Bowman Rookie Refresh` may be recognized from `BRR-1` but may not always need title inclusion.
- `On-Card Auto` is commercially useful wording but not necessarily a protected registry card type.

Direction:

Future title generation should include a commercial importance ranking step:

```text
Registry Knowledge
-> Commercial Importance Ranking
-> Final Title
```

## Ground Truth vs Marketplace Title

Established in Subset B.

Marketplace titles are references, not ground truth.

Future training should compare:

```text
Image
-> Copilot Output
-> Marketplace Title
-> Ground Truth
-> Root Cause
```

Direction:

Do not train the system to copy seller mistakes. Ground truth should come from card evidence, slab evidence, registry knowledge, and validated product knowledge.

## Grading Semantics

Covered by the Sports Card Title Standard and V1.2.x grading work.

The system must understand what was graded:

- card condition grade only
- autograph grade only
- card condition grade + autograph grade

Direction:

Final grade formatting should preserve card and autograph grade semantics, especially for PSA/BGS slash-grade output.

Examples:

- `PSA 9/10`
- `PSA Auth/10`
- `BGS 9.5/10`
- `BGS AUTO 10`
