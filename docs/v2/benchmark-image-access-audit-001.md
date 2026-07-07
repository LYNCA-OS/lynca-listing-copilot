# Benchmark Image Access Audit #001

Status: Image Access Audit Complete
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `docs/v2/evaluation-dataset-001.md`
- `data/learning/supabase-feedback-export-current.json`

## Goal

Verify whether the 100 rows in Evaluation Dataset #001 have images that can be accessed by the local/Codex evaluation pipeline.

No runtime code, prompts, registry data, resolver logic, upgrades, or benchmark rows were modified. No images were committed. The audit attempted authenticated downloads in memory only and recorded status only.

## Method

- Parsed the 100 benchmark rows from `docs/v2/evaluation-dataset-001.md`.
- Cross-checked `feedback_id` values against `data/learning/supabase-feedback-export-current.json`.
- Loaded existing local Supabase environment configuration from script-accessible environment files.
- Attempted authenticated `GET` requests for each front and back image URL.
- Read only enough response data to verify access, then discarded the response body.
- Did not write image bytes, base64, secrets, or authorization headers to disk or logs.

## Summary

| Metric | Count |
| --- | ---: |
| Total benchmark rows | 100 |
| Source export rows | 351 |
| Benchmark IDs found in source export | 100 |
| Front image accessible count | 100 |
| Back image accessible count | 99 |
| Front failed count | 0 |
| Back failed count | 0 |
| Front URL missing count | 0 |
| Back URL missing count | 1 |
| Auth/config issue rows | 0 |

## Auth And Config

| Check | Status |
| --- | --- |
| Supabase auth config available | `configured` |
| Source exported at | `2026-06-22T11:29:56.146Z` |
| Secrets printed | `no` |
| Authorization headers exposed | `no` |
| Images committed | `no` |

## Category Breakdown

| Category | Rows | front_download_ok | back_download_ok | front_failed | back_failed | url_missing | auth_missing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `serial` | 20 | 20 | 20 | 0 | 0 | 0 | 0 |
| `auto/grade` | 20 | 20 | 20 | 0 | 0 | 0 | 0 |
| `subject/team` | 20 | 20 | 19 | 0 | 0 | 1 | 0 |
| `product/set` | 20 | 20 | 20 | 0 | 0 | 0 | 0 |
| `parallel` | 20 | 20 | 20 | 0 | 0 | 0 | 0 |

## Failed Rows

No rows failed authenticated image download.

## URL Missing Rows

| row | feedback_id | category | front_status | back_status | front_http_status | back_http_status |
| ---: | --- | --- | --- | --- | ---: | ---: |
| 59 | `57fd6bea-157e-4ebe-be6a-ff7219c06d9b` | `subject/team` | `front_download_ok` | `url_missing` | 200 |  |

The single `url_missing` status is a known front-only benchmark row. It does not block real vision evaluation because the front image is accessible and the back image URL is not present in the benchmark dataset.

## Status Values Used

| Status | Meaning |
| --- | --- |
| `front_download_ok` | Front image URL exists and authenticated download succeeded. |
| `back_download_ok` | Back image URL exists and authenticated download succeeded. |
| `front_failed` | Front image URL exists but authenticated download failed. |
| `back_failed` | Back image URL exists but authenticated download failed. |
| `auth_missing` | Required Supabase auth/config was unavailable. |
| `url_missing` | The benchmark row did not include that image URL. |

## Readiness Conclusion

Benchmark Dataset #001 is ready for real vision evaluation from the local/Codex evaluation pipeline.

All 100 front images are accessible. All 99 available back images are accessible. The one missing back image is an expected front-only row, not an authenticated-download failure.

## Not Changed

This audit did not:

- modify runtime code
- modify prompts
- modify registry data
- modify resolver logic
- mutate benchmark rows
- commit images
- install upgrades
