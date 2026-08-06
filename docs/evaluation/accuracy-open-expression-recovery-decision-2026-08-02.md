# Accuracy recovery decision: open expression first, authority later — 2026-08-02

## Decision

The attractive opposing hypothesis is to remove all constraints until Luna's
recall rises, and only then restore legality. The evidence rejects that policy
if “remove constraints” includes title authority: on the fresh 150-card paired
run, free title expression lost to canonical on 95 cards, won on 44, and tied
on 11; macro F1 was `0.7147` versus `0.7678`. Broad product and serial
projections also created factual losses even though their aggregate F1 deltas
were positive.

The higher-confidence policy is therefore:

> Open the **observation and candidate-expression lane**, not the canonical
> authority lane. Preserve more exact evidence from the same Luna call, rank
> it with deterministic/catalog/world constraints, admit only field-specific
> high-precision candidates into CSM/SEM, and keep the deterministic
> 80-character Composer as the marketplace boundary.

This is “recall first, legality second” at the correct boundary. It prevents
the legality schema from silently erasing useful evidence, while preventing an
unverified color, product, team, or serial guess from becoming a listing fact.

No provider request, deployment, migration, Supabase write, Vercel write,
Cloud Run call, OCR call, vector lookup, or second model call was made for this
decision. All current measurements below are offline replays of retained
artifacts.

## Environment and evidence boundary

| Checkout | Guard | Branch / HEAD | Permitted use in this audit |
|---|---|---|---|
| `/Users/paidaxin/lynca-thin-path` | PASS | `feat/thin-path` / `0aef8e874122898924ca2387c1ad9830a0f5c244` | Read artifacts and run deterministic replays |
| `/Users/paidaxin/lynca-thin-production-main` | **FAIL**: linked `supabase/.temp` violates `legacy_supabase_workdir_must_remain_unlinked` | `codex/singapore-network-benchmark-freeze` / `dccebfefc19b1bea872251f0b2c4f774eadc8310` | Read-only comparison; not a releasable baseline |

The marketplace rules file is byte-identical between the two checkouts. The
active canonical Composer differs because it contains evaluation/ablation
hooks; this audit does not claim that those hooks are already promoted to
production. The failed production guard is an explicit release blocker, not
an accuracy result.

## Complete 100-card loss waterfall

The existing manual audit is complete; it must not be replaced by another
token counter.

| Earliest loss boundary | Occurrences | Cards | Share | Interpretation |
|---|---:|---:|---:|---|
| Exhaustive still did not express it | 170 | 77 | 57.4% | No parser or Composer can recover an absent span |
| Exhaustive expressed it; canonical schema did not retain it | 73 | 53 | 24.7% | Candidate-expression and admission opportunity |
| Canonical retained it; Composer did not emit it | 53 | 37 | 17.9% | Grammar, normalization, suppression, or 80-character budget |
| **Total** | **296** | — | **100%** | Card counts overlap |

Canonical macro F1 on these 100 cards was `0.769802`. An impossible oracle
that restores every one of the `73 + 53` expressed occurrences reaches only
`0.840195` (`+0.070393`), because 170 occurrences were absent even in the
exhaustive observation. This separates the real jobs:

1. improve perception/expression for the 170;
2. preserve and resolve useful evidence inside the 73;
3. compact and project existing fields inside the 53.

### What the 73 really contain

| Manual class | Occurrences | Cards / meaning | Action |
|---|---:|---|---|
| Correctly scoped, commercially incremental evidence | 37 | 29 cards | Primary same-call resolver target |
| Canonical synonym already represented | 8 | `Autograph`/`Auto`, `Rookie`/`RC` | Retain provenance; do not duplicate title terms |
| Plausible but ambiguous | 19 | year/color/pattern/category hypotheses | Candidate-only; rank with world/catalog constraints |
| Wrong-role token collision | 9 | biography, uniform, artwork, statistics, copyright text | Reject automatic admission |

The 37 direct occurrences are not one problem:

| Intended field family | Occurrences | Examples |
|---|---:|---|
| Year / season suffix | 3 | `2018-19`, `2020-21` |
| Product / Set / IP | 11 | `NBL`, `Ultra`, `Graphite`, `Star Wars`, `Disney`, `Optic` |
| Team extension | 6 | `FC`, `Los Angeles`, `KC` |
| Card name / release design | 7 | `5 Pick 2`, `Derby`, `Throwback`, `Kaboom Horizontal` |
| Exact serial | 4 | `027/150`, `5/5`, `04/25`, `038/220` |
| Component / card type | 6 | `1st`, `Jersey`, `Redemption Card` |

The direct-only oracle ceiling is macro F1 `0.791425`, or `+0.021623`. It is
not a forecast: real admission spends title budget and can introduce false
positives. The detailed 73-row asset ledger remains in
`extreme-observation-high-100-loss-audit-2026-08-01.md` and should be treated as
the human-audited source of truth.

### What the 53 really contain

| Root cause | Occurrences | Cards | Oracle F1 delta | Correct intervention |
|---|---:|---:|---:|---|
| Priority / 80-character budget drop | 25 | 16 | +0.012830 | Compact long values before changing global drop order |
| Marketplace suppression | 14 | 12 | +0.008907 | Only source-gated exceptions; keep measured-positive global policy |
| Lot grammar has no bracket | 4 | 2 | +0.002090 | CSM/SEM contract decision, not a parser patch |
| Silent normalization | 10 | 10 | +0.005984 | Typed, observable exceptions with reason codes |
| **Total** | **53** | **37** | **+0.029578** | Effects overlap by card |

The already implemented Composer recovery candidate recovered 12 of these 53
occurrences on the discovery 100: 10 wins, 0 losses, 90 ties, macro F1
`+0.006061`, no title over 80. Its useful mechanisms are product hierarchy
compaction, component de-duplication, and typed identity preservation. It did
not globally restore teams, card numbers, bare colors, or lot brackets.

## 150-card scale check, not a second manual audit

The automatic 150-card stage audit shows that the waterfall generalizes in
shape, but its tokens have not received the same per-occurrence human role
classification as the 100-card 73 ledger.

| Earliest loss boundary | Occurrences | Cards |
|---|---:|---:|
| Exhaustive not expressed | 255 | 118 |
| Canonical schema compression | 109 | 76 |
| Downstream composition | 63 | 46 |

Examples confirm the same families: the first bucket contains serial forms,
`refractor`, `ssp`, `rc`, `gold`, and incomplete product/set wording; the
schema bucket contains `rookie`, `autograph`, colors, years, identity terms,
and exact serials; the downstream bucket contains colors, teams, product
tokens, lot-related `promo`/`PSA 10`, and subject overflow.

This 150 artifact is valuable for coverage and regression checks. It must not
be described as 109 independently safe admissions or as a replacement for the
manual 73 audit.

### The old 73 are not a stable backlog

Re-locating the exact old 73 token-card pairs on the later fresh150 outputs for
the same 100 cards shows model-sampling and baseline drift:

| Later state of the old 73 | Occurrences |
|---|---:|
| Already present in the newer canonical title | 11 |
| Still schema compression | 57 |
| Exhaustive no longer expressed it | 4 |
| Moved to downstream composition | 1 |

The manually direct 37 split into 7 already present, 27 still schema
compression, 2 no longer expressed, and 1 downstream. The existing
`expression-overlay-v1-replay-150.json` added only six old-direct occurrences
on five cards: `Graphite`, the two tokens in `Star Wars`, `Kaboom`, `Disney`,
and `VeeFriends`. Seven other old-direct occurrences were already present in
the newer baseline; 24 remained missing. Its overall 11/0 replay result must
therefore not be reported as “11 of the old 73 recovered.”

This also fixes the unit of analysis: the 73 are per-card de-duplicated
reference token matches. They are not 73 fields or 73 visual ground truths;
`Star Wars` counts as two tokens, while a repeated occurrence on one card
counts once.

## Current zero-cost mechanism evidence

Two retained-150 replays answer different questions. Both are evaluation-only
and use already-paid rows.

### Narrow cumulative bundle

Reproduced result: baseline macro F1 `0.771494`, candidate `0.778394`, delta
`+0.006900`; 13 wins, 0 losses, 137 ties, 0 reference-loss cards, and 0 titles
over 80 characters.

| Cumulative stage | Wins | Losses | Ties | Cumulative delta |
|---|---:|---:|---:|---:|
| Exact visible identity | 4 | 0 | 146 | +0.002187 |
| + attested insert | 5 | 0 | 145 | +0.002536 |
| + family/color finish | 5 | 0 | 145 | +0.002536 |
| + literal SAR rarity | 6 | 0 | 144 | +0.002801 |
| + Trainer Gallery | 6 | 0 | 144 | +0.002801 |
| + printed First Bowman | 7 | 0 | 143 | +0.003196 |
| + strict manufacturer/product extension | 10 | 0 | 140 | +0.005070 |
| + single-digit exact serial | **13** | **0** | **137** | **+0.006900** |

The zero incremental score at two stages means those rules did not add a new
winning card after earlier stages on this cohort; it is not proof that they
have no semantic value.

### Current safe-bundle ablation

The current replay script additionally contains `tcg_ip_logo_exact`; this is a
lineage change from the older stored safe-bundle JSON. Re-running current code
gave macro F1 `0.766927 -> 0.773007` (`+0.006080`), 11 wins, 0 losses, 139 ties,
27 changed cards, 30 field actions, 0 reference-loss cards, and 0 titles over
80.

| Isolated mechanism | Wins | Losses | Ties | Delta | Changed / actions | Safety result |
|---|---:|---:|---:|---:|---:|---|
| Finish family + color only | 2 | 0 | 148 | +0.000936 | 2 / 4 | No reference loss |
| Single-digit exact serial | 2 | 0 | 148 | +0.001027 | 2 / 2 | No digit substitution |
| Literal `SAR` rarity | 1 | 0 | 149 | +0.000246 | 1 / 1 | Empty typed slot only |
| Printed `Trainer Gallery` | 1 | 0 | 149 | +0.000963 | 1 / 1 | Printed evidence only |
| Printed `1st Bowman` | 1 | 0 | 149 | +0.000386 | 1 / 1 | Printed evidence only |
| Known-manufacturer product extension | 2 | 0 | 148 | +0.001377 | 2 / 17 | Many neutral actions; keep narrow gates |
| Attested insert vocabulary | 1 | 0 | 149 | +0.000346 | 1 / 2 | Empty card-name slot only |
| Exact TCG IP logo | 2 | 0 | 148 | +0.001007 | 2 / 2 | Empty IP slot only |

Per-mechanism deltas are isolated and are not arithmetically additive because
the rules interact through the same 80-character title budget.

### Composer ablation on the same retained 150

| Composer mechanism | Wins | Losses | Ties | Delta | Interpretation |
|---|---:|---:|---:|---:|---|
| Component de-duplication | 1 | 0 | 149 | +0.000265 | Removes duplicate burden while retaining `Elite` |
| Product hierarchy compaction | 1 | 0 | 149 | +0.001070 | Retains `Game of Thrones` parent instead of dropping Product |
| Typed identity preservation | 3 | 0 | 147 | +0.001246 | Retains meaningful `Basketball`, `Baseball`, `Card` identity tokens |
| Slash spacing normalization | 0 | 0 | 150 | 0 | Contract-safe; no score claim in this cohort |

## Minimal mechanisms worth carrying forward

These mechanisms preserve the user's desired direction—more expression first—
without giving free expression canonical authority.

| Mechanism | Minimal rule | Existing evidence | First/next zero-cost gate | Status |
|---|---|---|---|---|
| 1. Exact identity/IP admission | Admit printed exact logo/label into an empty compatible Set/IP slot; never replace a conflicting canonical value | Identity 4/0; TCG IP 2/0 | Replay by category and source region; audit all changed rows | Keep as evaluation candidate |
| 2. Strict product extension | Extend only a compatible known-manufacturer product, block Lot and conflicting product identities | Current 2/0; mixed replay previously 6/0 | Enumerate all 17 actions, verify hierarchy and Lot blocker | Keep as evaluation candidate |
| 3. Serial candidate preservation | Preserve an exact candidate span and only propose a leading-zero normalization when numerator and denominator digits are otherwise compatible; model self-agreement is not truth | 2/0 on retained 150, but one separate critical visual false promotion exists | Adversarial replay with verified image/reference truth, different denominators, multi-digit numerators, and multiple serials | Candidate evidence only; automatic admission not yet safe |
| 4. Attested vocabulary admission | Versioned small vocabulary for printed insert, finish family/color, rarity, `1st Bowman`, and Trainer Gallery; empty typed slot only | Individual positive mechanisms above | Leave-one-family-out replay plus wrong-role collision audit | Keep as evaluation candidate |
| 5. Typed Composer compaction | De-duplicate components, compact bounded product hierarchy, preserve typed identity tokens, emit reason codes | Composer ablation 5 winning cards total, 0 losses | Re-run all 100/148/150 field cohorts and diff drop reasons | Strongest deterministic candidate |
| 6. Slab/label exact precedence | Exact slab-label season/product/set/card-name text may outrank an incompatible visual guess; provenance retained | Present in the manually direct 37, not independently replayed as a bundle | Build resolver rows only from existing exact label spans; zero-call per-field ledger first | Unmeasured candidate; do not promote yet |
| 7. Candidate-only world ranking | Use player/team/year/product compatibility to reject or rank combinations; never synthesize or overwrite visible text | Needed by the ambiguous 19; no safe automatic gain measured | Offline contradictions and top-k ranking on existing candidate rows | Research lane, no canonical authority |

The world model should remain small and falsifiable at this stage: versioned
compatibility facts and provenance, not a new remote service or an automatic
truth source. It may say “this candidate is incompatible” or rank top-k; it may
not rewrite exact visible card text.

## Explicit STOP and DEFER list

| Proposal | Evidence | Decision |
|---|---|---|
| Free title expression as final authority | Fresh 150: 44 wins / 95 losses / 11 ties versus canonical | **STOP** |
| Full exhaustive observations in default runtime | `13.83x` canonical output tokens; observation count vs useful recovery `r=-0.0129` | **STOP**; evaluation instrument only |
| Broad free-title product projection | 3 wins / 2 losses; wrong `Topps Chrome`, lost `Court Kings` | **STOP** |
| Broad serial zero-padding | 4 wins / 1 loss; changed `29/199 -> 029/199` against the reference | **STOP** |
| Treating canonical/evidence self-agreement as serial verification | Bounded-evidence v2 repeated `1/10`, while the image/reference was `07/10`; `critical_false_promotions=1` | **STOP**; require independent ground truth or retain candidate only |
| Serial prompt expansion | Six-card screen changed unrelated fields and missed `05/20` | **STOP** |
| Global printed-team restoration | 12 wins / 83 losses / 3 ties, macro F1 `-0.066053` | **STOP** |
| Broad logo-to-Set / printed-set admission | 4/11 and 1/4 respectively on the 100 replay | **STOP** |
| Wider identity overlay | 4 wins / 12 losses / 86 ties, macro F1 `-0.004188` | **STOP** |
| Candidate-expression v5 slot-priority prompt | 20 paired rows, expression delta `-0.00032`; hypothesis score sharply negative | **STOP** |
| Global drop-order rewrite | COS-8/COS-9 alignment and existing positive suppression evidence | **STOP**; recover by compaction and evidence-gated exceptions |
| Lot components/grade brackets | Four losses on two cards, but no positive paired grammar replay and writer convention differs (`lotx3` vs `3 Card Lot`) | **DEFER** to explicit CSM/SEM contract experiment |
| Bare visual color promotion | Wrong-role collisions and seven silent-normalization cases coexist | **DEFER** unless catalog/printed evidence makes one exact value compatible |

Aggregate gain never overrules a critical factual mutation. A numeric mutation,
conflicting product identity, newly invented field, or unrelated-field drift is
an automatic arm-level failure even when mean F1 rises.

## Remaining audit debt

1. The `37 / 8 / 19 / 9` human labels exist only in the Markdown ledger; there
   is no machine-readable label file bound to the checkpoint SHA.
2. The fresh150 raw 109 schema omissions have not received the same direct /
   duplicate / candidate / reject human classification.
3. The analyzer is role-blind and phrase-blind. It matches de-duplicated tokens
   without validating observation label, source region, confidence, or complete
   phrase semantics; raw stage counts are opportunity screens, not field truth.
4. The analyzer's multi-file CLI can silently select zero pairs unless
   `--canonical-arm` and `--exhaustive-arm` are passed explicitly. Any future
   automation should fail closed on zero pairs and cohort fingerprints.
5. Experiment analyzers, artifacts, and overlay admission are absent from the
   production checkout. That is currently the safe state, not a missing
   production deployment.

## Promotion math and next decision

The current narrow retained-150 replay clears a descriptive “at least 10
positive rows” screen with 13 wins and no measured losses. It does **not** clear
an independent promotion gate because mechanisms were selected after inspecting
these retained cohorts. The current safe-bundle script also drifted after the
stored artifact by adding TCG IP admission.

Therefore:

1. Freeze one exact candidate bundle and its request/replay/source hashes.
2. Exhaust existing zero-cost adversarial rows first: serial conflicts, Lot,
   product hierarchy conflicts, wrong-role colors/teams, and 80-character
   displacement.
3. Do not buy another 150-card run on the same labels. The existing 255-card
   pool is already development-exposed (`150 + 105`); mixing 45 development
   cards into 105 unseen cards does not create an independent 150.
4. Only when a genuinely new sealed card pool exists should one pre-registered
   paid confirmation be considered. Required result: no critical mutation, no
   reference-loss card, no over-80 title, non-negative field ledgers, and a
   positive paired direction. Production promotion remains a separate decision.

The immediate engineering direction is consequently not “add another
constraint.” It is to stop discarding exact, source-anchored evidence, retain
ambiguous evidence as candidates, and make every admission and Composer loss
observable. Legality remains deterministic at the final boundary.

## Reproduction and lineage

The two current zero-cost reruns were written only to a temporary directory:

```text
node scripts/replay-expression-v4-narrow-bundle.mjs \
  --include-attested-insert --disable-product-leaf \
  --out /tmp/lynca-accuracy-audit.mCfyYM/narrow.json

node scripts/replay-accuracy-safe-bundle-150.mjs \
  --out /tmp/lynca-accuracy-audit.mCfyYM/safe.json

node scripts/analyze-canonical-composer-feature-ablation.mjs \
  --out /tmp/lynca-accuracy-audit.mCfyYM/composer.json
```

Relevant source SHA-256 values at replay time:

| Source | SHA-256 |
|---|---|
| `scripts/replay-accuracy-safe-bundle-150.mjs` | `c6fc905767404731f39b8e9f7eec4e608638d6729e3ba3fe10366896db28cbe5` |
| `lib/listing/thin/candidate-expression-bundle-v3.mjs` | `ef0666d85c794fe619400a8208ae4e6be09e995ecd1ec160734b739c042c3dc4` |
| `lib/listing/thin/candidate-expression-bundle-v2.mjs` | `ec362ba62eba12a5a363336e2f7b71eaa95e033e31720029c50c6e15d39de7f6` |
| `lib/listing/thin/candidate-expression-v4-identity-v3.mjs` | `427ccdca0e9accf11dfebee675a6cb940f19a5cbc934dc168dddc620dc15c25c` |
| `lib/listing/thin/canonical-composer.mjs` | `5647f4580c78acbba425c00748c6fca814d7b85920af7d61b27792d8b9dace25` |
| `scripts/replay-expression-v4-narrow-bundle.mjs` | `850a613cf9072804e6062f83fbf77c840b95ce3ee2d46bc150f7e7b30d7c275a` |
| `scripts/analyze-canonical-composer-feature-ablation.mjs` | `1c242cf94c739184703d336e32b937e43e5c82374ecc6036a48ce5f786a59d85` |

Analyzer output fingerprints:

| Cohort | SHA-256 |
|---|---|
| Recomputed high100 diagnosis | `07c183c18b953585a7ca96ea3f1116abadd65d8e2dd5bf2e94478895b0084f18` |
| Recomputed fresh150 diagnosis with explicit arm names | `7a76100404973d28423494c99b35dafc0ca536822e66e334a46ffea104eefd4e` |

Primary retained sources:

- `docs/evaluation/extreme-observation-high-100-loss-audit-2026-08-01.md`
- `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/exhaustive-loss-audit.json`
- `docs/evaluation/accuracy-bundle-confirmatory-150-2026-08-02.md`
- `docs/evaluation/accuracy-mechanism-confirmatory-2026-08-02.md`
- `docs/evaluation/20-card-replay-transfer-150-2026-08-02.md`
- `docs/evaluation/team-direct-observation-screen-2026-08-02.md`
- `docs/evaluation/canonical-serial-exact-prompt-screen-6-2026-08-02.md`
- `docs/evaluation/candidate-expression-v5-screen-stop-2026-08-02.md`
