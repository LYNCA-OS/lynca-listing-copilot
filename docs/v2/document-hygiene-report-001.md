# Document Hygiene Report #001

Status: Documentation Hygiene Pass Complete
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

## Scope

This pass audited the top-level `docs/v2/*.md` Learning Cycle #001 documentation set and created a navigation index.

No files were deleted. No production prompt, runtime code, registry, resolver, or deployment changes were made.

## Summary

| Metric | Count |
| --- | ---: |
| Existing top-level `docs/v2/*.md` files audited | 46 |
| Existing nested fixture docs noted | 1 |
| New hygiene docs created | 2 |
| Files deleted | 0 |
| Historical files moved | 0 |

## Category Counts

Counts below cover the 46 existing top-level docs audited before this pass created `index.md` and this report.

| Category | Count |
| --- | ---: |
| A. Active Operating Documents | 11 |
| B. Historical Learning Records | 16 |
| C. Evaluation Infrastructure | 9 |
| D. Candidate / Rejected Experiments | 6 |
| E. Archived Design Documents | 4 |

## Active Docs

Active Operating Documents are the current reference set for continuing V2 work:

- `feedback-loop-v2.md`
- `image-evidence-v2b.md`
- `implementation-plan-v2.md`
- `knowledge-metrics-v1.md`
- `knowledge-promotion-framework-v1.md`
- `learning-console-v2.1.md`
- `learning-review-runbook.md`
- `v2-scope-lock.md`
- `visual-registry-v1.md`
- `visual-test-fixture-library-v1.md`
- `visual-verification-layer-v1.md`

## Archived Docs

Archived Design Documents are preserved historical design/planning records that should not be treated as the current operating surface:

- `database-schema-v2.md`
- `supabase-integration-plan.md`
- `ui-wireframe-v2.md`
- `visual-review-vercel-execution-plan-001.md`

## Duplicate Candidates

No exact duplicate documents were found, but several documents are near-duplicates or staged versions of the same decision thread:

| Document group | Assessment |
| --- | --- |
| `prompt-upgrade-simulation-001.md`, `prompt-upgrade-candidate-001.md`, `prompt-candidate-001-rejection-note.md` | Same candidate lifecycle: simulation, candidate patch, rejection decision. Keep all three as an experiment record. |
| `visual-review-report-001.md`, `visual-review-report-001b.md`, `visual-review-001b-summary.md` | Same prototype lifecycle: failed local run, successful follow-up run, summary. Keep all three, but treat `001b` and summary as the useful current evidence. |
| `fixture-review-001.md`, `fixture-set-002-candidates.md`, `fixture-taxonomy-v1.md` | Related fixture-planning thread, not duplicates. Keep together as fixture/evaluation support. |

## Superseded Docs

The following docs appear superseded by later records but should be preserved for history:

| Superseded document | Superseded by | Reason |
| --- | --- | --- |
| `visual-review-report-001.md` | `visual-review-report-001b.md` and `visual-review-001b-summary.md` | The first report captured a failed GPT Vision run; #001B captured successful visual review output. |
| `evaluation-runner-plan-001.md` | `evaluation-run-001-smoke-results.md` and `evaluation-run-001-smoke-candidate-001-results.md` | The plan was followed by actual smoke-run artifacts. |
| `prompt-upgrade-simulation-001.md` | `prompt-upgrade-candidate-001.md` and `prompt-candidate-001-rejection-note.md` | The simulation became a candidate and was then rejected. |
| `prompt-upgrade-candidate-001.md` | `prompt-candidate-001-rejection-note.md` | Candidate #001 should not be installed. |
| `image-evidence-audit-001.md` | `visual-review-report-001b.md` | The audit showed prior reviews lacked visual verification; #001B demonstrated an actual visual review path. |
| `visual-review-vercel-execution-plan-001.md` | `visual-review-report-001b.md` | The execution plan is less central after a successful review artifact exists. |

## Move Decision

No historical documents were moved in this pass.

Reason: many documents contain relative cross-document references using the current top-level `docs/v2/` layout. Because this hygiene pass was instructed not to rewrite document contents, moving those files would break internal links and make the archive harder to use.

Folders were prepared for the recommended long-term structure:

- `docs/v2/archive/`
- `docs/v2/evaluation/`
- `docs/v2/experiments/`
- `docs/v2/fixtures/`
- `docs/v2/learning/`

The existing `docs/v2/fixtures/visual-fixture-set-001.md` file is already in the intended fixture area.

## Recommended Long-Term Structure

Future docs should be placed directly into the matching folder when created:

```text
docs/v2/
  index.md
  document-hygiene-report-001.md
  active/
    operating docs that define current process and policy
  archive/
    superseded design docs and old execution plans
  evaluation/
    datasets, benchmark plans, smoke results, scoring checkpoints
  experiments/
    prompt candidates, simulations, rejection notes, promotion simulations
  fixtures/
    visual fixtures, fixture reviews, fixture taxonomies
  learning/
    review cycles, dataset snapshots, retrospectives, attribution analysis
```

For the existing Learning Cycle #001 set, defer physical moves until a follow-up pass is allowed to update internal links.

## Recommended Follow-Up

1. Add `docs/v2/active/` only if the team wants to physically separate current operating docs from the historical archive.
2. In a future link-safe migration, move files into folders and update all relative references in the same commit.
3. Keep `docs/v2/index.md` as the source of truth during the transition.
4. Treat Candidate #001 as rejected and avoid using it as an install source.
5. Keep benchmark/evaluation artifacts separate from prompt experiments so future promotion decisions start from evidence, not candidate enthusiasm.

## Not Changed

This pass did not modify runtime code, prompts, registry data, resolver logic, deployment configuration, benchmark outputs, or historical document contents.
