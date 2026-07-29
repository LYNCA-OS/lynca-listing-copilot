# No-full-Provider route: closest feasible speed and proof gap

Date: 2026-07-30

Decision: `BUILD_EXPLICIT_ONE_SHOT_OCR_SHADOW`

Production activation: `NO_GO`

Holdout consumed: `false`

Accuracy gate: `NO_GO` — untouched Product-field Validation rejected the
current emblem sensor (`15/21` joint, `25%` emission precision). The latency
numbers below are planning clocks for a replacement sensor route, not a claim
that the present route reaches 85%.

## Decision first

The higher-confidence conclusion is the opposite of promising universal
two-to-three-second naming. With the current software, a first-time card cannot
honestly receive that SLO. The retained `3.123 s` OCR p95 was not an executable
observation: it modelled three independent crop calls as a parallel maximum,
while the current per-card capacity serializes them. It remains the most
evidence-grounded proxy for a new one-request batch, but it is not an upper
bound and must be replaced by a real card-level distribution.

The closest falsifiable architecture target is an explicit one-card batch:
three role-bound crops, one Cloud Run request, one Google `images:annotate`
request, three billable image units and one or two unique source decodes. After
replacing the online Catalog call with a versioned in-memory Release Pack, its
planning clocks are:

| Clock | p50 | p95 | Evidence class |
| --- | ---: | ---: | --- |
| Evidence-grounded one-shot proxy after admission intent | `1.89–2.64 s` | `4.27–5.62 s` | retained marginal parallel-max proxy; neither observed batch latency nor a strict upper bound |
| One-shot stretch target after admission intent | `1.55–2.29 s` | `3.00–4.34 s` | design budget only; requires a real batch p50/p95 at or below `1.0/1.85 s` |
| Current capacity-one crop graph if all three detail crops are enabled | `3.18–3.92 s` | `6.34–7.68 s` | zero-covariance serial Fenton-Wilkinson model; not a tail upper bound; detail jobs remain disabled by default |
| Same immutable-image terminal replay | `0.19–0.53 s` | `0.40–1.05 s` | architecture target; separate repeat-card route |

The closest evidence-grounded planning target is therefore **p50 at most `2.7
s` and p95 at most `5.7 s` after admission intent** for addressable first-time
cards. The separate stretch target is p50 `2.3 s` / p95 `4.4 s`; it earns no
status until the one-card OCR packet itself measures p50/p95 at or below
`1.0/1.85 s`. Neither line is a production SLO or card-level observation.

For the writer's actual clock, which starts at file selection rather than at
admission intent, pre-admission UI time and the remaining original upload must
be included. The following table sets pre-admission UI time to zero and starts
the progressive evidence branch at file selection. Its upload figures are byte
floors that exclude TLS, signing, PUT verification, retries and scheduling; they
are not measured workload percentiles:

| Input floor at `20 Mbps` | Modelled writer-visible p50 | Modelled writer-visible p95 |
| --- | ---: | ---: |
| one `6 MB` side (`2.4 s` byte floor) | `NOT_EXECUTABLE` | `NOT_EXECUTABLE` |
| two `6 MB` sides (`4.8 s` aggregate byte floor; optimistic one-card evidence-budget lower envelope) | `5.10–5.54 s` | `5.45–6.24 s` |

The one-shot contract requires front Subject plus back Year/Product and
Card-code evidence, so a one-side upload cannot execute this route. The nearest
defensible writer-visible target is therefore **two-side p50 at most `5.6 s`,
p95 at most `6.3 s`** under that uplink and file-size assumption. This remains
an optimistic lower envelope because no real paired two-side evidence packet
exists. Smaller files or a faster uplink improve the upload term; software
cannot promise those numbers independently of bytes and bandwidth.

The OCR number is intentionally no longer mislabeled as measured card latency.
The retained experiment contains 100 marginal timings for each of three crop
types, but no retained per-card batch packet. Under the actual capacity-one
call graph, a zero-covariance Fenton-Wilkinson serial-sum approximation gives
p50/p95 `2.628/5.192 s`; shared network or cold-start correlation can produce a
heavier tail, so this is not an upper bound. The independent parallel-max proxy
for the new one-request shape is `1.343/3.123 s`. The one-card p50/p95
`1.0/1.85 s` is only a stretch acceptance budget. Only a real batch-timing
packet may promote either model to an observation.

## Why the optimum is a different route

The minimum critical path runs independent work concurrently:

```text
progressive immutable upload
        |
decode once and bind current-image hashes
        |
        +------------------------------+
        |                              |
focused literal OCR             local product prototypes
        |                         query support only
        +---------------+--------------+
                        |
versioned in-memory Release Pack
VALUE / EMPTY / UNKNOWN candidate space
                        |
Candidate Selection -> Candidate Application -> Identity Resolver
                        |
deterministic 80-character Renderer -> idempotent commit
```

Full Provider observation is absent. An unresolved card reaches review or
abstention by the deadline; a targeted model may later propose only named
UNKNOWN fields. Waiting for a complete Provider response is not part of the
fast-route clock.

The optimal writer-visible schedule overlaps evidence work with the original
upload instead of adding the two durations:

```text
T_writer_visible
  = T_pre_admission_UI
    + max(T_original_upload_remaining,
          T_small_evidence_upload
            + max(T_focused_OCR, T_product_mark))
    + T_compiled_lookup
    + T_candidate_control
    + T_resolver_renderer
    + T_commit_status
```

This equation is a componentwise planning model, not the quantile of an
observed joint distribution: in particular, `max(p50_A, p50_B)` is not
generally `p50(max(A,B))`. Product-mark work is faster than OCR at the reported
component quantiles, but paired per-card timings are required before promotion.
The equation also does not erase the network lower bound. At 20 Mbps, one 6 MB
original needs at least `2.4 s` and two 6 MB originals need at least `4.8 s`
for bytes alone, excluding protocol and retry overhead. Therefore two-to-three
seconds from initial file selection is physically impossible for the latter
input. Progressive preparation can hide OCR under that transfer, but cannot
transmit bytes faster than the uplink.

## The latest sealed cold-trace numerator is zero

The independent development/validation denominator contains 148 deduplicated
identity groups: Development `118`, Validation `30`. The cold benchmark joins
95 groups to a qualifying cache-bypassed trace; 93 executed exact-anchor shadow.

| Measurement | Count |
| --- | ---: |
| exact-anchor shadow evaluated | `93/148` |
| eligible | `0/93` |
| would skip full Provider | `0/93` |
| `no_lookup_anchor` | `90` |
| `anchor_missing_sufficient_direct_context` | `3` |
| no qualifying cold trace | `55` |
| qualifying trace but no exact shadow | `2` |

The final two rows are `UNKNOWN`, not failures. They cannot be moved into the
numerator or denominator of a sensor-recall claim.

This branch now closes the previously dead software contract in a deterministic
fixture: the real OCR normalizer emits `collector_number`, `product`, and
`players`; its bundle adapter preserves canonical provenance; the pre-L2 route
uses product/subject only as Retrieval context; the selected official candidate
then passes Candidate Application and Identity Resolver to an <=80-character
writer-ready title. That proves reachability, not dataset coverage. Until a new
Development/Validation replay is run, the observed numerator remains the sealed
`0/93`, and production activation remains `NO_GO`.

It also does **not** prove default-production producer reachability. The current
default keeps `enableOcrDetail=false`, so product/subject crops are not normally
scheduled, and the existing OCR rendezvous does not wait for those two patches.
The fixture starts from a completed detail-evidence snapshot. Detail scheduling
and its rendezvous must first be enabled only in benchmark/Shadow and measured;
this branch does not silently turn either on for production.

The independent Catalog screen is an upper-bound diagnostic, not executable
recognition evidence:

| Conditional screen | Combined | Development | Validation |
| --- | ---: | ---: | ---: |
| independent product-year row present | `106/148` | `83/118` | `23/30` |
| independent core candidate present | `19/148` | `12/118` | `7/30` |
| independent core identity unique | `12/148` | `8/118` | `4/30` |
| strict all-known exact unique | `2/148` | `2/118` | `0/30` |

Those queries contain sealed truth-side fields. They prove Catalog
addressability only; they do not prove that current-image sensors can construct
the query. Exact CardJoin is therefore a useful secondary lane, not the main
first-day route.

A second, stricter card-level audit compiled all `90,419` trusted rows and
matched candidates to the independent canonical identity IDs instead of merely
matching normalized fields. Writer rows whose fields were parser-derived were
retained as support but were not allowed to attest identity:

| Card-level upper bound | Combined | Development | Validation |
| --- | ---: | ---: | ---: |
| independently attested canonical identity present | `0/148` | `0/118` | `0/30` |
| all known fields compatible, identity unproven | `2/148` | `2/118` | `0/30` |
| core-compatible candidate present | `29/148` | `21/118` | `8/30` |
| core-compatible candidate unique | `14/148` | `9/118` | `5/30` |

The two tables' core-compatible counts are not directly comparable: their query
contracts and field normalization differ. “Stricter” here refers only to
canonical-identity source attestation, not to a narrower core-field predicate.
The second audit supersedes the first for the identity gate.

The immutable index compiled in about `3–4 s` once; its 152 truth-fed queries
ran below p50 `0.1 ms` and p95 `10 ms`. The speed is sufficient. Under the
current query and normalization contract, independent card-level identity
coverage is not; this audit does not prove that a relevant raw catalog row is
globally absent.

## Untouched Validation rejects the SIFT product-mark sensor

The optimistic retrospective result (`14/17`, zero wrong emissions) did not
survive one legal untouched Product-field Validation. The evaluator, six
official references, 500-pixel resize and thresholds were frozen before a
prediction child saw 21 image-only inputs. Validation Product truth was opened
only after predictions were hashed; tuning-image SHA overlap was zero.

| Measurement | Result |
| --- | ---: |
| supported product positives | `1/5` correct, `3` abstain, `1` wrong class |
| open-set products | `14/16` correctly rejected, `2` false positives |
| precision when emitted | `1/4 = 25%` |
| Product-field joint accuracy | `15/21 = 71.43%` |
| local sensor p50 / p95 | `84.280 / 119.088 ms` |
| Provider / network / production / holdout IO | `0 / 0 / 0 / 0` |

The SIFT mark sensor is therefore `NO_GO` despite excellent latency. Its budget
may remain as a placeholder for a replacement emblem sensor, but its values
cannot support Retrieval. The 21-card denominator contains only five supported
positives, so it also cannot estimate six-product recall or title accuracy. See
`docs/reports/no-full-provider-product-mark-untouched-validation21-v1-2026-07-30.json`.

## The 85% requirement as a hard coverage equation

For an operational goal of 85% correct results within the deadline:

```text
joint_success
  = addressable_coverage * precision * deadline_success

required_addressable_coverage
  = 0.85
    / P(correct | addressable)
    / P(deadline | addressable and correct)
  = 0.85 / (0.99 * 0.95)
  = 0.903775
```

These are conditional rates, not three unrelated marginals. The executable
gate also checks the directly observed per-identity joint-success rate; passing
the component rates alone can never produce `GO`.

On 148 identity groups this requires at least `134/148` addressable groups,
with split gates of `107/118` Development and `28/30` Validation. The current
executable cold numerator is `0`; even granting the illegal truth-fed
core-compatible union of 29 groups would leave 105 groups missing. This operational equation supplements
rather than replaces the two accuracy scoreboards: familiar and unseen
`policy_fair_token_recall` must each still meet their own gate.

## What changed in this branch

1. `cardjoin-addressability-v1` formalizes the 90.3775% coverage requirement,
   rejects holdout and same-source self-proof, and separates source-pack
   reachability from executable sensor readiness.
2. `cardjoin-catalog-screening-v1` replays the 148 independent identity groups
   against the frozen official/writer-reviewed Catalog while excluding each
   card's sealed source rows.
3. `compiled-recognition-route-v1` is an offline/Shadow-only transport contract.
   It accepts versioned Release Pack `VALUE / EMPTY / UNKNOWN` rows, immutable
   current-image evidence and optional local prototype scores. It emits only
   Retrieval/Candidate packets: no SEM, no title, no Provider call and no
   production effect.
4. Exact Anchor no longer owns a title. Its only legal output is a Candidate
   packet which must pass Candidate Selection/Application, Identity Resolver
   and the deterministic 80-character Renderer.
5. `release-pack-memory-index-v1` compiles one immutable, provenance-bound
   product/set vocabulary and exposes deterministic local lookup only. It has
   no Provider, network, SEM, Resolver, Renderer, Queue or production import.
6. Direct evidence in the compiled route now requires the canonical
   preingestion producer contract and `DIRECT_IMAGE_EVIDENCE` permission.
   A local product prototype remains `QUERY_EXPANSION_ONLY` even if relabeled.
7. CardJoin deduplicates canonical identities, checks frozen source manifests,
   hashes and source lineage, and uses exact known-field compatibility—not
   subject agreement—as its only GO numerator.
8. The real preingestion OCR producer and Exact Anchor consumer now share the
   same normalized crop roles (`collector_number`, `product_text`,
   `player_name`). Product/subject are Retrieval-only context and cannot enter
   Resolver as pre-resolved fields; the official candidate must cross the
   existing Candidate Application boundary. OCR trust tier `3` is preserved
   across flatten/rebuild instead of being upgraded to tier `1`.
9. `card-level-release-pack-audit-v3` binds the catalog pack contents and the
   exact 152-row truth-bearing dev/validation subset independently. The
   versioned binding pins the frozen manifest content, its original source
   fingerprint, truth item IDs/count and canonical truth content; it rejects
   holdout input, truth mutation and correlated self-proof before compilation
   or query, while separating canonical identity Recall from truth-field
   compatibility.
10. `shadow-ocr-detail-completion-snapshot-v1` requires one immutable image and
    crop generation across schedule, OCR job and Worker-emitted patch. Missing,
    stale or retroactively unversioned evidence cannot become `COMPLETE`.
11. `shadow-one-shot-ocr-card-packet-v1` selects one front Subject view and one
    back Year/Product plus Card-code view, signs each unique source once and
    requires one proven batch request. Missing batch telemetry, a mixed Worker
    revision, role leakage or a second attempt fails closed without production
    effect.
12. The Lean Vision Worker now has one truthful authentication owner: ADC uses
    one reusable SDK client; explicit API-key mode uses REST. `/readyz` can no
    longer report ADC ready while execution requires an absent API key. Its
    scope is explicitly credential-source-only; Vision/IAM functionality still
    requires an authorized canary.
13. The one-shot transport preserves payload-level request, unit, unique
    download/decode, authentication, external-attempt, confirmed-unit and
    unknown-billing telemetry in the Node client. One batch can no longer be
    inferred from three item responses.

## Local Release Pack result

The first local-index gate is now proven on the existing Panini mapped pack:

| Measurement | Result |
| --- | ---: |
| source rows | `55,968` |
| JSON parse | `42.91 ms` |
| one-time index build | `327.97 ms` |
| year + sport + product query p50 / p95 | `0.303 / 0.355 ms` |
| year + sport + product + set query p50 / p95 | `0.303 / 0.355 ms` |
| product-query candidates p50 / p95 | `244 / 641` |
| set-narrowed candidates p50 / p95 | `1 / 2` |
| incremental index heap / RSS | `38.2 / 125.4 MB` |

This removes the current online Catalog p95 tail from the mathematical fast
route without pretending the route is production-ready. The pack's `cards`
arrays are empty (`0/55,968` rows carry card codes), so card-code lookup is only
contract-tested on fixtures. The benchmark proves local product/set constraint
latency; it proves neither exact-card coverage nor the 85% accuracy target.

## Next falsifiable gate

The next gate is not another full-Provider run. The immutable card index remains
an exact-code secondary lane, and the SIFT product-mark arm is now rejected.
The next route is:

1. run `shadow-one-shot-ocr-card-packet-v1` on Development, then one untouched
   Validation cohort, retaining real joint card-level timing and exact
   single-crop non-inferiority;
2. require the evidence-grounded feasibility gate p50 at most `1.35 s`, p95 at
   most `3.15 s`, visible-field precision at least `99%`, card-code critical
   false positives `0`, role leaks `0`, technical errors below `1%`, one Cloud
   Run request and one Google annotate request per card. Track `1.0/1.85 s`
   separately as stretch, never as the baseline pass condition;
3. only after that baseline passes, compare a one-image Evidence Atlas arm;
   Atlas must be field-noninferior, have zero cross-slot errors and p95 no more
   than `0.8x` the three-image batch before its lower Vision-unit cost matters;
4. do not tune SIFT on the consumed Validation-21. Freeze a replacement
   open-set emblem classifier on Development and evaluate it on the unconsumed
   official G2 image pack after that pack is materialized;
5. only after OCR and emblem gates pass, join their evidence into the existing
   Candidate packet and report addressability, Retrieval Recall@1/5/20,
   Selection, Application, Resolver, Renderer, fabrication and joint
   correctness-within-deadline on both splits;
6. proceed to one cold paired 20 only after Development and Validation satisfy
   the frozen joint gate. Holdout remains sealed.

No Prompt, OCR model/feature, Queue, front end, production title or holdout is
changed. The Vision authentication/readiness contract and evaluation telemetry
are corrected offline; nothing is deployed or enabled by this branch.

## Artifacts and verification boundary

The hashes below make the retained claims auditable. Several truth/image inputs
remain content-addressed external research artifacts rather than repository
fixtures, so a clean checkout can verify the committed report but cannot rerun
the one-shot prediction without separately materializing those exact bytes.

- Independent labels:
  `/private/tmp/lynca-recoverable-mainline.PPqJ7t/.local/oracle/independent-identity/labeled-devval-current.json`
  (`sha256:a051e123b5c3987f64836f02c679efabb68e7554389e02d70c5719d501e7a269`)
- Trusted Catalog snapshot:
  `/private/tmp/lynca-recoverable-mainline.PPqJ7t/.local/oracle/source/trusted-catalog-snapshot.json`
  (`sha256:d29f9ef591677414275e90d8b71691b67a63f32f54cbcc956b29808caa331622`)
- Telemetry manifest:
  `/Users/paidaxin/lynca-telemetry/v4_recognition_sessions/manifest.json`
  (`sha256:37dd051722f9221ce02303c02e62b6231b9d34a2c37aab89e4d18a861111b58d`)
- Telemetry export verification:
  `/Users/paidaxin/lynca-telemetry/export-verification.json`
  (`sha256:92f35a04c02aba65994ad3f806d13fae17118638ad84b5c4131108fc6bf8f90c`)
- Catalog timing distribution:
  `codex/day-one-naming-road-20260729:docs/reports/recognition-timing-coverage-2026-07-29.json`
  (`sha256:18d58381323a8fda5c1ad5ea23161bd8c06a6b4ba34b5f222b5546c44d9a8f9a`)
- Focused OCR evidence:
  `docs/evaluation/ppocr-v6-shadow-diagnostic-300-20260722.md`
  (`sha256:a99c8c0aa3e37ddd7ed828273238f06c7d2c2de6a380b7d0462bb4275eeb43d8`)
- Release Pack source:
  `/Users/paidaxin/Documents/Lynca/lynca-catalog-vocab/data/catalog/official/panini-mapped-2023-2025.json`
  (`sha256:3c6ca3c62038ebbac90f1a622db4c79ec0456e810bf0bdc34eb553176c4dde09`)
- Release Pack benchmark:
  `docs/reports/release-pack-memory-index-benchmark-2026-07-30.json`
  (`sha256:0864febe24f2a00760272946871f2aacd70e6587ec260a54c789ead141a79a69`)
- Card-level Release Pack audit:
  `docs/reports/card-level-release-pack-audit-2026-07-30.json`
- Retrospective dev/validation product-mark sensor audit:
  `docs/reports/no-full-provider-product-mark-sensor-2026-07-30.json`
- Untouched Product-field Validation-21 result:
  `docs/reports/no-full-provider-product-mark-untouched-validation21-v1-2026-07-30.json`
  (`report_sha256:020eb00436611fd1354c8d3baf36f1cad577cedb16c41a96690bc61394836b28`)
