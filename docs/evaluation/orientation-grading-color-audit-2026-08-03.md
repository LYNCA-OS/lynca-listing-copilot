# Card orientation, grading, and slab-color audit — 2026-08-03

## Decision

- **Promote:** structured CSM `grading_info` with separate card and autograph grades.
- **Hold:** generic auto-rotation, prompt-only mental rotation, and blanket graded-card finish suppression.
- **Hold:** slab/color prompt rules until literal slab-label provenance is present in the same response.

The promoted change fixes a critical high-priority CSM field. On the independent 105-card cohort, exact grading rose from 33/38 (86.8%) to 38/38 (100%): five repairs and zero grading regressions. Overall title F1 moved from 0.78235 to 0.77731 (delta -0.00504; paired 95% interval -0.01880 to +0.00871), so the run does not establish a global title regression or gain. The promotion is based on the prespecified critical-field outcome, not on the noisy aggregate.

## Orientation audit

Population: the complete reviewed image-only evaluation library, 255 cards and 509 original images. It is the entire eligible reviewed cohort (`eligible_source_count = 255`), not all objects in Production Storage.

| Measure | Result |
|---|---:|
| Manually confirmed upside-down cards | 0 / 255 |
| Manually confirmed upside-down images | 0 / 509 |
| EXIF Orientation present | 0 / 509 |
| Portrait images | 363 |
| Landscape images | 146 |
| 95% upper bound after zero observed events | 1.17% per card; 0.59% per image |

Generic Tesseract orientation detection was evaluated only as a diagnostic. It returned a non-zero rotation for 62 normal images (42 at 180°, 7 at 90°, 13 at 270°), including legitimate landscape cards and sideways card layouts. Manual review found those candidates upright. Automatic OCR-based rotation would therefore create substantially more errors than it repairs.

A same-call prompt asking Luna to mentally rotate inverted images was tested on 13 problem cards, each upright and synthetically rotated 180°. Only 7/13 rotated results stayed within 0.05 F1 of the upright result. One severe failure changed a 2001 Willie Mays / Barry Bonds card into 2007 David Wright / Hank Aaron. The instruction was removed from the Production candidate.

## Grading audit

In the fresh-150 cohort, 45 cards were graded. The old scalar `grade` field populated on 44/45, so the main defect was not wholesale omission. It was semantic collapse:

- `PSA 9/10` became `PSA 9`.
- A card grade plus separate autograph grade became one number.
- `PSA Auto 9` was sometimes rendered as `PSA Authentic`.

CSM already defines Grading Info as structured semantics. The thin application schema had silently reduced it to one display string. The fix makes the provider return `company`, `card_grade`, `auto_grade`, and `grade_type`, while Composer still treats the rendered grading bracket as one high-priority atomic unit.

Independent 105-card result:

| Metric | Old control | Structured grading |
|---|---:|---:|
| Graded cards | 38 | 38 |
| Exact grading | 33 (86.8%) | 38 (100%) |
| Exact-grade repairs | — | 5 |
| Exact-grade regressions | — | 0 |
| Macro title F1 | 0.78235 | 0.77731 |
| Paired wins / losses / ties | — | 31 / 33 / 41 |

## Slab color and parallel audit

The initial 150 review found two distinct loss modes:

1. false visual names such as `Rainbow Foil`, `Green Prizm`, or `Blue Foil` when the reviewed title had no such parallel;
2. a literal label parallel such as `Blue Shimmer`, `Orange Refractor`, or `Gold Refractor` present in canonical fields but dropped by the 80-character Composer under COS-8's secondary Print Finish priority.

The independent 105-card slab-color proxy did not justify a Production rule. A slab-specific anti-guess instruction reduced false-color cards from 3 to 2 but increased missed-color cards from 5 to 6. A zero-call rule that suppressed every non-literal graded finish changed seven cards, with three wins and four losses (macro F1 +0.00044). Both mechanisms remain evaluation-only.

The next admissible design is source-aware, not stricter guessing: Luna must preserve the exact slab-label phrase plus `source_region = slab_label`; only that literal phrase may outrank visual appearance. Label background color and case reflections remain observations, never automatic commerce facts.

## Evidence and reproducibility

- Reviewed cohort: `/Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json`
- Fresh-150 control: `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl`
- Orientation/grading targeted probe: `artifacts/orientation-grading-probe-2026-08-03.json`
- Independent 105 structured-grading run: `artifacts/accuracy-structured-grading-105-2026-08-03/thin-path-gpt-5.6-luna.jsonl`
- Graded finish suppression replay: `artifacts/graded-finish-evidence-policy-replay-105-2026-08-03.json`
- Reusable probes: `scripts/run-orientation-grading-probe.mjs` and `scripts/replay-graded-finish-evidence-policy.mjs`
