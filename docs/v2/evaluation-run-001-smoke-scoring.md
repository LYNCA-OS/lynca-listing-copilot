# Evaluation Run #001 Smoke Scoring

Status: Partial Scoring Checkpoint
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `docs/v2/evaluation-run-001-smoke-results.md`
- `data/evaluation/runs/eval-001-smoke-baseline/outputs.jsonl`
- `docs/v2/end-to-end-evaluation-design-001.md`

## Scope

This is a scoring-only checkpoint for Smoke Benchmark Run #001. No generation was rerun. No prompts, runtime code, registry data, or resolver logic were modified. No corrected titles were sent to any model.

## Current Progress

| Item | Count |
| --- | ---: |
| Smoke output rows loaded | 25 |
| Rows with finalized field scoring | 0 |
| Rows pending field scoring | 25 |
| Rows marked `needs_review` | 0 |
| Completed field scores | 0 |

## Partial Metrics

No field-level metrics are available yet because no row has been finalized.

| Metric | Value |
| --- | --- |
| `product_accuracy` | `not_available` |
| `set_accuracy` | `not_available` |
| `serial_accuracy` | `not_available` |
| `auto_accuracy` | `not_available` |
| `subject_accuracy` | `not_available` |
| `parallel_accuracy` | `not_available` |
| `critical_field_accuracy` | `not_available` |
| `high_value_error_rate` | `not_available` |
| `omission_rate` | `not_available` |
| `overclaim_rate` | `not_available` |
| `needs_review_rate` | `not_available` |

## Rows Already Scored

No rows have finalized field-level scoring in this checkpoint.

## Needs Review Rows

No rows have been formally marked `needs_review` yet. Review-sensitive rows are expected during scoring for visual/checklist-dependent parallels, SSP/SP, exact insert names, and multi-card lots.

## Completed Field Counts

| Field | Completed scores |
| --- | ---: |
| `product` | 0 |
| `set` | 0 |
| `serial` | 0 |
| `auto` | 0 |
| `subject` | 0 |
| `parallel` | 0 |

## Remaining Rows

| Row | feedback_id | category | pipeline_generated_title | corrected_title |
| ---: | --- | --- | --- | --- |
| 1 | `a4e1bd7a-1089-4b5b-a8ab-478fda25b4fb` | `serial` | 2003-04 Fleer E-X Kobe Bryant Jambalaya BGS 9 | 2003-04 Fleer E-X Kobe Bryant Jambalaya BGS 9 |
| 2 | `b291c1b5-ecdc-4e9e-9fd6-1162fa37e8ae` | `serial` | 2018 Silver Pack Shohei Ohtani 83 Chrome Promo Blue Refractor 018/150 PSA 10 | 2018 Topps Shohei Ohtani Silver Pack RC Blue Refractor 018/150 PSA 10 |
| 3 | `a4856c4c-4246-47e4-a5f9-368309f2e55f` | `serial` | Wild Card Wild Chrome Chris Rodriguez Jr. Auto Football RC | 2023 Wild Card Wildchrome Draft Chris Rodriguez WildLiquid Wave Blue Auto 2/4 |
| 4 | `b70f1371-6c82-40d0-bb7f-a848e2fbd4ed` | `serial` | 2025 Topps Signature Class Cooper Flagg RC Class Auto Red Parallel Redemption | 2025-26 Topps Signature Class Cooper Flagg Rookie Auto Red RC /25 Redemption Card |
| 5 | `c24c596d-4723-4d8c-834e-c826a74d3269` | `serial` | 2025-26 Panini Donruss Will Riley RC License to Drive Auto | 2025-26 Panini Donruss Will Riley RC License to Drive Auto 12/49 |
| 6 | `58d35842-a5e6-4f80-9bc3-103dcbd02f49` | `serial` | 2022 Game of Thrones Kit Harington Autographed Costume Relic 12/50 BGS 9.5/10 | 2022 Game of Thrones Kit Harington Autographed Costume Patch BBGS 9.5/10 12/50 |
| 7 | `59305b58-e160-49bd-ba65-3676b1e4619a` | `serial` | 2025 Bowman Chrome Sam Petersen 034/499 Luis Cova Purple Wave 024/250 David | 2026 Bowman Chrome Sam Petersen /499 Luis Cova /250 David /125 Refractor lotx3 |
| 8 | `72d6f937-4d5e-40d3-ab76-612b9ac12511` | `serial` | 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9 | 2018-19 Panini Certified Jalen Brunson RC Mirror Orange /99 PSA 9 Rookie |
| 9 | `43f2d69f-6ad0-4933-ad4b-65e6c8790ef0` | `serial` | 2025-26 Panini Prizm FIFA Soccer Lionel Messi Club Legends Auto 29/199 | 2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199 |
| 10 | `64118562-de3a-4a6e-909c-770396c2241c` | `serial` | 2023-24 UEFA Club Competitions Lamine Yamal RC Violet Speckle Refractor Auto | 2023-24 Topps Chrome UCC Lamine Yamal Violet Speckle Refractor Auto 252/299 |
| 11 | `fe0df369-ae60-4c86-8d43-c330ff137a37` | `serial` | 2025-26 Panini Signature Series Karim Lopez Signed Basketball Card | 2025-26 Panini Signature Series Karim Lopez Auto 22/49 |
| 12 | `756353fc-b8a4-4e73-9b97-d83a7b72895a` | `serial` | 2026 Bowman Bubba Chandler RC Blue Parallel 431/499 Drew Gilbert RC Orange | 2026 Bowman Bubba Chandler Drew Gilbert Orange /499 Cam /299 Parallel lotx3 |
| 13 | `5eda43f8-3a16-4159-851e-96653f30ca76` | `serial` | 2026 Topps Chrome Disney Mufasa CMP134780 | 2026 Topps Chrome Disney Mufasa Dalmatian Refractor 004/101 |
| 14 | `18cec42b-47d4-4b36-b538-6aa3a974cd6a` | `serial` | 2026 Topps Chrome Disney Mitchie Torres 032/100 | 2026 Topps Chrome Disney Mitchie Torres 101 Dalmatians Shimmer Refractor 32/101 |
| 15 | `a9f73f47-7b30-41cd-90a9-079de8823c23` | `serial` | 2025 Topps Chrome Platinum Spencer Schwellenbach RC Auto 1/99 | 2025 Topps Chrome Platinum Spencer Schwellenbach RC Auto Blue 47/99 |
| 16 | `0c930fc7-3933-44b1-a892-29fbaac7ee28` | `serial` | 2020 Hank Aaron Ken Griffey Jr Mike Trout Historic Ties Triple Auto Relic BGS | 2020 Triple Threads Hank Aaron Ken Griffey Jr. Mike Trout Jersey Auto 6/9 BGS 9 |
| 17 | `9c405650-1dcd-4634-919b-439c7a0c6a88` | `serial` | 2023 Disney 100 Chrome Anna 100-Year Diamond Refractor 032/100 PSA 10 | 2023 Topps Chrome Disney 100 Anna Refractor 082/100 PSA 10 |
| 18 | `dcf62136-6ba5-4160-b620-38b361ab0a96` | `serial` | 2025 Panini Black Football Ricky Pearsall Metallic Marks Auto 066/210 | 2025 Panini Black Ricky Pearsall Metallic Marks Auto Autograph 066/240 |
| 19 | `34a7f0fc-cc9b-4fb1-ac34-0dd67c4cebd9` | `serial` | 2025 Bowman Chrome Walker Jenkins Blue Wave Refractor 086/250 Josh Knoth Blue | 2026 Bowman Chrome Walker JenkinsRefractor Josh Knoth /250/399/175/299 lotx4 |
| 20 | `aa0c9e87-5a77-4919-95d3-f523d015deac` | `serial` | 2026 Bowman Gabriel Rodriguez Cleveland Guardians 1st Bowman RC 06/25 | 2026 Bowman Prospect 1st Gabriel Rodriguez Orange Pattern 6/25 |
| 21 | `16c44d0d-c6eb-4764-8b60-cc898a5569e0` | `auto/grade` | 2021 Ben Baller Chrome Rafael Devers Red Refractor Auto 5/5 PSA 9 | 2021 Topps Chrome Ben Baller Rafael Devers Auto Red Refractor 5/5 PSA Auto 9 |
| 22 | `d3d86151-00e2-43fb-a2c4-af9402a9fcfb` | `auto/grade` | 2001 Barry Bonds Willie Mays Passing The Torch Auto 22/50 PSA 9 | 2001 Donruss Elite Willie Mays Barry Bonds Passing the Torch Auto 22/50 PSA Auto 9 |
| 23 | `6195cc70-8c4a-4bc6-be13-148880b429a3` | `auto/grade` | 2025 Donruss Optic Shedeur Sanders First Year Fresh Patch RC | 2025 Panini Donruss Optic Shedeur Sanders First Year Fresh RC Jersey Blue Hyper |
| 24 | `06ec530c-6a20-4e70-9347-5c8770da261c` | `auto/grade` | 2026 Topps Baseball Topps Trey Yesavage Toronto Blue Jays RC Material Card 14/50 | 2026 Topps Series 2 Trey Yesavage Gold Major League Material Relic RC 14/50 |
| 25 | `45ea7f7b-d027-4f3c-8034-c1a01614ce9c` | `auto/grade` | 2002 Fleer Greats Bo Jackson Game-Worn Jersey Royals | 2002 Fleer Greats of the Game Bo Jackson Through Years Level 1 Jersey |

## Next Required Step

Resume field-level scoring from row 1 without rerunning generation.
