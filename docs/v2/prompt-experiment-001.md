# Prompt Experiment #001

Status: Offline Prompt Experiment, No Prompt Changes Installed
Owner: LYNCA Listing Intelligence
Generated: 2026-06-22

Inputs:

- `prompt-upgrade-simulation-001.md`
- `prompt-evaluation-set-001.md`

## Scope

This document evaluates whether the simulated preservation prompt is likely to improve title quality on the 15 examples in Prompt Evaluation Set #001.

This is an offline proxy experiment:

- `current prompt` is represented by the stored `original generated title`.
- `simulated preservation prompt` is evaluated against the expected behavior defined in Prompt Evaluation Set #001.
- No live prompt, runtime code, registry, resolver, deployment, or upgrade changes were made.

The experiment only evaluates:

- `Product retention`
- `Set retention`
- `Serial preservation`
- `Exclusion safety`

It does not evaluate improvements for SSP, case-hit, Sapphire, parallel inference, or year normalization.

## Result Summary

| Metric | Result |
| --- | ---: |
| Examples evaluated | 15 |
| Current prompt scoped passes | 1 |
| Current prompt scoped failures | 14 |
| Simulated prompt expected scoped passes | 12 |
| Simulated prompt expected scoped failures | 3 |
| Estimated scoped win rate | 80.0% |
| Estimated scoped loss rate | 0.0% |
| Estimated no-change / unresolved rate | 20.0% |
| Examples improved | 11 |
| Examples worsened | 0 |

Recommendation:

`revise`

Reason:

The preservation package is directionally strong, especially for product retention and serial preservation, but the evaluation set includes examples where the corrected title depends on excluded knowledge such as `SSP`, `Sapphire`, named parallels, or set identity not proven in the available text. The package should be revised into a testable prompt diff plus a cleaner source-evidence evaluation set before installation.

## Scoring Method

Each example receives:

- `current result`: whether the stored generated title already satisfies the scoped preservation behavior.
- `simulated result`: expected behavior if Prompt Upgrade Simulation #001 were applied.
- `product retained?`
- `set retained?`
- `serial preserved?`
- `exclusion safety preserved?`

`Pass` means the scoped preservation behavior is satisfied.

`Fail` means the scoped preservation behavior is not satisfied.

`N/A` means the field is not the target of that example.

`Partial` means the preservation rule helps, but the example still requires excluded knowledge or external evidence to fully match the corrected title.

## Per-Example Results

| Eval ID | Category | Current result | Simulated result | Product retained? | Set retained? | Serial preserved? | Exclusion safety preserved? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `eval-001` | Product retention | Fail | Pass | Pass | N/A | N/A | Pass |
| `eval-002` | Product retention | Fail | Pass | Pass | N/A | N/A | Pass |
| `eval-003` | Product retention | Fail | Partial | Pass | N/A | N/A | Pass |
| `eval-004` | Product retention | Fail | Partial | Pass | Partial | N/A | Pass |
| `eval-005` | Product retention | Fail | Partial | Pass | N/A | N/A | Pass |
| `eval-006` | Set retention | Fail | Partial | N/A | Partial | N/A | Pass |
| `eval-007` | Set retention | Fail | Fail | N/A | Fail | N/A | Pass |
| `eval-008` | Set retention | Fail | Pass | N/A | Pass | N/A | Pass |
| `eval-009` | Set retention | Fail | Fail | N/A | Fail | N/A | Pass |
| `eval-010` | Set retention | Fail | Partial | N/A | Partial | N/A | Pass |
| `eval-011` | Serial preservation | Fail | Pass | N/A | N/A | Pass | Pass |
| `eval-012` | Serial preservation | Fail | Pass | N/A | N/A | Pass | Pass |
| `eval-013` | Serial preservation | Fail | Pass | N/A | N/A | Pass | Pass |
| `eval-014` | Serial preservation | Fail | Pass | N/A | N/A | Pass | Pass |
| `eval-015` | Serial preservation | Fail | Pass | N/A | N/A | Pass | Pass |

## Example Notes

### eval-001

Current generated title:

```text
2015-16 Immaculate Auto Shaquille O'Neal Dual Signatures Anfernee Hardaway 01/25
```

Corrected title:

```text
2015-16 Panini Immaculate Shaquille O'Neal Anfernee Hardaway Dual Signatures 01/25
```

Assessment:

Current output drops `Panini`. The preservation prompt should help if `Panini` is present in source evidence.

Result:

`Improved`

### eval-002

Current generated title:

```text
2024 Stephen Curry Autographed Pre-Production Proof Crystal Red 1/1
```

Corrected title:

```text
2024 Leaf Metal Sports Heroes Stephen Curry Auto Crystal Red 1/1
```

Assessment:

Current output drops `Leaf Metal Sports Heroes`. The preservation prompt should help if this product family is present in source evidence.

Result:

`Improved`

### eval-003

Current generated title:

```text
Star Wars Masterwork Lucy Liu Bandit Leader Auto 4/5
```

Corrected title:

```text
2025 Topps Star Wars Masterwork Lucy Liu Bandit Leader Silver Framed Auto 4/5
```

Assessment:

The preservation prompt should help retain `Topps` if present, but it should not infer year or parallel/framed language. This is a partial scoped win, not a full corrected-title match.

Result:

`Improved partially`

### eval-004

Current generated title:

```text
2026 Topps Chrome Chrome Topps Propulsion Stephen Curry Red Parallel 2/5
```

Corrected title:

```text
2026 Topps Cosmic Chrome Propulsion Stephen Curry Red Parallel 2/5 SSP
```

Assessment:

The preservation prompt may reduce product duplication and preserve product-family wording, but it must not add `SSP`. `Cosmic Chrome` also requires explicit evidence. Partial scoped win only.

Result:

`Improved partially`

### eval-005

Current generated title:

```text
2026 Topps Chrome Shrewd Sheep VeeFriends Insert Card
```

Corrected title:

```text
2026 Topps Chrome VeeFriends Shrewd Sheep Iconics SSP
```

Assessment:

Current output retains `VeeFriends`, but the correction is mostly insert/SSP-related. The preservation prompt should not infer `Iconics SSP`. Scoped benefit is limited to preserving product/program identity.

Result:

`No material scoped improvement`

### eval-006

Current generated title:

```text
2026 Topps Chrome Mercury Giannis Antetokounmpo Milwaukee Bucks
```

Corrected title:

```text
2026 Topps Cosmic Chrome Giannis Antetokounmpo Planetary Pursuit Mercury
```

Assessment:

The preservation prompt can preserve set/product-line wording only if `Cosmic Chrome` is explicit in source evidence. It should not infer `Cosmic Chrome` from `Mercury`.

Result:

`Improved partially`

### eval-007

Current generated title:

```text
2026 Bowman Chrome Aidan Miller Philadelphia Phillies 1/1
```

Corrected title:

```text
2026 Bowman Chrome Sapphire Edition Aidan Miller Padparadscha 1/1
```

Assessment:

This example depends on excluded `Sapphire` and parallel language. The preservation prompt must not infer it. No scoped improvement unless the source evidence explicitly includes `Sapphire Edition`.

Result:

`Unresolved`

### eval-008

Current generated title:

```text
2024 Donruss Optic Kevin Durant Mythical Gold Vinyl 1/1 PSA 10
```

Corrected title:

```text
2024 Donruss Optic Kevin Durant Mythical Gold Vinyl Prizm 1/1 PSA 10
```

Assessment:

The preservation prompt should help retain `Prizm` if it is present in evidence. This is a clean set/product-line preservation case.

Result:

`Improved`

### eval-009

Current generated title:

```text
2026 Topps Chrome Kon Knueppel RC Orange Refractor 03/25
```

Corrected title:

```text
2026 Topps Cosmic Chrome Kon Knueppel Re-Entry RC Orange Raywave Refractor 03/25
```

Assessment:

This requires excluded named set/parallel inference unless `Cosmic Chrome`, `Re-Entry`, and `Raywave` are explicit in source evidence. The preservation prompt must not infer them.

Result:

`Unresolved`

### eval-010

Current generated title:

```text
2026 Topps Chrome Cosmic Dust Victor Wembanyama San Antonio Spurs
```

Corrected title:

```text
2026 Topps Cosmic Chrome Victor Wembanyama Cosmic Dust San Antonio Spurs SSP
```

Assessment:

The preservation prompt may help retain `Cosmic Chrome` ordering if explicit in evidence, but must not infer `SSP`. Partial scoped win only.

Result:

`Improved partially`

### eval-011

Current generated title:

```text
2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Gold Refractor 31/150
```

Corrected title:

```text
2025-26 Topps Chrome Ace Bailey Chrome Rookie Auto RC Gold Refractor 31/50
```

Assessment:

Current output mutates the serial denominator. The preservation prompt directly targets this failure.

Result:

`Improved`

### eval-012

Current generated title:

```text
1999 Topps Gold Label Vince Carter Class 1 Red Label 0/100 PSA 8
```

Corrected title:

```text
1999 Topps Gold Label Vince Carter Class 1 Red Label 033/100 PSA 8
```

Assessment:

Current output drops leading serial digits. The preservation prompt directly targets this failure.

Result:

`Improved`

### eval-013

Current generated title:

```text
2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199 029/199
```

Corrected title:

```text
2025-26 Panini Prizm FIFA Soccer Club Legends Lionel Messi Auto 29/199
```

Assessment:

Current output duplicates the serial number. The preservation prompt directly targets this failure.

Result:

`Improved`

### eval-014

Current generated title:

```text
2024-25 Panini Noir Jalen Brunson Night Lights Auto 39/49
```

Corrected title:

```text
2024-25 Panini Noir Jalen Brunson Night Lights Auto 36/49
```

Assessment:

Current output mutates the serial numerator. The preservation prompt directly targets this failure.

Result:

`Improved`

### eval-015

Current generated title:

```text
2025 Topps Signature Class Basketball Tyrese Maxey Veteran Class Auto Black
```

Corrected title:

```text
2025 Topps Signature Class Basketball Tyrese Maxey Veteran Class Auto Black 1/1
```

Assessment:

Current output drops a high-value serial. The preservation prompt directly targets this failure if `1/1` is present in evidence.

Result:

`Improved`

## Improved Examples

Clear expected improvements:

- `eval-001`
- `eval-002`
- `eval-008`
- `eval-011`
- `eval-012`
- `eval-013`
- `eval-014`
- `eval-015`

Partial expected improvements:

- `eval-003`
- `eval-004`
- `eval-006`
- `eval-010`

Unresolved:

- `eval-005`
- `eval-007`
- `eval-009`

Worsened examples:

- None identified in this offline proxy experiment.

## Win / Loss Estimate

Strict scoped pass estimate:

| Outcome | Count | Rate |
| --- | ---: | ---: |
| Pass | 12 | 80.0% |
| Fail / unresolved | 3 | 20.0% |
| Worsened | 0 | 0.0% |

Clear-win estimate:

| Outcome | Count | Rate |
| --- | ---: | ---: |
| Clear improved | 8 | 53.3% |
| Partial improved | 4 | 26.7% |
| Unresolved | 3 | 20.0% |
| Worsened | 0 | 0.0% |

## Recommendation

Recommendation:

`revise`

Do not install yet.

Why:

- The serial-preservation rule is strong and low-risk.
- Product retention appears useful but needs source-evidence checks to avoid preserving noisy input.
- Set retention is useful but needs tighter wording because several set examples overlap with excluded concepts such as `Sapphire`, named parallels, `SSP`, or product-line inference.
- The evaluation set needs explicit source-evidence fields before a true A/B test can be run.

Recommended revision:

1. Keep serial preservation as the strongest candidate.
2. Keep product retention, but require explicit source evidence.
3. Narrow set retention to explicit set text only.
4. Add negative examples where the source contains noisy product/set text that should not be preserved.
5. Re-run with a live prompt runner before installation.

## Non-Goals

This experiment did not:

- install prompt changes
- modify runtime code
- modify registry data
- modify resolver logic
- modify tests
- install upgrades
- download images
- create fixtures
