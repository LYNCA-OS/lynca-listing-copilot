# Structural wiring audit: reachable owners, closed gates, and measurement traps

This is an offline audit of `origin/main@dbc989e1`. It changes no recognition
behaviour. The runtime evidence is the three familiar reports
`vocab17-candidate-r1/r2/r3.json` (60 observations, 20 identities replayed three
times) and `/tmp/unseen-baseline.json` (17 unseen cards). Static findings are
labelled as such; missing runtime trace is `UNCHECKED`, never inferred as a
zero.

## The contrary finding

The useful question is not “which branch fired zero times?” A cold benchmark is
supposed to bypass cache, a single-owner pipeline is supposed to suppress a
second candidate applier, and a shadow reranker is supposed to affect zero
titles. Treating all three as dead code would remove deliberate safety
boundaries.

The scan therefore used two directions:

1. reverse each final SEM field through Renderer, Resolver, application,
   Selection, Retrieval and evidence producers;
2. follow every apparently unused producer forward until its consumer, then
   distinguish a broken contract from an intentional shadow or an unmeasured
   route.

The result is five high-confidence open structural defects, not a list of every
zero counter in the reports.

## Runtime baseline

| observation | familiar | unseen | interpretation |
| --- | ---: | ---: | --- |
| cold profile and provider called once | 60/60 | 17/17 | expected benchmark behaviour; not proof that cache is dead |
| cache hit / provider skipped | 0/60 | 0/17 | exact-repeat behaviour remains `UNCHECKED` |
| pre-L2 anchor lookup attempted | 0/60 | 0/17 | no card in either cohort exercised the index-first route |
| anchor context dimensions / direct dimensions | 0 on 60/60 | 0 on 17/17 | the pre-L2 router did not receive its required direct context |
| Catalog queried | 60/60 | 17/17 | raw candidates on 50/60 and 10/17 |
| Vector queried | 60/60 | 17/17 | raw candidates on 48/60 and 16/17 |
| selected Catalog candidate | 44/60 | not persisted in the same form | 35/60 familiar selections are same-source reviewed-memory wiring tests, not independent accuracy truth |
| terminal Evidence Completion | 44/60 | 0/17 | familiar p50 33.386 s, p95 42.464 s among those 44 |
| provider fast path | 0/60 | 0/17 | locked by the effective assisted profile, not proven broken |
| `serial_numerator_verified` | null 59, true 1, false 0 | null 17 | unknown is the dominant real state |
| product schema / registry counts in evaluation packet | 0/60 fields persisted | 0/17 fields persisted | runtime values are `UNCHECKED`; the packet has no such fields |

## A. Absence converted into negative evidence

### A1. Serial three-state is fixed at its owner but broken again downstream

The identity gate preserves `true / false / null` at
`lib/identity-resolution/listing-resolution-gate.mjs:1617-1668`, and the
renderer treats only explicit `false` as a contradiction at
`lib/listing/renderer/listing-renderer.mjs:306-352`. In the familiar cohort the
upstream state was null on 59/60, true on 1/60 and false on 0/60; 26/60 carried
a complete numerator and denominator while that flag was null.

Two later adapters reintroduce the old error:

- `lib/listing/v4/result-adapter.mjs:76-82` ends the chain with `?? false`;
- `lib/listing/candidates/candidate-decision-stage.mjs:232-240` does the same
  while rendering candidate counterfactuals.

Both are high-confidence code defects: 2/2 presentation adapters collapse an
unknown input to an explicit refusal. The exact number of recorded titles that
passed through each adapter is not persisted and remains `UNCHECKED`.

Smallest future change: preserve `null` in both calls and add separate tests for
null versus explicit false. Blast radius: numerical-rarity and one-of-one
presentation, plus candidate `title_changed` diagnostics. The change must not
relax a genuine false contradiction.

### A2. The original print-run absence bug is closed

The renderer no longer treats a missing `field_evidence` row as a contradiction
(`lib/listing/renderer/listing-renderer.mjs:326-352`). The current reports show
false on 0/60 serial flags, so there is no evidence of that exact owner-level
bug remaining. It is recorded here because the two adapters above make the
end-to-end contract open again.

### A3. Other boolean defaults are latent, not proven regressions

Boolean defaults still exist in
`lib/listing/pipeline/field-normalization.mjs:119-122`,
`lib/identity-resolution/normalizer.mjs:166-169` and
`lib/listing/evidence/evidence-schema.mjs:363-366`. The evaluation reports do
not preserve whether a ground-truth false was explicit or defaulted, and strict
token contradictions were 0/60. They are therefore `LATENT / UNCHECKED`, not a
current bug count.

## B. High-confidence broken wiring

### B1. Product schema and registry never reach the production identity gate

The identity gate defaults both inputs to empty arrays at
`lib/identity-resolution/listing-resolution-gate.mjs:3367-3386`. All 6/6
production-relevant calls in
`lib/listing/v4/pipeline/native-recognition-core.mjs:1772-1775,1894-1897,2703-2706,2756-2759,4363-4375,5394-5397`
omit both inputs. The convergence retriever explicitly returns empty arrays in
2/2 branches at
`lib/listing/orchestration/identity-convergence-retriever.mjs:43-50,68-73`.

That starves the consumers for checklist codes, card types and parallel/serial
taxonomy in `lib/identity-resolution/constraint-engine.mjs:225-325` and
`lib/identity-resolution/parallel-taxonomy.mjs:345-555`. Runtime schema counts
were not persisted in 60/60 familiar or 17/17 unseen rows, so runtime activation
is `UNCHECKED`; static reachability is nevertheless 0/6 call sites.

### B2. The generated schema does not satisfy the consumer contract

Blindly passing `data/catalog/product-schemas.json` would not fix B1. Its
builder claims to feed the three constraints at
`scripts/build-product-schemas.mjs:6-9`, but emits only
`season_year/product/sport/sets/card_numbers` at `:93-101`.

The recorded artifact contains 185/185 schemas with `sets`, 185/185 with
`card_numbers`, and 0/185 with any checklist-code, card-type or parallel record
key consumed by `constraint-engine.mjs:33-58` or
`parallel-taxonomy.mjs:157-172`. Its inverse `set_to_products` index is top-level
at `scripts/build-product-schemas.mjs:140-149`; the gate accepts no such input.

This is a data-contract bug, separate from wiring. The smallest safe future
change is a versioned adapter that exposes set ownership as its own relation and
derives only semantics the source actually supports. Mapping `sets` to
`card_types` would fabricate constraints. Blast radius is high: candidate
generation, filtering, ranking, parallel and serial validation. It must start
read-only and shadowed.

### B3. The pre-L2 anchor route has no reachable input in either cohort

The router requires a direct TCG code or, for sports, a direct checklist code
plus two of year/product/subject at
`lib/listing/v4/anchors/anchor-router.mjs:22-58`. Resolved hints are marked
non-direct by `lib/listing/v4/anchors/anchor-extractor.mjs:110-202`; only pre-ingestion patches may
supply direct evidence. The probe exits before lookup when no route exists at
`lib/listing/v4/anchors/pre-l2-anchor-probe.mjs:17-60`.

Observed: lookup 0/60 and 0/17, context dimensions 0/60 and 0/17, and direct
dimensions 0/60 and 0/17. The familiar crop ledger reports a successful
`card_code_crop` on 21/60 observations, yet card-code patches reaching the
anchor packet are 0/60; on unseen cards the Provider's card/checklist/collector
number matched reviewed truth on 0/17. This is not evidence that exact lookup is
inaccurate; it proves only that the current producer-to-router contract never
exercised it in these cohorts.

Smallest future activation: inject versioned, current-image pre-ingestion code
patches before the probe and keep the entire result shadowed. Blast radius is
high because a successful route can eventually skip the full provider.

### B4. Subject facts are lost at an adapter boundary

Catalog projection emits `subjects` at
`lib/listing/retrieval/vector-candidate-packet.mjs:215-246`, while candidate
normalization reads only `players` or `player` at
`lib/listing/evidence/evidence-schema.mjs:540-545`. Selected Catalog candidates
had subject agreement on 44/60 familiar observations; subject application was
0/60.

Smallest future change: one `subjects -> players` bridge before existing
permission and Resolver gates. Blast radius is limited to candidate subject
support/application, but correctness still needs independent labels because
35/60 familiar selections are same-source reviewed rows.

### B5. Provider cert evidence is dropped by normalization

Provider company, grade and cert each existed on 15/60 familiar observations;
cert survived normalization on 0/60. `field-normalization.mjs:308-372` has no
cert output. This is a product-contract omission, not permission to copy a
catalog row's instance-specific cert. Any future cert field must be
current-image-only with provenance; its title value and GT eligibility remain
outside this audit.

## C. Intentional shadow, removable wiring, and configuration traps

| finding | measured reach | classification | what would make it fire |
| --- | ---: | --- | --- |
| convergence callback is constructed but candidate application already owns the decision | 44/60 familiar rows combine Evidence Completion with the single-owner application path; callback invocation is not persisted | removable dead wiring if single-owner remains the architecture | either delete the unused callback construction at `native-recognition-core.mjs:4363-4375`, or define a separate post-application authority; never enable two appliers |
| provider fast path | 0/60 and 0/17 | closed by effective policy, not proven broken | `single_model_fast`, Evidence Completion off or both assists off, then Provider HIGH/no uncertainty and gate CONFIRMED; see `native-recognition-core.mjs:2670-2707` |
| cold cache path | bypassed 60/60 and 17/17 | intentional benchmark isolation | a separate exact-replay profile; these reports cannot estimate hit rate |
| exact-anchor final | lookup 0/60 and 0/17 | intentional shadow plus missing inputs | repair B3, then unique authoritative candidate and zero direct conflicts |
| card-domain reranker | shadow on 60/60, would change 12/60, affected production titles 0/60 | intentional shadow | independent truth must show selection improvement and zero critical regression |
| learned reranker | queued 48/60, failed 12/60, affected production titles 0/60 | intentional shadow with incomplete execution | fix the 12/60 execution failures before judging ranking |
| entity existence/alignment | imported online 0 times; evaluated on 17 unseen and 60 familiar observations | intentional offline-only Q4 module | separate holdout and a shadow trace; never a direct title gate from calibration numbers |
| writer-assisted Evidence Completion option | terminal path 44/60; p50 33.386 s, p95 42.464 s | intentional profile policy, but an environment configuration shadow | the server profile hard-codes true at `recognition-profile-adapter.mjs:10-29,47-50`; experiments need a separate explicit profile, not a hidden env override |

## D. Evaluation can currently lie about the route it ran

These are evaluation-contract defects, not recognition-accuracy results:

1. All 4/4 inspected reports (three familiar, one unseen) label the top-level
   benchmark profile as production while every row records cold execution.
   `scripts/v4-ebay-smoke.mjs:848-856` computes the cold payload, but
   `:5043-5046` reports the default. Compute one effective profile and reuse it.
2. Catalog/vector assists are hard-coded in the payload at
   `scripts/v4-ebay-smoke.mjs:818-823`; both were queried on 60/60 and 17/17.
   Environment-only ablations therefore do not measure those components.
3. `route-planner.mjs:104-108` reads top-level assist flags, while the harness
   sends nested `provider_options`. Execution resolves the nested object. No
   nested-disable arm exists, so observed divergence is `UNCHECKED`; both
   owners must call one canonical resolver.
4. With L1 disabled, the queue harness forces L2-direct at
   `v4-ebay-smoke.mjs:2190-2202,2933-2937`, but the report records only the CLI
   flag at `:5051`. Effective queued flags must be persisted.
5. The evaluation packet truncates candidates/actions and compares exact field
   names at `evaluation-decision-trace-packet.mjs:59-111,235-257,291-294`.
   That makes 34/43 surviving number aliases look dropped and makes renderer
   key propagation look like semantic expression.

Until those five boundaries are repaired, a new ablation can be syntactically
successful and still test the same effective pipeline.

## E. Cache revision is structurally complete but fail-open at attachment

The fingerprint includes Provider/OCR, evidence and field normalization,
Resolver, route planner, exact-anchor policy, crop policy, vector model, worker,
SEM, candidate policies, Catalog revision, Renderer and title profile at
`lib/listing/cache/identity-cache-version-contract.mjs:131-189`. That is the
right owner-based contract.

However, `native-recognition-core.mjs:6632-6640` suppresses failure to attach the
active Catalog revision, after which the fingerprint falls back to the
deployment revision at `identity-cache-version-contract.mjs:87-97`. Cache reads
were bypassed on 60/60 and 17/17, so this failure mode is `UNCHECKED` here. A
future exact-replay path should fail cache-closed when an active Catalog
revision is required but unavailable; it should not silently replay a result
under a deployment surrogate.

## What the pipeline must stop doing

In safe order, the system must stop:

1. converting `UNKNOWN` to negative evidence after the field owner;
2. claiming an experiment profile different from the effective request;
3. presenting a generated file as schema input before its producer and
   consumers share a versioned contract;
4. constructing a second candidate callback that the single owner always
   suppresses;
5. calling a pre-L2 path “available” before its direct-evidence producer can
   satisfy the router;
6. using exact-name trace comparison for alias-rich SEM fields.

The first two are correctness prerequisites. The next three are reachability
prerequisites. Raising Catalog authority before them would amplify invisible
adapter and contract errors rather than make the index authoritative.
