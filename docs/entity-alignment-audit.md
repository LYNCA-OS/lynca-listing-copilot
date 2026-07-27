# Entity alignment offline audit

Generated 2026-07-27T17:17:38.370Z. Pure replay only; no database, model, or production behavior.

## Operating point

`NONE` is emitted only when a non-empty claim has no semantic relation to any caller-supplied authoritative candidate. Empty candidate coverage is `UNCHECKED`. Ties return all best candidates and no selected value. This deliberately biases against false `NONE`.

## NONE calibration

| cohort | checked | independently labelled | TP | FP | FN | TN | NONE precision | NONE recall | false-NONE rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| unseen checklist identity | 17/17 | 17/17 | 11 | 0 | 0 | 6 | 100.00% | 100.00% | 0.00% |
| familiar reviewed product only | 59/60 | 0/60 | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

The familiar cohort has 59/60 product claims with a comparison candidate and predicted NONE on 0/59, but it has 0/60 independent NONE labels. Its confusion matrix, precision, recall and false-NONE rate are therefore `UNCHECKED`, not zero. Familiar set claims are excluded because reviewed titles are not independent field-level set truth.

The unseen confusion matrix is calibration, not a generalization estimate: its 17 labels set the operating point. The familiar rows are an unlabelled comparison diagnostic over 20 identities replayed in three rounds. Independent Validation is required before any behavior can be wired in.

## Counterfactual wiring

- Unseen cards carrying at least one predicted NONE: 11/17; correct against labels: 11/11.
- Unseen PREFIX/HYPERNYM upgrades: 3/17; improved 3, regressed 0; policy-fair recall 0.485037 -> 0.51788 (+0.032843).
- Familiar product upgrades: 1/60; improved 1, regressed 0; policy-fair recall 0.78477 -> 0.78596 (+0.00119).

This is a counterfactual report, not a proposed behavior change. The module is not imported by the recognition pipeline.

## Unseen cases

| key | expected NONE | predicted NONE | relations | upgrades | delta |
| --- | --- | --- | --- | --- | ---: |
| unseen_e90b6054163320bbc04b | true | true | Prizm:NONE; Prizm Purple:NONE | - | 0 |
| unseen_40b6057985f303926690 | false | false | Contours:EXACT | - | 0 |
| unseen_4a387a2e25fe69fa7508 | false | false | Panini Phoenix:EXACT; Phoenix:HYPERNYM | - | 0 |
| unseen_af443b0004240f0107ee | false | false | Contours:EXACT | - | 0 |
| unseen_745e2fed2b81fdb80c63 | true | true | Absolute Basketball:NONE; Rookie Signs:NONE | - | 0 |
| unseen_c1f30c005617e6986ef1 | true | true | Panini Prizm:NONE; Prizm Mosaic:NONE | - | 0 |
| unseen_e2317539ffdb61b4693b | true | true | Paragon:NONE | - | 0 |
| unseen_189096ee2adb683d47b0 | true | true | Panini Chronicles:NONE | - | 0 |
| unseen_d2014506e773d47e7536 | true | true | Panini Donruss Optic:NONE; Donruss Optic:NONE | - | 0 |
| unseen_bbfc75a6ba32ffe48343 | true | true | Panini Prizm:NONE; Prizm Mosaic:NONE | - | 0 |
| unseen_382c09472dc13c325652 | true | true | Prizm Draft Picks:NONE | - | 0 |
| unseen_e9c74d3fa6e36cc2a779 | true | true | Prizm:NONE; Emerald Prism:NONE | - | 0 |
| unseen_265e71d598ed841e4475 | true | true | Panini Prizm:NONE; Prizm Red Wave:NONE | - | 0 |
| unseen_5aaa54c150b4479171cb | true | true | Contours:NONE | - | 0 |
| unseen_302227384e4e19804899 | false | false | Panini Prizm:PREFIX; Prizm:PREFIX | Panini Prizm->Panini Prizm FIFA (25-26); Prizm->Prizm Flashback - 2015 | 0.333334 |
| unseen_39194858fc5eeec7d09d | false | false | Prizm:HYPERNYM; Talisman:SPELLING | Prizm->Panini Prizm FIFA (25-26) | 0.125 |
| unseen_09dd62702d9d39ae7da6 | false | false | Panini Prizm:PREFIX; Club Legends:PREFIX | Panini Prizm->Panini Prizm FIFA (25-26); Club Legends->Club Legends Signatures | 0.1 |
