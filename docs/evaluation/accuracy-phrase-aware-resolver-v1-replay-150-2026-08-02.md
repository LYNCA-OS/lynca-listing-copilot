# Phrase-aware resolver v1 — retained 150 replay (2026-08-02)

## Decision

The opposing hypothesis is that all 73 token matches should be restored once
an exhaustive observation contains the missing word. The retained evidence
rejects that design. A token hit does not distinguish `Rookie` printed as a
card mark from “rookie season” in a biography, `Horizontal` from a named insert
versus back-layout stripes, or a release year from a copyright/statistics year.

The positive asset is a smaller resolver whose evidence unit is:

`complete observation phrase + region + semantic role + modality + confidence + candidate field + provenance`.

It returns only a typed candidate decision and reason. It does not receive a
reference title, compose a title, call a provider, or enter the production
path. A separate deterministic replay guard withholds any otherwise-admissible
phrase that displaces an existing title token.

On the already-paid 150-card cohort, the guarded phrase resolver is a replay
candidate:

| Comparison | Before F1 | After F1 | Delta | Wins / losses / ties | Safety |
|---|---:|---:|---:|---:|---|
| Phrase only vs raw canonical | 0.766927 | 0.774025 | +0.007099 | 13 / 0 / 137 | STOP: 3 actions displaced 6 existing title tokens |
| Phrase incremental vs current expression overlay | 0.772986 | 0.776456 | +0.003470 | 7 / 0 / 143 | STOP: 2 actions displaced 3 existing title tokens |
| **Guarded phrase incremental vs current expression overlay** | **0.772986** | **0.775135** | **+0.002149** | **5 / 0 / 145** | **REPLAY_CANDIDATE** |
| Guarded phrase after token-oriented schema73 overlay | 0.777871 | 0.778185 | +0.000314 | 1 / 0 / 149 | REPLAY_CANDIDATE |

The guarded arm has zero reference-token loss, zero existing-title-token loss,
zero unbacked numeric addition, zero unsupported numeric-field change, zero
serial numeric mutation, zero unrelated field drift, and zero titles over 80.
This is offline evidence, not production promotion and not a substitute for a
new paid 150 run after mechanisms are bundled.

## What the phrase unit changes

The module never rebuilds a registered phrase from independent token hits.
For example, `STAR` plus `WARS` produces no candidate; the complete printed
logo phrase `STAR WARS` does. Single-word identities such as `NBL` and
`GRAPHITE` qualify only when the entire observation is that logo phrase and
the role, region, confidence, existing product context, and destination field
all pass.

Typed paths covered by v1:

| Evidence phrase | Required role/context | Typed destination | Result on retained 150 |
|---|---|---|---|
| `STAR WARS` | high-confidence printed identity logo | Standard Set / TCG IP | Standalone recovery; current expression overlay already covers the winning Star Wars row |
| `Disney` | high-confidence printed identity logo | TCG IP; Standard compatible Set | Two TCG IP admissions; Standard duplicates are neutral |
| `NBL` | full printed logo, empty compatible Set | Set | One winning card |
| `GRAPHITE` | full printed logo, empty Product | Product | Typed admission, title-neutral because current expression already renders it |
| `VeeFriends` | full printed logo, empty compatible identity slot | Standard Set / TCG IP | Existing expression already represents the retained row |
| `PICK 2` | exact whole front phrase plus Signature Class product context | Card Name | One winning card; no split `pick` / `2` logic |
| `2018-19 ...` / `2020-21 ...` | full four-digit season inside typed Set/season role | Year | Two winning full-phrase suffix restorations |
| `18-19` | typed Season role and canonical year equals the season start | Year | One additional winning card after the token overlay |
| `2024 BOWMAN DRAFT` | exact slab Set phrase plus Bowman product context | Set candidate | Correctly typed, but held by Composer displacement guard |
| `OPTIC` | exact front logo plus compatible Donruss base product | Product extension candidate | Correctly typed, but held by Composer displacement guard |

The five guarded winning cards and exact phrases are:

| Asset suffix | Phrase | Field/value | Per-card F1 delta |
|---|---|---|---:|
| `dfba61396ec82f2b864e` | `2018-19 PANINI – PRIZM BASKETBALL` | Year `2018-19` | +0.047619 |
| `3215d29874a3dad22bbb` | `NBL` | Set `NBL` | +0.066176 |
| `a38ced8b163264d9d95a` | `2020-21 PANINI - CONTENDERS BASKETBALL` | Year `2020-21` | +0.043333 |
| `940144961215fef91c18` | `PICK 2` | Card Name `Pick 2` | +0.118182 |
| `f246b38058854d10b78a` | `18-19` | Year `2018-19` | +0.047101 |

`STAR WARS` independently changes the raw canonical title from
`Topps Chrome Qui-Gon Jinn Obi-Wan Kenobi Darth Maul Duel of the Fates` to
`Topps Chrome Star Wars Qui-Gon Jinn Obi-Wan Kenobi Darth Maul Duel of the Fates`
and adds +0.102336 on that card. It is not counted again as incremental because
the existing expression overlay already recovered it.

## Token-oriented versus phrase-aware contribution

Both are measured on top of the same current expression-overlay baseline:

| Resolver | Macro F1 delta | Winning cards | Notes |
|---|---:|---:|---|
| Existing token-oriented schema73 overlay | +0.004884 | 9 | Broader direct recovery, including serial and specialized compaction |
| Guarded phrase-aware resolver | +0.002149 | 5 | No title displacement, numeric mutation, reference loss, field drift, or >80 |
| Phrase-aware after token overlay | +0.000314 | 1 | Exact `18-19` Season phrase is genuinely independent |

At card level there are 4 shared wins, 5 token-only wins, and 1 phrase-only
win. Therefore phrase awareness is not a replacement for every existing exact
resolver. Its independent value is role safety plus one additional season
recovery; its larger long-term value is making candidate provenance and
rejections explicit.

The old 100-card diagnosis contains exactly 73 schema-compression token
occurrences. Complete-phrase resolution classifies them as 8 guarded admits,
5 already represented, 3 candidate-only, 25 explicit rejects, and 32 with no
v1 phrase rule. This is the intended difference from token matching: all 73
remain visible opportunities, but only the evidence-bearing subset receives
automatic field authority.

On the newer 109-occurrence fresh150 schema ledger, the guarded resolver gives:

| Fresh150 semantic class | Total | Admit | No change | Candidate only | Reject | No v1 rule |
|---|---:|---:|---:|---:|---:|---:|
| Safe direct | 52 | 9 | 4 | 5 | 1 | 33 |
| Needs evidence | 34 | 0 | 0 | 0 | 19 | 15 |
| Synonym | 11 | 0 | 0 | 0 | 0 | 11 |
| Wrong role | 12 | 0 | 0 | 0 | **12** | 0 |
| **Total** | **109** | **9** | **4** | **5** | **32** | **59** |

The one `safe_direct` rejection is deliberate: the season-looking phrase is
labeled `copyright_set_line`. This v1 obeys the stricter source-role boundary
rather than using its reference agreement after the fact.

## Wrong-role collision audit

Across all retained exhaustive observations, v1 constructed negative probes
only to exercise the source-role gate. It rejected 822 of them before field
admission:

| Rejection family | Decisions | Examples |
|---|---:|---|
| Uniform/background/layout/artwork | 575 | uniform blue, background red, back stripes horizontal, black illustration |
| Copyright/legal/licensing | 212 | copyright year, `ALL RIGHTS RESERVED` |
| Statistics | 27 | statistic year or numbered table values |
| Biography/career | 8 | “rookie season”, “Rookie of the Year” |

These 822 are guard-coverage decisions, not 822 claimed accuracy wins and not a
proposal to emit this volume in the runtime path. The fresh150 ledger's 12
human-labeled wrong-role occurrences are all 12 explicitly rejected.

## Failed first pass and correction

The first complete-phrase pass still lost 5 cards. It allowed a short
`YY-YY` observation to rewrite a canonical ending year backward. That turned,
for example, canonical/reference `2025` into `2024-25`, `2020` into `2019-20`,
and `2012` into `2011-12`. The error demonstrates that “whole phrase” alone is
not sufficient; a season label can describe statistics rather than release.

The corrected rule is asymmetric:

- a full `YYYY-YY` phrase in an allowed typed Set/season role may propose that
  exact consecutive season;
- a short `YY-YY` phrase may only extend a canonical year whose last two
  digits equal the **starting** suffix;
- it never rewrites an ending-year canonical value backward;
- copyright roles are rejected even when the phrase happens to agree with the
  reviewed title.

After that correction, the unguarded phrase arm is 7 wins / 0 losses. It still
is not safe to promote because two winning identity actions displace existing
title content under the 80-character Composer:

| Candidate | F1 effect | Displaced existing tokens | Decision |
|---|---:|---|---|
| `2024 BOWMAN DRAFT` → Set `Draft` | winning | `Edition` | candidate-only until Composer/downstream recovery is combined |
| `OPTIC` → Product `Donruss Optic Football` | winning | `Purple Prizm` | candidate-only until Composer/downstream recovery is combined |

The displacement guard does not inspect the reference; it simply refuses to
trade away existing title tokens. That leaves the strict 5-win, 0-loss safe
subset above.

## Reproducibility and boundaries

- Provider calls: **0**.
- Cards: exactly 150 canonical, 150 expression, and 150 exhaustive rows with
  identical unique asset sets.
- Production imports or default-path changes: **0**.
- Resolver authority: `evaluation_only`; `production_promoted: false`.
- Input checkpoint SHA-256: `2701f77cef30c0f7d409b8ec8c08ff92015fc1e19f76ff13ef2b5421798844b5`.
- Exhaustive checkpoint SHA-256: `96f71ae0956e1c7defde2579ad7448d955c0f7c33b69c908207855052faad1f9`.
- Cohort SHA-256: `c63287ca0d76f669385a720987b36f49a4495b40fe82b1133287fe2c4f272bf7`.
- Resolver SHA-256: `1b0a71ea46437f5a6f642df056f6e3f96a737957a926e55cf6719cecf55f9029`.
- Replay script SHA-256: `f02682828f202c387fdd2d4e4f03c03f2ad509d8d1906798d0645e421042270e`.
- Result JSON SHA-256: `1964ff2c89d77652bda53b815c41e509052561f846e94290f5d735163d467905`.

The guarded resolver may join the accumulated replay-positive mechanism set.
It should not be promoted alone: the user-defined gate remains a bundled real
150-card run, and the two displaced-but-winning Product/Set candidates should
be retested only after the downstream 53 Composer mechanism can preserve their
existing fields.
