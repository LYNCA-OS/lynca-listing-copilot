# Identity field lifecycle: where checklist facts can and cannot reach a title

This is an offline structural audit of `origin/main@dbc989e1`. It changes no
recognition behaviour. The evidence is the three recorded reports
`vocab17-candidate-r1/r2/r3.json`: 60/60 observations, but only 20 distinct
`source_feedback_id` values replayed three times. Counts below are therefore
observations out of 60, not 60 independent cards.

The report hashes are:

- r1 `aba5f50adee0f6526a6ca735e47ab034bcd4642dc971d43e465ddcb97dac0a69`
- r2 `43de606be02ee6878c40b6ca622ae4142fb30d76ff746317df957c6238c1cea8`
- r3 `902c4f855f71e2727ccd812011e55aa8b610dd898e0dab4b26c1ddaf0835aa28`

## The corrected structural finding

The earlier inference that `year`, `manufacturer`, `brand`, and `product` were
blocked on 60/60 cards was wrong. The top-level `blocked_fields` is the union of
blocked fields from every rejected neighbour, not the selected candidate. That
union is built in
`lib/listing/candidates/retrieval-application-layer.mjs:525-530`.

The selected path says something materially different:

- Catalog returned candidates on 50/60 observations.
- Catalog had at least one decision-eligible candidate on 47/60.
- Catalog was selected on 44/60: 35 `INTERNAL_APPROVED_HISTORY`, 9
  `OFFICIAL_CHECKLIST`.
- The selected match was `EXACT_CARD_MATCH` on 9/60, representing 3 distinct
  cards.
- The 35/60 selected `INTERNAL_APPROVED_HISTORY` rows use the explicit
  `reviewed_current_source_identity_match` override. They are valid for testing
  wiring, but not independent evidence of Retrieval or Selection accuracy.
- The selected safe-application object had zero blocked fields on all 44/44
  selected observations.
- Of 62 `APPLY` decisions, 53 reached the final Resolver output, across 25/60
  observations.
- Vector candidates existed on 48/60 and were decision-eligible on 6/60, but
  were selected and applied on 0/60.

The index is therefore not merely a juror. It can fill selected, trusted,
conflict-free fields. Its real limitations are earlier identity eligibility,
field-name adapters, missing-only replacement policy, and incomplete Resolver
trace.

## Ownership and value flow

```text
Provider / OCR / Catalog / Vector / terminal cache
                         |
                         v
               Candidate Control Plane
                         |
                         v
           Retrieval Application decisions
                         |
                         v
          Identity Resolver -- final field owner
                         |
                         v
       Deterministic Renderer -- final title owner
```

The concrete boundaries are:

| boundary | current owner | source |
| --- | --- | --- |
| Provider raw and normalized observations | Native recognition core | `lib/listing/v4/pipeline/native-recognition-core.mjs:2468-2508` |
| Catalog/Vector candidate projection | Retrieval packet | `lib/listing/retrieval/vector-candidate-packet.mjs:215-246` |
| Per-field candidate permission | Candidate policy | `lib/listing/candidates/candidate-application-policy.mjs:12-64,230-264` |
| Current-image anchor compatibility | Retrieval packet | `lib/listing/retrieval/vector-candidate-packet.mjs:985-1094` |
| Only admitted retrieval evidence entering the Resolver | Resolution gate | `lib/identity-resolution/listing-resolution-gate.mjs:2856-2903` |
| Preservation of admitted `APPLY` evidence | Identity Resolver | `lib/identity-resolution/solver.mjs:309-323` |
| Resolver output becoming presentation fields | Native recognition core | `lib/listing/v4/pipeline/native-recognition-core.mjs:941-1006` |
| Deterministic title | Renderer/finalizer | `lib/listing/v4/pipeline/native-recognition-core.mjs:1071-1137` |
| Whole terminal result replay | Identity cache | `lib/listing/v4/pipeline/native-recognition-core.mjs:1980-2050` |

Cache field behaviour is `UNCHECKED` in this cohort: reads were explicitly
bypassed on 60/60 and hits were 0/60.

## Recorded lifecycle by SEM field group

`A/S/B/R` below means `APPLY / SUPPORT / BLOCK / REJECT` from the untruncated
`l2_candidate_debug.retrieval_application.decisions`. The smaller evaluation
packet is not used for totals because it truncates candidate and action rows.

| field group | where a value was born | after normalization | application | after Resolver | title expression |
| --- | --- | --- | --- | --- | --- |
| Year / Product / Set | Provider: year 57/60, manufacturer 60/60, brand 50/60, product 60/60, set 44/60, subset 10/60, insert 4/60. Catalog 50/60; Vector 48/60; OCR 0/60; Cache 0/60. | year 57/60, manufacturer or brand 60/60, product 58/60, set 40/60, subset 10/60, insert 7/60 | Selected fields: year/product 44/60, manufacturer/brand 41/60, set 3/60. `A=49` over 25/60 cards; 42 reached final. `S=149` over 46/60; `B=8` over 6/60; `R=1598` over 60/60. | year 57/60, manufacturer/brand 60/60, product 59/60, set 40/60, subset 9/60, insert 10/60. One subset value is not preserved. | Exact title spans: year 57/60, manufacturer 59/60, product 48/60, set 32/60. |
| Subject | Provider players 60/60 and team 42/60. Catalog subject agreement 50/60; Vector agreement 20/60; selected Catalog agreement 44/60. | player/players 60/60; team 42/60 | Subject decisions: **0/60**. | Meaningful player/players 53/60 and team 40/60; subject value lost on 7/60, team on 2/60. | Subject span 50/60. |
| Parallel / finish | Provider surface color 44/60, exact parallel 5/60, variation 5/60, family 2/60. Catalog 37/60; Vector 45/60. | surface 44/60, family 23/60, exact 5/60, variation 5/60 | Selected candidate carries a finish field on 17/60. `A=6` on 6/60 and all six reached final; `S=31` on 17/60; `B=5` on 3/60; `R=360` on 50/60. | surface 44/60, family 26/60, exact 11/60, variation 5/60; family lost on 6/60, exact on 2/60. | Print-finish span 38/60; variation span 4/60. |
| Numerical rarity / serial | Provider print-run number, numerator and denominator each 36/60; numerical rarity 26/60; serial number 18/60; numbered-to 4/60. Catalog 44/60; Vector 45/60; OCR patch 1/60. | serial number 37/60; four denominator aliases each 36/60; numerator 36/60 | Candidate denominator present on 57/60 and selected on 26/60. `A=0`, `S=0`, `B=104` on 26/60, `R=810` on 54/60. | Four denominator aliases 36/60, numerical rarity 36/60, serial number 36/60, numerator 34/60. Serial is lost on 1/60 and numerator on 2/60. | Numerical-rarity span 29/60. |
| Card number / checklist code | Provider card number 49/60, collector number 14/60, checklist code 4/60. Catalog 27/60; Vector 3/60; OCR patch 0/60. | card number 43/60, collector 12/60, checklist 4/60 | Selected collector 9/60, checklist 3/60. `A=3` on 3/60 and all reached final; `S=12` on 9/60; `B=0`; `R=87` on 27/60. | Of 43 provider `card_number` values, 34 survive through collector/checklist aliases; 9/60 have no value under any number alias. | Card-number span 6/60. |
| Grade / certification | Provider company, card grade and cert each 15/60; grade type 13/60. OCR grade patch 0/60. Candidate grade presence is not retained in trace, so it is `UNCHECKED`. | company/card grade/grade 15/60; grade type 15/60; cert **15/60 to 0/60**. | Candidate grade decisions 0/60. | company/card grade/grade 15/60; auto grade 8/60; cert 0/60. | Grading span 15/60. |

The renderer packet says `dropped_fields=0` on 60/60, but this is not proof that
all fields were expressed. It checks copied keys, not semantic title spans.

## Can an exact checklist row assert each field?

### Year, product and set: it can fill an empty value; replacement is narrow

Safe identity fields are enumerated in
`lib/listing/candidates/candidate-selection-pass.mjs:619-672`; a selected,
trusted Catalog row can fill an empty Resolver value at
`lib/listing/candidates/retrieval-application-layer.mjs:169-200`.

A conflicting non-empty Provider value normally reaches
`unsafe_replacement_blocked` at
`lib/listing/candidates/retrieval-application-layer.mjs:234-238`. The genuinely
different conflicts were product on 3/60 and brand on 2/60. This gate must not
be globally removed.

### Subject: it currently cannot assert it because of an adapter break

Catalog emits `subjects` at
`lib/listing/retrieval/vector-candidate-packet.mjs:215-246`. Candidate
application then calls `normalizeResolvedFields` at
`lib/listing/candidates/candidate-application-policy.mjs:151-217`, whose subject
input is `raw.players ?? raw.player` at
`lib/listing/evidence/evidence-schema.mjs:540-545`. It never reads `subjects`.

That deterministic mismatch explains the measured state: 44/60 selected
Catalog candidates have subject agreement, yet subject application is 0/60.
The smallest safe change is one `subjects -> players` bridge before the
existing permission and Resolver gates. It does not require more Catalog
authority.

### Parallel: it can fill an empty, selected, catalog-supported finish

Application succeeded on 6/60 and all six reached final. Current-image conflict
and missing-only protection should remain; a neighbouring rainbow card must not
overwrite this physical card's finish.

### Serial: checklist may assert denominator, never this copy's numerator

Denominator fields are allowed at
`lib/listing/candidates/candidate-application-policy.mjs:48-51`; numerator,
grade, cert and physical-instance fields are forbidden at the same file's
`:54-64`. Current-image OCR can lock a numerator at
`lib/listing/v4/pipeline/native-recognition-core.mjs:1148-1242`. Only 1/60
observations used that verified OCR path.

### Card number: it can apply, but aliases obscure the trace

The application bridge maps `card_number` to a Resolver number field at
`lib/listing/candidates/retrieval-application-layer.mjs:70-77`; 3/60 candidate
values applied successfully. The packet labels all 43 provider `card_number`
values as exact-name drops even though 34/43 survive under collector/checklist
aliases. The remaining 9/60 lack a specific Resolver reason and must remain
unexplained until trace becomes alias-aware.

### Grade and cert: checklist must not assert current-instance facts

The candidate policy correctly forbids grade, cert, condition, numerator and
physical defects at
`lib/listing/candidates/candidate-application-policy.mjs:54-64`. Current
card/slab evidence remains the authority. Separately, Provider cert was present
on 15/60 but absent after normalization on 15/60 because
`lib/listing/pipeline/field-normalization.mjs:308-372` has no cert output. That
is a product-contract decision, not permission to copy another instance's cert.

## Gates and breaks ordered by measured reach

| order | structural boundary | affected observations | smallest safe next change |
| ---: | --- | ---: | --- |
| 1 | `subjects -> players` adapter is absent | selected Catalog subject agreement 44/60; application 0/60 | Add the alias at the candidate normalization boundary; retain selection, permission and Resolver gates. |
| 2 | Missing-only replacement | `unsafe_replacement_blocked` on 29/60; 26/60 are equal denominators, while only product 3/60 and brand 2/60 differ | Do not remove globally. Test only exact printed code + Official/Reviewed + stable identity fields. |
| 3 | No selected candidate | 16/60: 13 no viable and 3 low margin | Distinguish 10/60 with no Catalog row, 3/60 live-evidence failure, and 3/60 margin before changing policy. |
| 4 | Cert omitted by field normalization | 15/60 to 0/60 | If SEM needs cert, add a current-instance-only field and provenance contract. |
| 5 | True number non-preservation after alias accounting | 9/60 | Add alias-aware Resolver trace first. |
| 6 | Subject value non-preservation | 7/60 | Record the exact Resolver constraint/reason before changing resolution. |
| 7 | Parallel family non-preservation | 6/60 | Record the exact reason; do not infer permission from absence. |
| 8 | Post-observation anchor filter | 5/60 observations, 72 candidate-field decisions | Retain until independently labelled identity truth says rejected candidates were correct. |
| 9 | Product correction says `APPLY` but Resolver does not change product | 3/60 | Add the sub-rule reason. Current trace stops at `BLOCKED_BY_IDENTITY_RESOLUTION`. |
| 10 | Low-margin abstention | 3/60 | Keep until the top candidate is independently verified. |

## Trace debt found by the lifecycle scan

1. `evaluation_decision_trace_packet` truncates candidates/actions at
   `lib/listing/evaluation/evaluation-decision-trace-packet.mjs:59-111,291-294`.
   Full lifecycle totals must use the untruncated application decisions.
2. `shadow_only_reason` prefers the prompt deadline reason over the actual live
   evidence failure at
   `lib/listing/candidates/candidate-selection-pass.mjs:1022-1028`; it is
   misleading on 3/60 observations.
3. Resolver drop detection compares exact field names at
   `lib/listing/evaluation/evaluation-decision-trace-packet.mjs:235-243`; it
   falsely reports 34/43 number aliases as dropped.
4. Renderer trace at the same file's `:245-257` records key propagation, not
   semantic title inclusion. Literal-span matching at `:122-130` is the only
   available expression proxy.

The load-bearing conclusion is therefore: repair adapters and trace before
raising authority. The existing Catalog authority cannot be judged while a
known field-name mismatch and alias-blind observability sit between candidate
truth and the final title.
