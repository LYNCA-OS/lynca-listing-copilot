# PP-OCRv6 medium HPI shadow diagnostic — 2026-07-22

Decision: `KEEP_GOOGLE_VISION_PRIMARY`.

This run compared Google Vision with PP-OCRv6 medium detection and recognition on the same 300 field crops. It is a coverage/latency diagnostic, not an accuracy benchmark: the frozen source inventory has reviewed titles but no `HUMAN_REVIEWED_FIELD` labels. Titles and Google output were not used as field truth.

## Runtime

- Cloud Run revision: `lynca-recognition-worker-00071-xin`
- Primary: Google Vision
- Shadow: PP-OCRv6 medium det+rec, CPU HPI/OpenVINO, two threads per instance
- Cohort: 100 cards, with 100 `year_product_crop`, 100 `subject_crop`, and 100 `card_code_crop`
- Paired backend calls: 600
- Technical errors: 0
- Concurrency: 10
- Execution: three 100-crop segments; each segment refreshed signed sources because source URLs expire after 600 seconds

## Results

| Scope | Google nonempty | PP nonempty | Google p50 / p95 | PP p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| Overall (300) | 299 | 295 | 958 / 2,273 ms | 1,981 / 3,230 ms |
| Year/product (100) | 100 | 97 | 655 / 2,277 ms | 1,914 / 2,987 ms |
| Subject (100) | 99 | 98 | 983 / 2,337 ms | 1,712 / 3,119 ms |
| Card code (100) | 100 | 100 | 656 / 2,206 ms | 2,125 / 3,532 ms |

Paired coverage was: both nonempty 295, Google-only 4, PP-only 0, both empty 1. Median token-set Jaccard agreement was 0.7222; this measures output similarity only and has no accuracy authority.

## Gate

PP did not lead either diagnostic coverage or latency. More importantly, reviewed field labels available for this gate are `0/300`. Switching primary remains forbidden until a 300-crop `HUMAN_REVIEWED_FIELD` cohort shows a statistically significant PP win, no higher technical error rate, and acceptable p95 latency.

The production rollback revision is tagged `google-vision-rollback`; the serving revision keeps `OCR_BACKEND=google_vision` and `PADDLEOCR_ROLE=shadow`.
