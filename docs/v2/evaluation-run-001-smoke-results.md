# Evaluation Run #001 Smoke Results

Status: Smoke Baseline Generation Complete
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `docs/v2/evaluation-dataset-001.md`
- `docs/v2/evaluation-runner-plan-001.md`
- `docs/v2/benchmark-image-access-audit-001.md`

## Scope

This smoke run executed rows 1-25 from Evaluation Dataset #001 against the current Listing Copilot pipeline. It is baseline-only and does not score field-level accuracy.

The isolated evaluation runner configures local OpenAI proxy access before invoking the current title handler. No production prompt, registry, resolver, or runtime title-generation behavior was modified. No corrected titles were sent to the generation call. No images were committed.

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
| Run ID | `eval-001-smoke-baseline` |
| Started at | `2026-06-22T13:08:46.853Z` |
| Finished at | `2026-06-22T13:14:01.269Z` |
| Pipeline | `api/listing-copilot-title.js` |
| Model | `gpt-4.1-mini` |
| OpenAI configured | `yes` |
| Local proxy mode | `openai_only_http_connect_proxy` |
| Raw output path | `data/evaluation/runs/eval-001-smoke-baseline/outputs.jsonl` |

## Confidence Distribution

| Confidence | Rows |
| --- | ---: |
| `HIGH` | 5 |
| `LOW` | 13 |
| `MEDIUM` | 7 |

## Pipeline Source Distribution

| Source | Rows |
| --- | ---: |
| `openai` | 25 |

## Latency Summary

| Metric | Milliseconds |
| --- | ---: |
| Min | 7575 |
| Median | 10446 |
| P95 | 23142 |
| Max | 32358 |
| Average | 12575 |

## Generated Titles

| Row | feedback_id | Category | Generated title | Confidence | Latency ms | Status |
| ---: | --- | --- | --- | --- | ---: | --- |
| 1 | `a4e1bd7a-1089-4b5b-a8ab-478fda25b4fb` | `serial` | 2003-04 Fleer E-X Kobe Bryant Jambalaya BGS 9 | `LOW` | 10188 | `completed` |
| 2 | `b291c1b5-ecdc-4e9e-9fd6-1162fa37e8ae` | `serial` | 2018 Silver Pack Shohei Ohtani 83 Chrome Promo Blue Refractor 018/150 PSA 10 | `HIGH` | 13133 | `completed` |
| 3 | `a4856c4c-4246-47e4-a5f9-368309f2e55f` | `serial` | Wild Card Wild Chrome Chris Rodriguez Jr. Auto Football RC | `LOW` | 11428 | `completed` |
| 4 | `b70f1371-6c82-40d0-bb7f-a848e2fbd4ed` | `serial` | 2025 Topps Signature Class Cooper Flagg RC Class Auto Red Parallel Redemption | `MEDIUM` | 10343 | `completed` |
| 5 | `c24c596d-4723-4d8c-834e-c826a74d3269` | `serial` | 2025-26 Panini Donruss Will Riley RC License to Drive Auto | `LOW` | 8908 | `completed` |
| 6 | `58d35842-a5e6-4f80-9bc3-103dcbd02f49` | `serial` | 2022 Game of Thrones Kit Harington Autographed Costume Relic 12/50 BGS 9.5/10 | `LOW` | 11364 | `completed` |
| 7 | `59305b58-e160-49bd-ba65-3676b1e4619a` | `serial` | 2025 Bowman Chrome Sam Petersen 034/499 Luis Cova Purple Wave 024/250 David | `LOW` | 32358 | `completed` |
| 8 | `72d6f937-4d5e-40d3-ab76-612b9ac12511` | `serial` | 2018 Panini Certified Jalen Brunson Mirror Orange RC PSA 9 | `HIGH` | 10214 | `completed` |
| 9 | `43f2d69f-6ad0-4933-ad4b-65e6c8790ef0` | `serial` | 2025-26 Panini Prizm FIFA Soccer Lionel Messi Club Legends Auto 29/199 | `LOW` | 12108 | `completed` |
| 10 | `64118562-de3a-4a6e-909c-770396c2241c` | `serial` | 2023-24 UEFA Club Competitions Lamine Yamal RC Violet Speckle Refractor Auto | `LOW` | 23142 | `completed` |
| 11 | `fe0df369-ae60-4c86-8d43-c330ff137a37` | `serial` | 2025-26 Panini Signature Series Karim Lopez Signed Basketball Card | `LOW` | 20171 | `completed` |
| 12 | `756353fc-b8a4-4e73-9b97-d83a7b72895a` | `serial` | 2026 Bowman Bubba Chandler RC Blue Parallel 431/499 Drew Gilbert RC Orange | `LOW` | 11469 | `completed` |
| 13 | `5eda43f8-3a16-4159-851e-96653f30ca76` | `serial` | 2026 Topps Chrome Disney Mufasa CMP134780 | `MEDIUM` | 7575 | `completed` |
| 14 | `18cec42b-47d4-4b36-b538-6aa3a974cd6a` | `serial` | 2026 Topps Chrome Disney Mitchie Torres 032/100 | `MEDIUM` | 9829 | `completed` |
| 15 | `a9f73f47-7b30-41cd-90a9-079de8823c23` | `serial` | 2025 Topps Chrome Platinum Spencer Schwellenbach RC Auto 1/99 | `MEDIUM` | 7846 | `completed` |
| 16 | `0c930fc7-3933-44b1-a892-29fbaac7ee28` | `serial` | 2020 Hank Aaron Ken Griffey Jr Mike Trout Historic Ties Triple Auto Relic BGS | `LOW` | 12200 | `completed` |
| 17 | `9c405650-1dcd-4634-919b-439c7a0c6a88` | `serial` | 2023 Disney 100 Chrome Anna 100-Year Diamond Refractor 032/100 PSA 10 | `MEDIUM` | 7794 | `completed` |
| 18 | `dcf62136-6ba5-4160-b620-38b361ab0a96` | `serial` | 2025 Panini Black Football Ricky Pearsall Metallic Marks Auto 066/210 | `MEDIUM` | 8467 | `completed` |
| 19 | `34a7f0fc-cc9b-4fb1-ac34-0dd67c4cebd9` | `serial` | 2025 Bowman Chrome Walker Jenkins Blue Wave Refractor 086/250 Josh Knoth Blue | `LOW` | 9012 | `completed` |
| 20 | `aa0c9e87-5a77-4919-95d3-f523d015deac` | `serial` | 2026 Bowman Gabriel Rodriguez Cleveland Guardians 1st Bowman RC 06/25 | `HIGH` | 21237 | `completed` |
| 21 | `16c44d0d-c6eb-4764-8b60-cc898a5569e0` | `auto/grade` | 2021 Ben Baller Chrome Rafael Devers Red Refractor Auto 5/5 PSA 9 | `HIGH` | 9143 | `completed` |
| 22 | `d3d86151-00e2-43fb-a2c4-af9402a9fcfb` | `auto/grade` | 2001 Barry Bonds Willie Mays Passing The Torch Auto 22/50 PSA 9 | `HIGH` | 8045 | `completed` |
| 23 | `6195cc70-8c4a-4bc6-be13-148880b429a3` | `auto/grade` | 2025 Donruss Optic Shedeur Sanders First Year Fresh Patch RC | `MEDIUM` | 11481 | `completed` |
| 24 | `06ec530c-6a20-4e70-9347-5c8770da261c` | `auto/grade` | 2026 Topps Baseball Topps Trey Yesavage Toronto Blue Jays RC Material Card 14/50 | `LOW` | 16483 | `completed` |
| 25 | `45ea7f7b-d027-4f3c-8034-c1a01614ce9c` | `auto/grade` | 2002 Fleer Greats Bo Jackson Game-Worn Jersey Royals | `LOW` | 10446 | `completed` |

## Image Fetch Failures

No image fetch failures.

## OpenAI/API Failures

No OpenAI/API failures.

## Scoring Readiness

Baseline generation is ready for field-level scoring.

## Not Changed

This smoke run did not modify production prompts, registry data, resolver logic, runtime title-generation behavior, benchmark rows, or image files.
