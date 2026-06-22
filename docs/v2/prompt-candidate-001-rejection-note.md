# Prompt Candidate #001 Rejection Note

Status: Rejected, Do Not Install
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `docs/v2/prompt-upgrade-candidate-001.md`
- `docs/v2/evaluation-run-001-smoke-candidate-001-results.md`
- `docs/v2/evaluation-run-001-smoke-results.md`

## Conclusion

Do not install Prompt Upgrade Candidate #001.

The candidate produced some useful product-retention signal, but it also introduced serial mutations, serial drops, grade drops, and unsupported descriptive claims. These regressions are directly contrary to the preservation-only goal.

No production prompt, runtime code, registry, resolver, or deployment should be changed from this candidate.

## Why It Was Tested

Prompt Upgrade Candidate #001 was tested as a reversible prompt-only preservation package against the same 25 smoke benchmark rows used by the baseline run.

The intended scope was intentionally narrow:

- preserve serial numbers
- retain product/manufacturer terms
- retain set/product-line terms

The candidate explicitly excluded Sapphire inference, SSP / SP / case-hit inference, named parallel inference, checklist logic, and year normalization. The purpose was to see whether a low-risk preservation prompt could reduce avoidable omissions without expanding model inference.

## What Improved

The candidate showed some improvement in product and set retention:

- Row 2 added `Topps` to the Shohei Ohtani Silver Pack title.
- Row 22 added `Donruss Elite` to the Passing the Torch title.
- Row 23 improved product wording from `Donruss Optic` to `Panini Donruss Optic`.
- Row 6 added `The Complete Series Volume 2`.
- Row 25 added `Through the Years`.

These improvements suggest that product/set preservation remains a valid opportunity, but not in the current combined candidate form.

## What Regressed

The candidate regressed on higher-priority fields:

- It mutated serial numbers.
- It dropped serial numbers.
- It dropped grade information.
- It introduced unsupported descriptive role, sport, parallel, and memorabilia language.
- It weakened or dropped some product/set terms while improving others.

The most important failure is serial behavior. A preservation candidate must never make exact identifier fields less reliable.

## Serial Mutation Examples

| Row | Baseline | Candidate | Issue |
| ---: | --- | --- | --- |
| 6 | `2022 Game of Thrones Kit Harington Autographed Costume Relic 12/50 BGS 9.5/10` | `2022 Game of Thrones The Complete Series Volume 2 Kit Harington Auto Relic` | Dropped `12/50` and `BGS 9.5/10`. |
| 7 | `2025 Bowman Chrome Sam Petersen 034/499 Luis Cova Purple Wave 024/250 David` | `2026 Bowman Chrome Sam Petersen 034/499 Luis Cova Purple Refractor 232/250` | Changed `024/250` to `232/250`. |
| 18 | `2025 Panini Black Football Ricky Pearsall Metallic Marks Auto 066/210` | `2025 Panini Black Football Ricky Pearsall Metallic Marks Auto 166/299` | Changed `066/210` to `166/299`. |
| 19 | `2025 Bowman Chrome Walker Jenkins Blue Wave Refractor 086/250 Josh Knoth Blue` | `2025 Bowman Chrome Walker Jenkins Blue Refractor 086/299 Josh Knoth Blue` | Changed `086/250` to `086/299`. |

These are rejection-level failures because serial preservation was one of the candidate's core goals.

## Unsupported New Claim Examples

The candidate introduced terms that were not justified by the preservation-only candidate rules:

- Row 3: `Running Back`
- Row 4: `Basketball`
- Row 11: `Forward`
- Row 14: `Pink Leopard Parallel`
- Row 18: `166/299`
- Row 19: `086/299`
- Row 24: `Player-Worn Memorabilia`
- Row 25: `Relic`

These additions show that the candidate wording encouraged more descriptive generation than intended. A preservation prompt should preserve evidence-backed terms, not create new role, sport, parallel, memorabilia, or serial claims.

## Why The Benchmark Caught The Issue

The smoke benchmark caught the issue because it reused the same 25 rows from the baseline run and compared candidate outputs against saved baseline outputs without rerunning the baseline.

That made candidate-only behavior visible:

- identical rows and images
- same production pipeline
- candidate prompt injected only inside the evaluation runner
- no corrected titles sent to generation
- no production prompt, registry, resolver, or runtime changes

Because the benchmark included many serial-sensitive rows and multi-field titles, it exposed regressions that would be easy to miss if the candidate were judged only by product/set improvements.

## Next Safe Iteration

The next candidate should be narrower and safer:

- isolate serial preservation from product/set retention
- make the serial rule negative-only: never mutate or invent, but do not encourage additional serial extraction
- avoid adding descriptive role, sport, parallel, or memorabilia language
- rerun candidate only after the revised prompt is created

Do not promote any part of Candidate #001 directly into production.

## Not Changed

This rejection note does not modify the production prompt, runtime code, registry, resolver, deployment, benchmark rows, or generated candidate outputs.
