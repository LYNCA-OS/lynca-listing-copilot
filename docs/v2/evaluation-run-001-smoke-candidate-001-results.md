# Evaluation Run #001 Smoke Candidate #001 Results

Status: Smoke Candidate Generation Complete
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `docs/v2/evaluation-dataset-001.md`
- `docs/v2/evaluation-runner-plan-001.md`
- `docs/v2/benchmark-image-access-audit-001.md`
- `docs/v2/prompt-upgrade-candidate-001.md`

## Scope

This smoke run executed rows 1-25 from Evaluation Dataset #001 against the current Listing Copilot pipeline with Prompt Upgrade Candidate #001 injected only inside the isolated evaluation runner. It does not score field-level accuracy.

The isolated evaluation runner configures local OpenAI proxy access before invoking the current title handler. No production prompt, registry, resolver, or runtime title-generation behavior was modified. No corrected titles were sent to the generation call. No images were committed.

The candidate prompt was appended to a temporary copied prompt directory before importing the title handler for this run only.

## Run Summary

| Metric | Value |
| --- | ---: |
| Rows attempted | 25 |
| Rows completed | 25 |
| Rows failed | 0 |
| Image fetch failures | 0 |
| OpenAI/API failures | 0 |

## System Snapshot

| Field | Value |
| --- | --- |
| Run ID | `eval-001-smoke-candidate-001` |
| Run mode | `candidate` |
| Started at | `2026-06-22T14:22:42.996Z` |
| Finished at | `2026-06-22T14:28:08.678Z` |
| Pipeline | `api/listing-copilot-title.js` |
| Candidate prompt patch | `docs/v2/prompt-upgrade-candidate-001.md` |
| Model | `gpt-4.1-mini` |
| OpenAI configured | `yes` |
| Local proxy mode | `openai_only_http_connect_proxy` |
| Raw output path | `data/evaluation/runs/eval-001-smoke-candidate-001/outputs.jsonl` |

## Confidence Distribution

| Confidence | Rows |
| --- | ---: |
| `HIGH` | 6 |
| `LOW` | 14 |
| `MEDIUM` | 5 |

## Pipeline Source Distribution

| Source | Rows |
| --- | ---: |
| `openai` | 25 |

## Latency Summary

| Metric | Milliseconds |
| --- | ---: |
| Min | 7789 |
| Median | 10489 |
| P95 | 24269 |
| Max | 35022 |
| Average | 13028 |

## Generated Titles

| Row | feedback_id | Category | Generated title | Confidence | Latency ms | Status |
| ---: | --- | --- | --- | --- | ---: | --- |
| 1 | `a4e1bd7a-1089-4b5b-a8ab-478fda25b4fb` | `serial` | 2003-04 Fleer E-X Jambalaya Kobe Bryant BGS 9 | `LOW` | 13383 | `completed` |
| 2 | `b291c1b5-ecdc-4e9e-9fd6-1162fa37e8ae` | `serial` | 2018 Topps Silver Pack Shohei Ohtani 83 Chrome Promo Blue Refractor RC 018/150 | `LOW` | 12758 | `completed` |
| 3 | `a4856c4c-4246-47e4-a5f9-368309f2e55f` | `serial` | 2023 Wild Card Wild Chrome Chris Rodriguez Jr. Running Back Auto | `MEDIUM` | 8745 | `completed` |
| 4 | `b70f1371-6c82-40d0-bb7f-a848e2fbd4ed` | `serial` | 2025 Topps Signature Class Basketball Cooper Flagg RC Class Auto Red Parallel | `LOW` | 7789 | `completed` |
| 5 | `c24c596d-4723-4d8c-834e-c826a74d3269` | `serial` | 2025-26 Panini Donruss Will Riley RC License to Drive Auto | `LOW` | 10489 | `completed` |
| 6 | `58d35842-a5e6-4f80-9bc3-103dcbd02f49` | `serial` | 2022 Game of Thrones The Complete Series Volume 2 Kit Harington Auto Relic | `LOW` | 8822 | `completed` |
| 7 | `59305b58-e160-49bd-ba65-3676b1e4619a` | `serial` | 2026 Bowman Chrome Sam Petersen 034/499 Luis Cova Purple Refractor 232/250 | `LOW` | 11559 | `completed` |
| 8 | `72d6f937-4d5e-40d3-ab76-612b9ac12511` | `serial` | 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9 | `HIGH` | 9524 | `completed` |
| 9 | `43f2d69f-6ad0-4933-ad4b-65e6c8790ef0` | `serial` | 2025-26 Panini Prizm FIFA Soccer Lionel Messi Club Legends Auto 29/199 | `LOW` | 9005 | `completed` |
| 10 | `64118562-de3a-4a6e-909c-770396c2241c` | `serial` | 2023-24 Lamine Yamal UEFA Club Competitions Violet Speckle Refractor RC Auto | `LOW` | 9014 | `completed` |
| 11 | `fe0df369-ae60-4c86-8d43-c330ff137a37` | `serial` | 2025-26 Panini Signature Series Karim Lopez Signed Basketball Card Forward | `LOW` | 22422 | `completed` |
| 12 | `756353fc-b8a4-4e73-9b97-d83a7b72895a` | `serial` | 2026 Bowman Bubba Chandler RC Blue Refractor 431/499 Drew Gilbert RC Orange | `LOW` | 10555 | `completed` |
| 13 | `5eda43f8-3a16-4159-851e-96653f30ca76` | `serial` | 2026 Topps Chrome Disney Mufasa | `MEDIUM` | 10027 | `completed` |
| 14 | `18cec42b-47d4-4b36-b538-6aa3a974cd6a` | `serial` | 2026 Topps Chrome Mitchie Torres Pink Leopard Parallel 032/100 | `MEDIUM` | 10518 | `completed` |
| 15 | `a9f73f47-7b30-41cd-90a9-079de8823c23` | `serial` | 2025 Topps Chrome Spencer Schwellenbach RC Auto 1/99 | `HIGH` | 21852 | `completed` |
| 16 | `0c930fc7-3933-44b1-a892-29fbaac7ee28` | `serial` | 2020 Hank Aaron Ken Griffey Jr Mike Trout Historic Ties Triple Auto Relic BGS | `LOW` | 12579 | `completed` |
| 17 | `9c405650-1dcd-4634-919b-439c7a0c6a88` | `serial` | 2023 Chrome Topps Disney 100 Anna 100-Year Diamond Refractor 032/100 PSA 10 | `HIGH` | 9448 | `completed` |
| 18 | `dcf62136-6ba5-4160-b620-38b361ab0a96` | `serial` | 2025 Panini Black Football Ricky Pearsall Metallic Marks Auto 166/299 | `HIGH` | 8879 | `completed` |
| 19 | `34a7f0fc-cc9b-4fb1-ac34-0dd67c4cebd9` | `serial` | 2025 Bowman Chrome Walker Jenkins Blue Refractor 086/299 Josh Knoth Blue | `LOW` | 10136 | `completed` |
| 20 | `aa0c9e87-5a77-4919-95d3-f523d015deac` | `serial` | 2026 Bowman Gabriel Rodriguez Cleveland Guardians 1st Bowman 06/25 | `MEDIUM` | 35022 | `completed` |
| 21 | `16c44d0d-c6eb-4764-8b60-cc898a5569e0` | `auto/grade` | 2021 Ben Baller Chrome Rafael Devers Auto Red Refractor 5/5 PSA 9 | `HIGH` | 11160 | `completed` |
| 22 | `d3d86151-00e2-43fb-a2c4-af9402a9fcfb` | `auto/grade` | 2001 Donruss Elite Barry Bonds Willie Mays Passing The Torch Auto 22/50 PSA | `LOW` | 24269 | `completed` |
| 23 | `6195cc70-8c4a-4bc6-be13-148880b429a3` | `auto/grade` | 2025 Panini Donruss Optic Football Shedeur Sanders First Year Patch RC | `LOW` | 8395 | `completed` |
| 24 | `06ec530c-6a20-4e70-9347-5c8770da261c` | `auto/grade` | 2026 Topps Trey Yesavage Toronto Blue Jays RC Player-Worn Memorabilia 14/50 | `HIGH` | 20989 | `completed` |
| 25 | `45ea7f7b-d027-4f3c-8034-c1a01614ce9c` | `auto/grade` | 2002 Fleer Bo Jackson Royals Through the Years Game-Worn Jersey Relic | `MEDIUM` | 8353 | `completed` |

## Image Fetch Failures

No image fetch failures.

## OpenAI/API Failures

No OpenAI/API failures.

## Scoring Readiness

Candidate generation is ready for lightweight baseline comparison.

## Lightweight Baseline Comparison

This is a lightweight title-diff review against the saved baseline output, not finalized field-level scoring. Baseline generation was not rerun.

| Preservation dimension | Candidate vs baseline | Notes |
| --- | --- | --- |
| Serial preserved | Worse | Candidate kept some exact serials, but introduced more serial drops or mutations than the baseline on visible smoke rows. Notable regressions: row 6 dropped `12/50`, row 7 changed `024/250` to `232/250`, row 18 changed `066/210` to `166/299`, and row 19 changed `086/250` to `086/299`. |
| Product retained | Better | Candidate added or retained product/manufacturer wording in several rows, including `Topps` on row 2, `Donruss Elite` on row 22, and `Panini Donruss Optic` on row 23. This came with regressions, including row 15 dropping `Platinum`. |
| Set retained | Same / mixed | Candidate improved some set/product-line wording, such as row 6 `The Complete Series Volume 2`, row 22 `Donruss Elite`, and row 25 `Through the Years`. It also weakened or changed set/product-line wording elsewhere, including row 15 losing `Platinum` and row 14 adding unsupported `Pink Leopard Parallel`. |

## Obvious Regressions

| Row | Baseline title | Candidate title | Regression |
| ---: | --- | --- | --- |
| 2 | 2018 Silver Pack Shohei Ohtani 83 Chrome Promo Blue Refractor 018/150 PSA 10 | 2018 Topps Silver Pack Shohei Ohtani 83 Chrome Promo Blue Refractor RC 018/150 | Added `Topps`, but dropped `PSA 10`. |
| 4 | 2025 Topps Signature Class Cooper Flagg RC Class Auto Red Parallel Redemption | 2025 Topps Signature Class Basketball Cooper Flagg RC Class Auto Red Parallel | Dropped `Redemption`; added generic `Basketball`; still did not preserve `/25`. |
| 6 | 2022 Game of Thrones Kit Harington Autographed Costume Relic 12/50 BGS 9.5/10 | 2022 Game of Thrones The Complete Series Volume 2 Kit Harington Auto Relic | Improved set wording, but dropped `12/50` and `BGS 9.5/10`. |
| 7 | 2025 Bowman Chrome Sam Petersen 034/499 Luis Cova Purple Wave 024/250 David | 2026 Bowman Chrome Sam Petersen 034/499 Luis Cova Purple Refractor 232/250 | Changed serial numerator and weakened `Purple Wave` to `Purple Refractor`. |
| 15 | 2025 Topps Chrome Platinum Spencer Schwellenbach RC Auto 1/99 | 2025 Topps Chrome Spencer Schwellenbach RC Auto 1/99 | Dropped `Platinum`. |
| 18 | 2025 Panini Black Football Ricky Pearsall Metallic Marks Auto 066/210 | 2025 Panini Black Football Ricky Pearsall Metallic Marks Auto 166/299 | Mutated serial value. |
| 19 | 2025 Bowman Chrome Walker Jenkins Blue Wave Refractor 086/250 Josh Knoth Blue | 2025 Bowman Chrome Walker Jenkins Blue Refractor 086/299 Josh Knoth Blue | Mutated serial denominator and weakened `Blue Wave Refractor`. |
| 22 | 2001 Barry Bonds Willie Mays Passing The Torch Auto 22/50 PSA 9 | 2001 Donruss Elite Barry Bonds Willie Mays Passing The Torch Auto 22/50 PSA | Improved product wording, but dropped grade `9`. |

## Unsupported New Claims

The candidate introduced several terms that require review because they are not justified by the preservation-only candidate rules:

- Row 3: `Running Back`
- Row 4: `Basketball`
- Row 11: `Forward`
- Row 14: `Pink Leopard Parallel`
- Row 18: `166/299`
- Row 19: `086/299`
- Row 24: `Player-Worn Memorabilia`
- Row 25: `Relic`

## Candidate Readout

Prompt Upgrade Candidate #001 is not ready for promotion as written. The product-retention behavior shows some useful signal, but the preservation-only package did not reliably preserve serials and introduced unsupported claims. The next safe iteration should tighten the serial rule and separate product retention from any language that encourages broader descriptive inference.

## Not Changed

This smoke run did not modify production prompts, registry data, resolver logic, runtime title-generation behavior, benchmark rows, or image files.
