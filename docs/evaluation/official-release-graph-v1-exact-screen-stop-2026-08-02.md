# official_release_graph_v1 exact coverage screen — STOP

Date: 2026-08-02  
Decision: `STOP_INSUFFICIENT_EXACT_OFFICIAL_COVERAGE`

## Decision

The local directory looks large, but the role-compatible exact join is too sparse to justify runtime work or a paid confirmation run.

- Required gate: at least 8 uniquely supported cards.
- Observed across the available fresh150 and completed paid105 candidates: 5 unique assets.
- Therefore: keep this as an evaluation-only asset audit. Do not add a production resolver, hard rejection, value generation, cloud service, vector lookup, OCR, or second model call.

The opposite hypothesis — that 124 official source manifests plus 697 official vocabulary rows already form a useful release graph — is rejected by measured candidate coverage.

## Authority contract

The screen only accepts a normalized whole-value equality when the candidate's declared role matches the official edge:

- `identity` or `identity_hypothesis` → `release`, `product`, or `insert`;
- `finish` → `print_finish` or `rarity`.

Subject, year, grade, and number matches are context only and are deliberately excluded from coverage. Counting them would inflate fresh150 coverage from 5 cards to 65 cards by treating sparse manifest examples as release knowledge.

The graph cannot generate a value, mutate a candidate, reject an unsupported candidate, or write to runtime state. Absence is always `UNKNOWN`, never negative evidence.

## Source-versioned graph

- 10 local official manifest files, 124 source declarations.
- One versioned vocabulary snapshot generated from 43,681 source rows.
- 809 normalized terms and 978 provenance-bearing edges:
  - 626 insert edges;
  - 190 product edges;
  - 124 release edges;
  - 25 rarity edges;
  - 13 print-finish edges.
- Edge origins: 696 official-vocabulary, 158 manifest-record, 124 manifest-source.

Every input file is SHA-256 fingerprinted by the reproducible screen. No marketplace title, writer title, vector seed, OCR output, generic constraint snapshot, or external lookup is admitted.

## Data-quality findings

- 60 normalized terms map to more than one semantic role. Candidate-role compatibility is required before support is counted.
- 24 unsafe edges are excluded: 23 one-character rarity codes and one official-vocabulary insert term equal to `null`.
- One `OFFICIAL_PARSE_REVIEW_REQUIRED` record is excluded.
- Required records are sparse acceptance examples, not exhaustive catalogs. Their absence cannot support a contradiction or hard reject.

## Coverage result

| Cohort | Screened cards | UNIQUE | CONFLICT | UNKNOWN | Potential win proxy | Absent-reference risk proxy |
|---|---:|---:|---:|---:|---:|---:|
| fresh150 candidate-expression-v4 | 150 | 5 | 0 | 145 | 5 | 0 |
| paid105 residual-v1 completed treatment | 51 | 0 | 0 | 51 | 0 | 0 |

Fresh150's five matches are three product and two insert matches; three came from identity hypotheses and two from identity facts. None of the 58 finish facts had exact official finish support. The five supported phrases occur in the reference but not in the canonical control title, so they are plausible recovery opportunities, not measured F1 wins.

The completed paid105 treatment currently contains 23 residual identity candidates and 3 finish candidates, but none has a role-compatible exact official match.

## Interpretation

This is an asset-coverage failure, not evidence that exact official support is harmful. The graph is clean enough to remain a candidate for later evaluation, but it is not yet a positive production asset:

- fresh150 card coverage is 3.3% (5/150);
- identity/finish coverage is especially sparse;
- zero false-positive proxies among five matches has no statistical power;
- removing `Checklist`, using substring/fuzzy matching, or inventing aliases could raise apparent coverage, but would no longer be this exact, non-generative authority test.

The next admissible step is to expand source-versioned official product/set/insert/parallel coverage independently of this cohort, then rerun the same zero-call screen. The mechanism should not advance until it clears the 8-card gate and survives a 150-card replay with per-field wins, losses, numeric-mutation checks, and unrelated-field drift checks.

## Reproduction

```sh
node experiments/accuracy/official-release-graph-v1-screen.mjs
```

The script prints source hashes, graph quality, cohort fingerprints, exact coverage, proxies, and the gate decision. It makes no network requests and writes no runtime state.
