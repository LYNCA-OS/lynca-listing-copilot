# QA Findings: 2026-06

Monthly summary of Listing Copilot training Subsets A-F.

Status: Draft v1
Owner: LYNCA Listing Intelligence

## Overview

The June 2026 QA cycle moved Listing Copilot from title-format repair toward collectible knowledge architecture.

The main lesson:

Grammar is increasingly stable. The highest-value improvements now come from registry coverage, evidence extraction, serial recovery, RC preservation, and commercial importance ranking.

## Subset A: Grammar

Subset A focused on real-world title quality after V1.2.x and Foundation v1.

Key findings:

- Grammar improved but still depended on evidence quality.
- Serial preservation was a high-priority evidence issue.
- RC visibility needed stronger preservation.
- Official card type recognition needed registry support.

Primary layers:

- Evidence
- Resolver
- Grammar
- Cleanup

## Subset B: Taxonomy

Subset B showed that marketplace titles are not always ground truth.

Key findings:

- Training should distinguish marketplace title from validated ground truth.
- Registry coverage became a clear bottleneck.
- Serial recovery remained weak.
- Card type vs parallel taxonomy was generally working.

Primary layers:

- Evidence
- Resolver
- Knowledge Database

## Subset C: Registry + Commercial Importance

Subset C focused on which recognized information should appear in final marketplace titles.

Key findings:

- Registry recognition does not always equal title inclusion.
- Commercial importance ranking is needed.
- RC preservation remained systemic.
- Parallel classification still needed work.

Primary layers:

- Registry
- Resolver
- Commercial Importance

## Subset D: Official Card Type Recognition

Subset D emphasized official card type and insert protection.

Key findings:

- Official card type / insert recognition became a main bottleneck.
- Registry expansion had high ROI.
- Parallel precision still needed work.
- RC preservation continued to matter.

Primary layers:

- Registry
- Official Card Type Recognition
- Parallel Classification

## Subset E: Modern Topps Chrome Knowledge Layer

Subset E stress-tested modern Topps Chrome and Cosmic Chrome knowledge.

Key findings:

- Modern Topps Chrome registry support is becoming its own knowledge layer.
- Parallel preservation still needs work.
- Patch recognition remains inconsistent.
- RC preservation recurred.

Primary layers:

- Registry
- Parallel Classification
- Patch Recognition
- RC Preservation

## Subset F: Registry Family Recognition

Subset F showed that single registry terms are not enough.

Key findings:

- Registry terms increasingly belong to families.
- Official rookie card types must be protected.
- Registry recognition does not always equal title inclusion.
- Multi-player relic cards need better handling.

Primary layers:

- Registry Family Recognition
- Official Card Type Protection
- Multi-player Logic
- Commercial Importance

## Overall Priority Stack

1. Registry Expansion
2. Serial Recovery
3. RC Preservation
4. Parallel Classification
5. Official Card Type Protection
6. Multi-player Logic
7. Commercial Importance Ranking
8. Grammar

## Product Conclusion

Listing Copilot is evolving from a title-generation tool into a collectible knowledge system.

Future work should preserve raw subset reports as evidence, but operational planning should happen through:

- `training-index-v1.md`
- `registry-candidates-v1.md`
- future implementation tickets or roadmap updates
