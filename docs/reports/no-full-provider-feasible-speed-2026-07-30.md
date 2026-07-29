# No-full-Provider route: closest feasible speed and proof gap

Date: 2026-07-30

Decision: `BUILD_COMPILED_RECOGNITION_SHADOW`

Production activation: `NO_GO`

Holdout consumed: `false`

## Decision first

The higher-confidence conclusion is the opposite of promising universal
two-to-three-second naming. With the current software, a first-time card cannot
honestly receive that SLO: online Catalog retrieval alone has p95 `6.628 s`,
and the current cold traces contain zero executable Provider-free completions.

The closest falsifiable architecture target, after replacing the online
Catalog call with a versioned in-memory Release Pack, is:

| Clock | p50 | p95 | Evidence class |
| --- | ---: | ---: | --- |
| First-time compiled route after admission intent | `1.89–2.64 s` | `4.27–5.62 s` | componentwise planning envelope; not joint E2E measurement |
| Current software with observed Catalog distribution substituted | `2.59–3.33 s` | `10.90–12.24 s` | componentwise planning envelope; not joint E2E measurement |
| Same immutable-image terminal replay | `0.19–0.53 s` | `0.40–1.05 s` | architecture target; separate repeat-card route |

The provisional design gate should therefore be frozen as **p50 at most 2.7
seconds and p95 at most 5.7 seconds after admission intent** for addressable
first-time cards. This is the closest current-component model, not a production
SLO or a card-level observation. A universal p95 of three seconds is not
supported: the modelled parallel maximum of the three required OCR crops is
already `3.123 s` before Candidate, Resolver, Renderer and commit.

For the writer's actual clock, which starts at file selection rather than at
admission intent, the remaining original upload must be included. The following
are illustrative physical-bound scenarios, not measured workload percentiles:

| Input floor at `20 Mbps` | Modelled writer-visible p50 | Modelled writer-visible p95 |
| --- | ---: | ---: |
| one `6 MB` side (`2.4 s` byte floor) | `2.70–3.14 s` | `4.27–5.62 s` |
| two `6 MB` sides (`4.8 s` aggregate byte floor) | `5.10–5.54 s` | `5.45–6.24 s` |

Thus the nearest defensible first implementation target is **front-only
addressable cards p50 at most `3.2 s`, p95 at most `5.7 s`; two-side cards p50
at most `5.6 s`, p95 at most `6.3 s`**, under that uplink and file-size
assumption. Smaller files or a faster uplink improve the upload term; software
cannot promise those numbers independently of bytes and bandwidth.

The OCR number is intentionally no longer mislabeled as measured card latency.
The retained experiment contains 100 marginal timings for each of three crop
types, but no retained per-card paired timing packet. A lognormal marginal fit
plus independent parallel-max assumption gives OCR p50/p95 `1.343/3.123 s`.
The assumption is explicit and replaceable; only a new offline reconstruction
or one batch-timing trace may promote it to an observation.

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
  = max(T_original_upload_remaining,
        T_small_evidence_upload + T_focused_OCR)
    + T_compiled_lookup
    + T_candidate_control
    + T_resolver_renderer
    + T_commit_status
```

This equation does not erase the network lower bound. At 20 Mbps, one 6 MB
original needs at least `2.4 s` and two 6 MB originals need at least `4.8 s`
for bytes alone. Therefore two-to-three seconds from initial file selection is
physically impossible for the latter input. Progressive preparation can hide
OCR under that transfer, but cannot transmit bytes faster than the uplink.

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
executable cold numerator is `0`; even granting the illegal truth-fed union of
19 groups would leave 115 groups missing. This operational equation supplements
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

The next gate is not another fixed-20 Provider run. The immutable index and
sub-`10 ms` lookup gates are complete; what remains is a development and
validation replay of the compiled route:

1. add reviewed writer vocabulary and a real checklist/card-code source to the
   immutable index without changing its owner boundary;
2. in benchmark/Shadow only, schedule product/subject detail crops and wait for
   the version-matched patch snapshot before probing; keep production defaults
   unchanged;
3. retain a per-card batch OCR timing packet so the current crop-max model can
   be replaced with observed card-level p50/p95;
4. join direct OCR fields and prototype query support to that index;
5. report addressability, Retrieval Recall@1/5/20, Selection, Application,
   Resolver, Renderer, fabrication and latency on both splits;
6. proceed to one cold paired 20 only after Development and Validation pass
   their frozen gates.

No Prompt, OCR provider, Queue, front end, production title or holdout is
changed by this report or the compiled-route contract.

## Reproducibility

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
