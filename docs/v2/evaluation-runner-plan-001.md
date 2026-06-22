# Evaluation Runner Plan #001

Status: Execution Plan Only, Not Implemented
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `docs/v2/evaluation-dataset-001.md`
- `docs/v2/end-to-end-evaluation-design-001.md`

## Goal

Define how to execute the first real benchmark run against Evaluation Dataset #001.

This plan describes the runner, artifacts, scoring, and reporting format. It does not implement the runner and does not modify runtime code, prompts, registry data, resolver logic, or benchmark rows.

## Baseline Run Definition

The first benchmark run is a baseline run.

Baseline means:

```text
Evaluation Dataset #001
-> original front/back image URLs
-> current Listing Copilot title pipeline
-> generated benchmark output
-> field-level comparison against corrected_title
-> benchmark report
```

The baseline exists to measure the current system as-is. It is not an upgrade run.

## Safety Rules

During the baseline run:

- No prompt changes.
- No registry changes.
- No resolver changes.
- No runtime code changes.
- No mutation of `docs/v2/evaluation-dataset-001.md`.
- No mutation of source feedback rows.
- No image files committed to the repository.
- No image base64 written to logs, Markdown, JSON reports, or terminal output.
- No `corrected_title` sent to the Listing Copilot generation call.
- No failed or ambiguous row silently dropped from the report.

Allowed output artifacts:

- JSONL or JSON generated-output file.
- JSON or Markdown score report.
- Optional local temporary image cache ignored by git and deleted after the run.

## Loading The 100 Benchmark Rows

The runner should read `docs/v2/evaluation-dataset-001.md` and parse only the `Benchmark Rows` table.

Required row fields:

| Field | Source |
| --- | --- |
| `row_index` | Table row number. |
| `feedback_id` | `feedback_id` column. |
| `front_image_url` | `front` Markdown link in `image urls`. |
| `back_image_url` | `back` Markdown link in `image urls`, nullable. |
| `baseline_generated_title` | `generated title` column from stored feedback. |
| `corrected_title` | `corrected title` column. |
| `category` | `category` column. |

Validation before running:

| Check | Required behavior |
| --- | --- |
| Row count | Must equal 100 for standard run or 25 for smoke run. |
| Duplicate IDs | Fail if any duplicate `feedback_id` exists. |
| Image URL | Fail if `front_image_url` is missing. |
| Back image | Allow missing back image, but record `image_backed_status`. |
| Titles | Fail if generated or corrected title is empty. |
| Categories | Must be one of `parallel`, `product/set`, `serial`, `auto/grade`, `subject/team`. |

Smoke run selection:

- Use rows `1-25` from Evaluation Dataset #001.
- This preserves the stable benchmark order and avoids a second sampling policy.

Standard run selection:

- Use all 100 rows.

## Calling Current Listing Copilot Pipeline

The current local pipeline entry point is:

```text
POST /api/listing-copilot-title
```

The local dev server maps that route to `api/listing-copilot-title.js`.

Request body shape:

```json
{
  "assetId": "eval-001:<feedback_id>",
  "mode": "evaluation-baseline",
  "images": [
    {
      "name": "<feedback_id>-front.jpg",
      "dataUrl": "data:image/jpeg;base64,..."
    },
    {
      "name": "<feedback_id>-back.jpg",
      "dataUrl": "data:image/jpeg;base64,..."
    }
  ],
  "resolutionMap": {},
  "maxTitleLength": 80
}
```

Execution details:

1. Load benchmark rows.
2. For each row, fetch `front_image_url` and optional `back_image_url` at run time.
3. Convert fetched image bytes to transient `data:image/...;base64,...` strings in memory only.
4. Call the current `/api/listing-copilot-title` route.
5. Save the JSON response and runner metadata.
6. Discard image bytes and base64 immediately after the row finishes.

The runner must use the same prompt, registry, resolver, model, title limit, and post-processing behavior that production uses at run time.

Recommended run metadata:

| Field | Purpose |
| --- | --- |
| `run_id` | Stable run identifier, such as `eval-001-baseline-YYYYMMDD-HHMMSS`. |
| `run_type` | `smoke` or `standard`. |
| `dataset_id` | `evaluation-dataset-001`. |
| `dataset_path` | Source Markdown path. |
| `pipeline_endpoint` | `/api/listing-copilot-title`. |
| `model` | `OPENAI_LISTING_MODEL` or default model if unset. |
| `prompt_files` | Current prompt files loaded by runtime. |
| `registry_version` | Git commit or dirty-worktree note. |
| `started_at` | ISO timestamp. |
| `finished_at` | ISO timestamp. |

## Saving Generated Outputs

Write raw row outputs to an ignored or future-reviewed artifact path such as:

```text
data/evaluation/runs/eval-001-baseline-YYYYMMDD-HHMMSS/outputs.jsonl
```

Each JSONL row should contain:

```json
{
  "run_id": "",
  "row_index": 1,
  "feedback_id": "",
  "category": "serial",
  "front_image_url": "",
  "back_image_url": "",
  "image_backed_status": "front_and_back",
  "baseline_generated_title": "",
  "corrected_title": "",
  "pipeline_generated_title": "",
  "pipeline_confidence": "HIGH | MEDIUM | LOW | FAILED",
  "pipeline_reason": "",
  "pipeline_fields": {},
  "pipeline_unresolved": [],
  "pipeline_source": "openai | fallback | error",
  "error": null,
  "latency_ms": 0,
  "usage": {
    "input_tokens": null,
    "output_tokens": null,
    "total_tokens": null,
    "estimated_cost_usd": null
  }
}
```

Rules:

- Store URLs, not image bytes.
- Store generated titles and structured fields.
- Store errors as row-level results.
- Do not overwrite a prior run directory.
- Preserve output even if later rows fail.

## Comparing Output Against `corrected_title`

The comparison stage should not use exact title-string match as the primary score.

For each row:

1. Treat `corrected_title` as the operator-approved target title.
2. Extract comparable fields from `corrected_title`.
3. Extract comparable fields from `pipeline_generated_title`.
4. Compare facts field by field.
5. Mark checklist-dependent or visually ambiguous claims as `needs_review` instead of forcing pass/fail.

Target comparable fields:

```json
{
  "product": "",
  "set": "",
  "serial": "",
  "auto": "",
  "subject": [],
  "parallel": ""
}
```

Extraction can begin with deterministic title parsing, but the plan should allow human adjudication for fields that cannot be safely decided from title text alone.

## Field-Level Scoring Plan

Use the scoring model from `end-to-end-evaluation-design-001.md`.

Field scores:

| Score | Meaning |
| --- | --- |
| `pass` | Generated field matches target fact or accepted equivalent. |
| `fail_missing` | Target field is present but generated title omitted it. |
| `fail_wrong` | Generated field differs from target. |
| `fail_duplicate` | Generated title repeats or conflicts with itself. |
| `fail_overclaim` | Generated title adds an unsupported high-value field. |
| `fail_grade_split` | Card grade and auto grade are merged, dropped, or misrepresented. |
| `fail_order_only` | All subjects are present but order differs; not a factual failure by default. |
| `not_applicable` | Target has no applicable field. |
| `needs_review` | Image or checklist adjudication is required. |

Fields to score:

| Field | Primary question |
| --- | --- |
| `product` | Does generated title preserve manufacturer/product identity? |
| `set` | Does generated title preserve set, product line, subset, or edition? |
| `serial` | Does generated title preserve exact serial numbering? |
| `auto` | Does generated title preserve autograph and auto-grade semantics? |
| `subject` | Does generated title preserve all named subjects? |
| `parallel` | Does generated title preserve the correct parallel without overclaiming? |

Per-row score object:

```json
{
  "feedback_id": "",
  "category": "",
  "fields": {
    "product": { "score": "pass", "error_type": null, "notes": "" },
    "set": { "score": "needs_review", "error_type": "needs_checklist", "notes": "" },
    "serial": { "score": "fail_wrong", "error_type": "wrong_field", "notes": "" },
    "auto": { "score": "not_applicable", "error_type": null, "notes": "" },
    "subject": { "score": "pass", "error_type": null, "notes": "" },
    "parallel": { "score": "fail_missing", "error_type": "missing_field", "notes": "" }
  },
  "record_result": {
    "all_applicable_fields_pass": false,
    "critical_fields_pass": false,
    "has_high_value_error": true,
    "needs_human_review": true
  }
}
```

Primary aggregate metrics:

| Metric | Formula |
| --- | --- |
| `product_accuracy` | product `pass` / product applicable rows. |
| `set_accuracy` | set `pass` / set applicable rows. |
| `serial_accuracy` | serial `pass` / serial applicable rows. |
| `auto_accuracy` | auto `pass` / auto applicable rows. |
| `subject_accuracy` | subject `pass` / subject applicable rows. |
| `parallel_accuracy` | parallel `pass` / parallel applicable rows. |
| `critical_field_accuracy` | rows where product, subject, serial, auto, and parallel pass when applicable. |
| `high_value_error_rate` | rows with serial, auto-grade, wrong subject, unsupported parallel, or unsupported scarcity error. |
| `overclaim_rate` | rows with any `fail_overclaim`. |
| `omission_rate` | rows with any `fail_missing`. |
| `needs_review_rate` | rows with any `needs_review`. |

Applicable denominator excludes `not_applicable`. It should report `needs_review` separately and should not silently count `needs_review` as pass.

## Human Review Queue

Rows must be queued for human review when:

- `corrected_title` includes `SSP`, `SP`, case-hit, or short-print language.
- Generated title adds `SSP`, `SP`, case-hit, or short-print language not present in target.
- Exact insert name appears checklist-dependent.
- Parallel is visually subtle or checklist-dependent, such as Sapphire, Shimmer, Raywave, Geometric, Padparadscha, or case-hit-style variants.
- Serial number is unreadable, conflicting, or absent from generated structured fields.
- Subject identity is ambiguous or multi-subject ordering materially changes meaning.
- Corrected title and generated title both appear plausible.

Human review output should record:

| Field | Meaning |
| --- | --- |
| `review_required` | Boolean. |
| `review_reason` | Short reason. |
| `target_status` | `accepted`, `uncertain`, `corrected_title_needs_review`. |
| `evidence_basis` | `title_only`, `image_visible`, `slab_label`, `checklist`, `operator_judgment`. |
| `metric_inclusion` | `include`, `exclude_from_field`, `exclude_from_record`. |

## Output Report Format

Create a Markdown report after each run:

```text
docs/v2/evaluation-run-001-smoke-results.md
docs/v2/evaluation-run-001-standard-results.md
```

Report sections:

| Section | Contents |
| --- | --- |
| Summary | Run ID, split, row count, model, status, start/end time. |
| Dataset | Dataset path, dataset row count, category mix. |
| System Snapshot | Prompt files, registry/resolver commit, endpoint, model env. |
| Cost | Estimated and actual token usage/cost when available. |
| Field Metrics | Product, set, serial, auto, subject, parallel accuracy. |
| Record Metrics | Critical-field accuracy, high-value error rate, overclaim rate, omission rate, needs-review rate. |
| Category Metrics | Same metrics grouped by benchmark category. |
| Error Breakdown | Counts by error type and field. |
| Human Review Queue | Rows requiring adjudication and reason. |
| Worst Failures | Highest-risk rows, especially serial, grade, subject, overclaim, and unsupported scarcity errors. |
| Raw Output Pointer | Path to generated JSONL artifact. |
| Recommendation | Baseline accepted, rerun required, or blocked. |

Minimum report tables:

```text
| Metric | Value |
| Field | Applicable | Pass | Fail | Needs review | Accuracy |
| Category | Rows | Critical pass | High-value errors | Needs review |
| Error type | Count |
| feedback_id | category | generated | corrected | issue | review reason |
```

## Cost Estimate

The current runtime default model is `gpt-4.1-mini` unless `OPENAI_LISTING_MODEL` overrides it.

Cost assumptions for planning only:

- One API call per benchmark row.
- Each call sends the current prompt bundle, registry summary, asset context, one high-detail front image, and one low-detail back image when present.
- Current prompt files are roughly 4,279 words, about 5,800 text tokens before image tokens and per-row context.
- The API request caps output at `max_output_tokens: 900`.
- Official OpenAI pricing says images are converted into tokens and text models price image tokens at standard text-token rates; the pricing calculator currently shows a 512 x 512 image example as 210 tokens at $0.000263 for `gpt-4.1-mini`, with a fixed $1.25 / 1M-token image-token rate.

Planning estimate:

| Run | Rows | Estimated tokens per row | Estimated total tokens | Estimated cost |
| --- | ---: | ---: | ---: | ---: |
| Smoke | 25 | 6,500-8,000 | 162,500-200,000 | `$0.25-$0.40` |
| Standard | 100 | 6,500-8,000 | 650,000-800,000 | `$1.00-$1.60` |

The runner should record actual token usage from OpenAI responses if available. If usage is not available through the current endpoint response, the first implementation should either persist response `usage` from the OpenAI API or mark cost as estimated.

Before running a paid benchmark, confirm:

- `OPENAI_LISTING_MODEL`.
- current OpenAI pricing for that model.
- whether prompt caching applies.
- whether the run uses standard, batch, flex, or priority processing.

Pricing references:

- `https://openai.com/api/pricing/`
- `https://developers.openai.com/api/docs/pricing`

## Planned Runner Phases

### Phase 1: Dry Load

Load and validate dataset rows without fetching images or calling OpenAI.

Output:

- row count
- category counts
- duplicate check
- missing image URL check
- selected smoke row list

### Phase 2: Smoke Generation

Run rows `1-25`.

Purpose:

- verify authenticated image URL fetching
- verify current pipeline call shape
- verify result persistence
- verify failure handling
- estimate real cost and latency before the full run

### Phase 3: Smoke Scoring

Score smoke outputs against `corrected_title`.

Purpose:

- validate field extraction
- validate report structure
- identify scoring ambiguities before the 100-row run

### Phase 4: Standard Generation

Run all 100 rows only after smoke run completes cleanly.

### Phase 5: Standard Scoring And Report

Generate the standard benchmark report and human-review queue.

## Failure Handling

If a row fails:

- save a row result with `pipeline_source: "error"`
- preserve `feedback_id`
- record error message
- continue unless failure rate exceeds a configured stop threshold

Recommended stop thresholds:

| Failure | Stop threshold |
| --- | ---: |
| Image fetch auth errors | 3 consecutive rows |
| OpenAI API failures | 5 consecutive rows |
| JSON parse/output shape failures | 5 total rows |
| Cost estimate exceeds approved budget | immediately |

Failed rows remain part of the report. They should not be removed from denominators unless the report explicitly marks them as infrastructure failures.

## Non-Goals

This plan does not:

- implement the runner
- modify runtime code
- modify prompts
- modify registry data
- modify resolver logic
- mutate benchmark rows
- download and commit images
- create approved learning rules
- decide whether any future system change ships
