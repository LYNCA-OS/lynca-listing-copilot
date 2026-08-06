# Fresh 150-card accuracy confirmation — 2026-08-02

This is a new paid paired run, not a replay of the earlier 150. Each of the
same 150 cards received one `thin_budgeted` call and one
`thin_canonical_high` call at GPT-5.6 Luna, reasoning `none`, image detail
`high`, concurrency 2. No Cloud Run, vector, OCR, or second model call was
used. The run wrote 300 unique card-arm rows with one provider attempt each.

## Raw paired result

| Arm | n | F1 | Recall | Precision | Median latency | Median output | Input tokens | Output tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Free expression (`thin_budgeted`) | 150 | 0.7147 | 0.7606 | 0.6830 | 4.830 s | 72 | 3,544 | 25 |
| Canonical (`thin_canonical_high`) | 150 | 0.7678 | 0.7441 | 0.8063 | 5.146 s | 63 | 5,402 | 107 |

The raw paired comparison is 95 canonical wins, 44 free wins, 11 ties,
`ΔF1=+0.0531`, exact sign-test `p=1.82e-5`. This confirms that the canonical
authority layer is materially better than free title expression on this fresh
cohort; it does **not** prove that every downstream resolver is safe.

Measured totals were 500,434 tokens for free expression and 791,646 for
canonical (496,740/3,694 and 775,440/16,206 input/output respectively). Mean
latency was 5.114 s / 5.245 s; p95 was 7.253 s / 6.999 s; maxima were 14.404 s
/ 19.169 s. These are measured token and latency totals, not a guessed dollar
cost; billing depends on the active provider price and cache treatment.

Integrity checks: 150 unique asset IDs, 300 rows, no duplicate card-arm keys,
no failed provider attempts, maximum attempt count 1, and a completed
checkpoint with 300 rows. The raw checkpoint and manifest are retained in
`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/`.

## Offline mechanism decomposition

The candidate mechanisms below were applied after the paid run, using the
current deterministic Composer and the already-paid exhaustive observation
checkpoint. This is a mechanism ledger, not another provider result.

| Mechanism | Changed | Wins | Losses | Ties | Δ macro F1 | Reference-loss cards | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Strict free-title product extension | 6 | 3 | 2 | 145 | +0.001279 | 1 | **STOP** |
| Same-value serial formatting | 5 | 4 | 1 | 145 | +0.001744 | 1 | **STOP** |
| Single-digit serial padding only | 2 | 2 | 0 | 148 | +0.001027 | 0 | candidate, evaluation-only |
| Product + broad serial bundle | 11 | 7 | 3 | 140 | +0.003023 | 2 | **STOP** |

The narrow single-digit variant only keeps `5/20 → 05/20` and `8/25 → 08/25`.
The broad serial rule also changed `29/199 → 029/199` on the Messi card and
lost the reference token; that is why the broad resolver is stopped even
though its aggregate direction is positive. The product extension lost the
`Court Kings` identity on the 1986 Star card and changed Carter Jensen to the
wrong `Topps Chrome` product on another card. The combined bundle therefore
cannot be shipped wholesale.

### Changed-card ledger

| Card | Mechanism | Baseline → candidate | ΔF1 | Decision reason |
| --- | --- | --- | ---: | --- |
| George Kittle | serial | `27/150 → 027/150` | +0.1000 | useful, but broad rule not safe |
| Disney Anna | serial | `82/100 → 082/100` | +0.0909 | useful, but broad rule not safe |
| Justin Herbert | single-digit serial | `5/20 → 05/20` | +0.0741 | narrow candidate |
| Kobe Bryant | single-digit serial | `8/25 → 08/25` | +0.0800 | narrow candidate |
| Messi | broad serial | `29/199 → 029/199` | −0.0833 | critical reference loss; STOP broad rule |
| Carter Jensen | product | `Topps Series Two → Topps Chrome Series Two` | −0.0316 | wrong product extension; STOP |
| Michael Jordan (Star) | product | `Court Kings → Star` | −0.0616 | lost `Court Kings`; STOP |
| VeeFriends Common Sense Cow | product | added `VeeFriends` | +0.1364 | positive card, not enough to offset product losses |
| Michael Jordan (MJx) | product | added `MJx` | +0.0784 | positive card, not enough to offset product losses |
| VeeFriends Adaptable Alien | product | added `VeeFriends` | +0.0702 | positive card, not enough to offset product losses |

The full per-card and per-field JSON ledger is
`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/mechanism-decomposition.json`.
The older baseline-commit comparison, including token-safety proxies, is in
`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/bundle-replay.json`; it
also reports 15 wins / 2 losses and therefore remains STOP as a wholesale
bundle.

## Promotion decision

Do not alter production from this run. The production-safe result is the
existing canonical path. Keep only the narrow single-digit serial rule as an
evaluation candidate; it was selected after inspecting this confirmation set,
so it still needs an independent, pre-registered 150-card confirmation before
promotion. Keep broad serial and free-product projections disabled. No code in
the production checkout was changed by this experiment.

The next lowest-cost step is to pre-register the narrow serial rule together
with other independently positive, zero-call mechanisms and run one fresh
150-card confirmation. If that bundle has any reference-loss card, over-80
title, or net negative field ledger, retain the useful observations but do not
ship the mechanism.

## Where the remaining 20% is lost

The paired exhaustive/canonical audit on the same 150 IDs makes the next
investment explicit:

| Earliest loss stage | Cards | Reference-token occurrences | What it means |
| --- | ---: | ---: | --- |
| Exhaustive not expressed | 118 | 255 | The model did not emit the helpful token even with compression removed; prioritize visual/readability and world-model prompting. |
| Canonical schema compression | 76 | 109 | The model emitted it in exhaustive mode but the canonical schema omitted it; prioritize additive evidence/field admission. |
| Downstream composition | 46 | 63 | The canonical fields had it but the title profile/composer dropped it; prioritize SEM/Composer recovery. |

The largest omitted token families are `refractor` (24) and `ssp` (13) at the
model-expression stage, `rookie` (9), `autograph` (6), and `red` (6) at schema
compression, and `blue` (4), `dodgers` (3), `lakers` (3), and `orange` (3) at
composition. This is why the next mechanism should not be another blanket
constraint: the largest bucket is before CSM can help. It should be a small,
source-anchored evidence admission or visual/world-knowledge experiment, then
the same 150 replay/real gate.

Machine-readable audit:
`artifacts/accuracy-bundle-confirmatory-150-2026-08-02/exhaustive-loss-audit.json`.
