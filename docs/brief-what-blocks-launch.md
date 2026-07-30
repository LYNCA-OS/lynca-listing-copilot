# What blocks launch

For Codex. Route decision is made: **all-cloud**. Local/Mac is not the target.

Nine blockers. Each states what closes it, who can close it, and what evidence
counts. Ordered by whether launching without it would ship something wrong, then
by cost.

Governance unchanged (`docs/brief-the-road-to-day-one-naming.md` §0): the result
is required, the route is negotiable, a dead path is reported with its evidence
and followed by the next route — and a number that cannot be obtained honestly
is reported as missing, never manufactured.

## Integrated closure status — 2026-07-30

This section is the current execution truth. The detailed B1–B9 sections below
remain the original problem statement and evidence, not a claim that every
external gate has run.

| Blocker | Source closure in this branch | Remaining proof |
|---|---|---|
| B1 | Exact-SHA, one-attempt N30 authorization workflow and fail-closed analyzer are complete. | `NOT_RUN`; N30 is now a conditional same-card diagnostic, not a launch dimension or the next run. |
| B2 | No bypass was added. OCR unavailability remains explicit and fails closed. | Restore or migrate GCP billing before any Google Vision or production deploy attempt. |
| B3 | Live same-process RegionEvidence, process-private replay authority, Decision Trace, and Writer Journey launch evidence are connected and fail closed. | Persisted authenticated Candidate replay has no independent envelope owner; one-shot OCR Development/Validation, replacement product-mark G2, the legal joint gate, final cold 20, sealed holdout, latency/throughput/reliability gates, and exact-release production Journey remain unrun. |
| B4 | Unseen-10 SEM attribution is complete: 30 missing fields = card number 10, product 9, year 5, set 4, subject 1, manufacturer 1. | The deployed unseen baseline remains `0.4829366`; attribution explains the gap but does not close it. |
| B5 | Useful #151/#152 changes are integrated behind their existing safe defaults; the stale PRs are superseded by this branch. | Exact merged-SHA offline and legal cloud gates, not the old PRs, decide promotion. |
| B6 | `3,022 / 3,090` rows are accounted for with a reversible disposition; automatic truth/catalog writes remain zero. | 68 remain unaccounted and fail closed; reviewed-internal confirmation is still required for the 762 absent-product observations. |
| B7 | Derived evidence is wired through a frozen pre-application snapshot with tenant/asset/generation/image/crop provenance and process-private capability. | Persisted JSON remains UNKNOWN/Shadow until an independent authenticated replay-envelope owner exists; production title authority is unchanged. |
| B8 | Second-look planning/execution is connected in shadow with a typed, scrubbed trace. | No paid second-look evaluation has run. |
| B9 | Durable batch intent, 100-position recovery, canonical Queue reconciliation, two clocks, rate gates, and fail-closed schema checkers are implemented. PostgreSQL 17.10 passes the Writer Intake contract plus 14 tamper cases and the admin-test replay-isolation contract plus 7 tamper cases. | Both ordered production migrations, PostgREST reload, and the exact-release real Writer Journey remain release gates. |

The integrated source is therefore **candidate code, not an exact release
candidate or production proof** until it is committed, reviewed, and merged.
`launch_ready` stays false unless the exact external SHA/deployment,
schema, accuracy, reliability, throughput, and Writer Journey artifacts all
pass their independent owners.

The current live release fails that identity gate before accuracy is even
considered: GitHub `main` is
`b27d6775a5335ad004b099d3969e01e5ada87e09`, while production reports
`9be84ea45a79eb9377ca63d0a3d6dc64896a465d` on
`dpl_8TnKviaxQdWEf6yhi6kY2vxbf8gC`. The exact-byte release-packet validator is
implemented, but the named aggregate and accuracy producer workflows do not
yet exist, so real attested launch evidence is also `INCONCLUSIVE`.

The local formal-accuracy contract is now adversarially fail-closed: `2/3` is
not `#/3`; critical UNKNOWN/NOT_APPLICABLE overclaims and confirmed critical
conflicts/missing values are zero-tolerance safety failures; every row must
explicitly classify all 15 launch fields and carry a unique independent
identity group; prediction IDs must be an exact bijection with the frozen
dataset; and final titles must survive deterministic Renderer replay and
reviewed-field critical checks. Only a full-content-digested `release-set-v1`
`CORE_HOLDOUT` with bound prediction, deployment, active pipeline, and active
Catalog provenance can be launch-eligible. The old partition schema, passing
fixtures, and arbitrary self-hashed JSON do not supply production authority.

The production Writer Journey admin `EDIT` is now isolated from writer-final
replay in source. Only explicit inner `OBSERVE_ONLY` feedback may write that
authority; `ADMIN_TEST_ONLY`, missing, and unknown dispositions fail closed.
Migration `20260730120000` also performs a targeted historical tombstone and
adds a service-only proof RPC. It must follow Writer Intake migration
`20260730065921`; both remain unapplied production gates.

---

## B1. The same card gets two names — CORRECTNESS BLOCKER

**Do not launch past this one.** Everything else is speed or coverage; this is
the product being wrong in front of a buyer.

```
same asset, re-recognised within one hour, identical deployed code
  identity agreed   50.3%   (3,345 pairs)
  title agreed      12.4%
prompts of byte-identical size
  identity agreed   53.5%
```

`temperature: 0` is already set. Deploy drift is excluded by the window. Prompt
drift is real but secondary. In our own data this shows up as `luka dončić` and
`luka donči`, `dan marino` and `dan marino teal dolphins` — one card, two names,
an hour apart.

**Current closure:** the N30 contract is implemented but deliberately
`NOT_RUN`: same card, 30 serial runs, cache bypass, no replay, no whole-job or
provider retry, one provider HTTP per run, byte-exact title, exact-SHA and
one-attempt authorization. The active launch packet has no N30 dimension.

Exact writer-final and terminal replay are now the deterministic repeat-card
defence. Run N30 once only if same-card model instability remains an unresolved
diagnostic after the fast route and release gates pass; it is not the first
step and it cannot repair a mismatched deployment or an unproven new-card path.

---

## B2. GCP billing account is closed — USER ACTION

```
billing account 01836C-EC055E-6FDAF1   open: False
```

Consequences, all verified: Cloud Run rejects every write (`BILLING_DISABLED`),
OCR workers return `ocr_worker_unavailable`, the vector index is frozen at 587
rows last written 2026-07-06, and `/readyz` on the Vision worker returns 500
without reaching the container.

Nothing is accruing cost. Several things are quietly not running, and on an
all-cloud route the OCR lane is one of them.

**Closes with:** restoring or migrating billing. **Owner: Fei.** Not
recoverable by either of us.

**Do not** re-test Google Vision until this is closed — that was already agreed
and it still holds.

---

## B3. Legal Joint Gate has never run

Your own status: `PRODUCTION = NO_GO`, `LEGAL JOINT GATE = NOT_RUN`, and the
candidate architecture is "committed, pushed, not deployed — not production
evidence".

**Current closure sequence:** live same-process RegionEvidence and its
pre-application process-private replay capability are source-complete. Persisted
JSON cannot authorize a Candidate; it remains UNKNOWN/Shadow until an
independent authenticated envelope owner verifies detached evidence and mints
authority. Next run one-shot OCR on Development and exactly one untouched
Validation; replace the rejected SIFT Product-mark sensor and
test it on independent G2; then join both through Retrieval → Selection → Safe
Application → Resolver → Renderer. The joint gate requires addressability
`>=134/148`, split `>=107/118` Development and `>=28/30` Validation, under the
stated precision and deadline conditions. Only after that passes does one
cache-bypassed cold 20 run.

**Two caveats that are now live:**

- The one-shot OCR gate hard-requires `google annotate = 1`. On an all-cloud route that is
  fine, but do not fabricate a Google call to satisfy it if the call did not
  happen.
- SIFT-consumed Validation-21 cannot be reused. Any new product model needs
  unconsumed G2 or a fresh independent Validation.

---

## B4. Unseen baseline is 0.4829 against a target of 0.85

The deployed-cohort baseline was `0.4829366`. The Task A candidate scored
`0.4055555` and was rejected; it is not the current baseline. The gap remains
large, but the failed candidate must not be used to understate the deployed
route.

**Attribution is now complete:** 30 confirmed fields were absent from both
Provider evidence and standard Retrieval: Card Number `10`, Product `9`, Year
`5`, Set/Insert `4`, Subject `1`, Manufacturer `1`. This closes the diagnostic,
not the accuracy gap: the deployed unseen baseline remains `0.4829366`.

**What the attribution decides:**

- loss mostly in fields the card *does* state → a reading problem, and 85% is
  reachable
- loss mostly in product line and parallel proper nouns → 85% requires either
  emblem recognition or accepting descriptive forms in the score, and **that is
  a product decision, not an engineering one**. Surface it rather than optimising
  around it.

Relevant measured constraint: on the deciding Panini Phoenix example, the
product line appears as an emblem rather than readable text. That example proves
OCR alone is insufficient for that product mark; it does not establish that all
product lines on all cards are never text. On genuinely unseen products the
world engine cannot independently prove the missing identity either.

---

## B5. Historical PRs are superseded by the integrated branch

| PR | contents | needs |
|---|---|---|
| [#151](https://github.com/LYNCA-OS/lynca-listing-copilot/pull/151) | vector retrieval disabled by default; OCR rendezvous wait capped at 2s, then zeroed when workers are provably unavailable | paired interleaved A/B, both scoreboards |
| [#152](https://github.com/LYNCA-OS/lynca-listing-copilot/pull/152) | world engine forwards, subject normalizer, derive-fields, second-look planner, parallel ladder, three corrected claims | offline replay first, then paired |

These rows describe the original inputs. Their useful changes are now
integrated under safe defaults in this branch; neither stale PR should be
merged independently. Promotion is decided by the exact integrated SHA and its
current gates, not by either historical PR status.

**What #151 predicts:** 3.5s recovered from vector (3,556ms average, 92.7% zero
candidates against a 587-row index), plus a tail of up to 22s from the OCR cap,
**with no accuracy change on either scoreboard**.

If accuracy moves at all, my reasoning is wrong and I want to know: I argued the
266 calls that did return candidates are not rescuing hard cards, because they
read a card number 58.3% of the time against 33.7% and retrieval keys on the
card number — entry condition, not payoff. On team and parallel the two groups
are indistinguishable (26.7 vs 26.5, 9.4 vs 9.3).

---

## B6. The gap queue: 3,090 open, and the classification was wrong

Reclassified today from the activation funnel rather than the stored label,
because the label disagreed with the data. Originals preserved in
`candidate_snapshot.reclassification`, reversible.

```
2,093  CATALOG_COVERAGE_GAP        (was 721 — 1,372 were mislabelled)
  929  CANDIDATE_CONFLICT_BLOCKED  (real conflict_blocked_count > 0)
   ~68 trust / post-observation blocked
```

The three original predicates overlap; they are not three buckets:

```
  985  product-year ALREADY IN CATALOG
  242  set field holds a known product
  808  observed product is absent at every year
```

Their six-cell partition is `816 / 169 / 27 / 46 / 762 / 273`. Applying the
deterministic priority product-year > set-as-product > product-absent yields the
mutually exclusive operational split `985 / 73 / 762 / 273`. The old apparent
remainder of 58 was an arithmetic artifact caused by double-counting 215 rows.

**Four actions, in this order:**

1. Mark the 985 `NO_BACKFILL_PRODUCT_YEAR_PRESENT` and use them only as a
   retrieval diagnostic. A product-year row does not prove an exact-card row,
   so they do not auto-close.
2. Send the 762 `PRODUCT_NAME_ABSENT_FROM_CATALOG` rows to reviewed-internal
   confirmation. They are single-system observations, not independent truth;
   automatic backfill count is zero.
3. Treat only 73 rows as set-as-product candidates. Of those, 43 share the
   expected year and only 12 also have explicit manufacturer compatibility;
   even those remain Resolver support, never direct title application.
4. The 929 historical conflicts stay open because their stored snapshots lack
   field-level conflict detail. New traces now include bounded field and reason
   detail; a version-matched replay is required before the historical rows
   become actionable.

**Also relevant:** 95% of these ran at `participation_level: LEVEL_0_SHADOW`.
The candidate mechanism is wired and deliberately switched off, so it never had
authority to resolve any of them. Turning it on affects production titles and is
a decision for Fei, not a default.

---

## B7. Derived evidence is connected behind a fail-closed boundary

The eighth and ninth instances of the pattern `ambition.md` names.

| module | measured | state |
|---|---|---|
| `constraint-enumerator` | team 65% to VALUE/EMPTY, product 14%→30% | connected as typed candidate/support evidence; Resolver still owns fields |
| `composeParallel` | `parallel` filled 0.8% → `Silver /75` | connected through the same pre-application contract |
| `deriveCardType` | supplies `sport`, which the provider is asked for 4,695 times and has returned 0 times | connected, with cross-sport brands still abstaining |
| `card_identity_prototypes` | table + FK correct | **0 rows** |
| `catalog_parallels` | columns exactly right | **0 rows** |

`derive-fields.mjs` collapses the first three into one import and one call and
returns a `trace` plus `summariseDerivation`, so the wiring answers "was this a
positive asset" with a count. On seven production card shapes: 9 gaps filled, 1
correctly EMPTY, 2 honestly UNKNOWN.

Forward evidence is not allowed to self-certify: live current-image authority,
typed provenance, a pre-application candidate snapshot, and conflict-free
decision eligibility are required. Missing or invalid authority leaves the
candidate visible only in Shadow and changes no title.

That authority is deliberately process-private. A co-persisted manifest cannot
authorize its sibling payload, and persisted JSON replay therefore remains
UNKNOWN/Shadow. Cross-process promotion is a future source gate requiring an
independent authenticated replay-envelope owner; it is not complete here.

**One caution earned today:** the first version of `deriveCardType` inferred
sport from the brand and typed Tom Brady on a 2000 Bowman Chrome card as
baseball, because Bowman prints football too. A wrong sport is worse than none —
it made the namesake filter reject his real career. Brands that span sports are
now absent by design.

---

## B8. Card number missing on 54% of cards

The largest single field gap, and it drives the economics of the whole two-stage
route: 2,714 of the 3,125 cards with any always-present gap are missing only the
card number; everything else together is under 20%.

**The deciding fact: 92% of the cards missing one had a back image in hand.** The
picture was there and the number was not read. That is an observation failure,
which a targeted crop is the right instrument for — had it been a missing-asset
problem, the second-look route would be worthless.

`second-look-planner.mjs` is the decision layer; the targeted assist executor
(2 originals, 4 crops, bounded deadline) is the mechanism. They are now
connected only in evaluation-authorized Shadow, with one paid-call budget, no
internal retry, typed trace, and zero production-title effect. No paid
second-look evaluation has run.

---

## B9. Writer clock versus durable clock

Measured per row, 2,008 sessions:

```
handler total   21,908ms
  provider       8,573ms
  after provider 11,690ms
    vector         3,225ms   <- cut in #151
    OCR wait         136ms   <- cut in #151
    anchor           172ms
    the rest      ~8,000ms   persistence, queue completion, serialization
```

`recognition-critical-path-v1` excludes `V4_ADAPTER`, `SESSION_PERSISTENCE`,
`QUEUE_COMPLETION`, `HTTP_SERIALIZATION` — which is why your interval union
finds only 0.111s uncovered while a naive subtraction finds seconds. Both
numbers are right; they measure different things.

**A large accounted portion of the post-provider time belongs to downstream
decision and persistence work, but the breakdown does not prove that all of it
is irreducible.** Vector, OCR, Anchor, Resolver, persistence, Queue completion,
and serialization remain separate owners. The two-clock contract hides the
durable tail from the writer without relabelling it as free:
`WRITER_TITLE_READY` stays distinct from `ASSET_DURABLE`.

**And the all-cloud upload floor, which no code change reaches:**

```
T = 8 × MB / Mbps
two 6MB originals @ 20Mbps = 4.8s
two 200KB browser-resized  @ 20Mbps = 0.16s
```

Client-side resize is useful only for a separately labelled provisional
evidence lane. It must never be called the canonical original or become identity
truth. The safe split is provisional recognition evidence for the writer clock,
plus verified originals in the background for the durable clock; promotion and
training remain disabled until the originals are finalised and reconciled.

---

## Retracted today — do not reason from these

| claim | status |
|---|---|
| "10,841ms of latency is uninstrumented" | **mine, wrong, retracted.** Computed by subtracting non-nested spans; 29.5% of rows had a negative residual, so the quantity had no meaning |
| "~3s of fixed overhead" | **mine, wrong.** A regression intercept |
| "60.4% of set names uniquely identify a product-year" | measured on the harvest, never transferred; 14% on production, 30% with the product-name reading |
| "69.3% of model output is waste" | **falsified by your Task A** — the tokens were empty, the asking was not |
| "the 266 vector calls might be rescuing hard cards" | checked, they are not |
| "production storage signing may be broken" | **checked, it is not** — 266 verifications today, zero failures |

---

## Order of work

```
integrated P0/P1 review
  -> local PostgreSQL 17.10 migration/schema tests
  -> full offline CI and dependency/security checks
  -> protected integrated PR + exact-main merge
  -> apply production migration + reload PostgREST schema on exact main
  -> restore or migrate the all-cloud OCR capability
  -> exact-main shadow/infrastructure deploy + engineering Writer Journey
  -> one-shot OCR Development/Validation
  -> replacement Product-mark G2
  -> legal joint Retrieval/Application/Resolver/Renderer gate
  -> one cold 20
  -> freeze fail-closed first-time/replay latency gates from observed data
  -> freeze the activation tree and land it through protected main
  -> deploy the exact activation main SHA
  -> run one sealed >=45-card final holdout on that exact release
  -> deferred exact-release throughput/reliability gates after they reopen
  -> real Writer Journey on that exact release
  -> <=24-hour attested release packet
  -> N30 only if same-card instability is still an open diagnostic
```

B4 attribution is complete. B1 is a conditional diagnostic, not a launch
prerequisite in the executable packet. Any output-affecting activation changes
the SHA/fingerprint, so the engineering Journey before algorithm evaluation
cannot substitute for the final exact-activation Journey.

## What a launch decision needs, minimally

1. Exact `main` equals the deployed production SHA; production Writer Intake
   schema and PostgREST contract pass on that release.
2. Independent familiar and unseen scoreboards, latency, and abstention pass on
   the final activated route. The intermediate fast-route addressability gate
   reaches `134/148` with its frozen split; final launch accuracy separately
   requires a sealed holdout of at least 45 cards and SEM card-exact `>=0.87`.
3. One cache-bypassed cold 20 runs only after Development/Validation and the
   legal joint gate pass.
4. The real production Writer Journey passes login → real upload → enqueue →
   Queue → Worker → L2 → accept/edit → durable persistence on the exact
   activation SHA. It must perform a distinct `EDIT`, prove the Worker node
   reached `COMPLETED`, read the edited session back after the write, and prove
   administrator test output remains excluded from training and promotion.
5. Accuracy, throughput `100/500/1000`, reliability, and Writer Journey exact
   bytes are aggregated by independent workflows into one <=24-hour attested
   release packet. Missing producers or evidence remain `INCONCLUSIVE`.
6. Writer-visible latency has its own observed, frozen release threshold. The
   current throughput evaluator records p50/p95 but does not gate them, so the
   planning envelope alone is not launch proof.

The Writer Journey deliberately does not upload authenticated Playwright HAR or
trace archives: either can retain cookies, request bodies, or signed URLs.
Instead it uploads typed stage evidence, correlation IDs, and only a masked
post-login failure screenshot. This is an intentional security deviation from
the earlier PR3 task wording and reduces raw network-level debugging detail.
