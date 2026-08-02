# Extreme observation high-100 loss audit — 2026-08-01

## Production integration correction

The offline waterfall and the `37 / 8 / 19 / 9` audit below remain valid, but
the candidate `bounded-open-evidence.mjs` resolver from the evaluation
worktree is **not approved for production**. A later CSM/SEM conformance review
found that it trusted model-authored role labels, promoted leading-zero serial
evidence into `fields.serial`, mapped `Redemption Card` to `card_name`, and had
no append-only CSM carrier for open-set evidence. Production SEM classifies
serial evidence as `EVIDENCE_ARTIFACT` with `promotion_allowed: false`.

The reusable asset is therefore the measurement and the bounded same-call
experiment design, not that resolver implementation. Before any runtime use:

1. add an append-only open-evidence sidecar that cannot directly select a CSM
   value;
2. retain serial as renderer-only current-copy evidence;
3. keep copyright years and visual finish descriptions candidate-only;
4. measure canonical control versus bounded treatment on an independent
   150-card paired holdout, including canonical-field drift, false role
   promotion, tokens and latency.

Until those gates pass, production integration is `NO_GO`; the current
canonical response remains the runtime contract.

## Decision

The opposing hypothesis is that exhaustive free expression should become the
default recognition response because it raises recall. The stored 100-card run
does not support that design. Exhaustive mode produced `13.83x` as many output
tokens as canonical mode, while more observations had essentially zero
relationship with the number of useful schema misses recovered (`r=-0.0129`).

The positive asset is narrower:

> one Luna call may carry a bounded, lossless open-evidence ledger beside its
> canonical proposals; a resolver may promote exact evidence into CSM/SEM, and
> Composer remains the only marketplace projection boundary.

Full exhaustive enumeration remains an evaluation instrument. It is a
long-term negative runtime asset and should not enter the default path.

## Evidence and limits

This audit is offline. It reads only:

- `artifacts/extreme-observation-2026-08-01/thin-path-gpt-5.6-luna.jsonl`;
- `artifacts/extreme-observation-2026-08-01/diagnosis-high-100.json`;
- the checked-in analyzer and canonical Composer.

No provider, storage, retrieval, OCR, vector, or Cloud Run request was made.
The token metric lowercases and de-accents each title, splits it into a set, and
weights per-card precision and recall equally. A repeated synonym therefore
receives credit even when it adds no collectible meaning. The reviewed title is
the desired output, not an exhaustive transcription or proof that every
observation is true.

Labels used below:

- **Fact**: directly recomputed from the stored artifacts or deterministic
  Composer.
- **Manual audit**: an evidence-to-semantic-role judgment, with the exact card
  and span retained below.
- **Heuristic**: plausible evidence that cannot be promoted safely without a
  catalog, temporal/world constraint, or human review.
- **Oracle ceiling**: appends only tokens known after the fact to be in the
  reviewed title. It ignores the 80-character budget and false extra terms, so
  it is not an achievable experiment result.

## The complete 296-occurrence waterfall

**Fact:** canonical high starts at macro F1 `0.769802`, recall `0.732959`, and
precision `0.823428` on these 100 cards.

| Earliest boundary | Occurrences | Cards | Share of 296 | What a stronger parser can do |
|---|---:|---:|---:|---|
| Exhaustive still did not express it | 170 | 77 | 57.4% | Nothing directly; the span is absent |
| Exhaustive expressed it, canonical fields did not retain it | 73 | 53 | 24.7% | Parser/resolver opportunity, after semantic audit |
| Canonical fields retained it, Composer did not emit it | 53 | 37 | 17.9% | Parser cannot help; this is grammar/projection/budget |

Affected-card counts overlap. Sixteen cards hit all three boundaries; only four
cards had no missing reference token at any boundary.

Even an oracle that restores all `73 + 53 = 126` expressed occurrences raises
macro F1 only to `0.840195` (`+0.070393`). The remaining 170 occurrences are a
hard boundary for parser-only work in this cohort.

## What free expression actually added

### The raw 73 are not 73 safe fields

**Manual audit:** every one of the 73 occurrences was traced back to the exact
exhaustive observation that matched it.

| Audited class | Occurrences | Interpretation |
|---|---:|---|
| Direct, correctly scoped, commercially incremental evidence | 37 | Best zero-extra-call resolver target |
| Exact evidence but already represented by a canonical synonym | 8 | Five `Autograph` vs `Auto`; three `Rookie` vs `RC`; fix metric/evidence retention, not title duplication |
| Plausible but semantically ambiguous | 19 | Needs catalog/world constraints or human review |
| Wrong-role token collision | 9 | Must not be promoted |
| **Total** | **73** | Raw analyzer count |

The 37 direct incremental occurrences affect 29 cards and break down as:

| Target field | Occurrences | Exact card evidence |
|---|---:|---|
| Year / season suffix | 3 | `2018-19` twice and `2020-21` once |
| Product / set / IP | 11 | `NBL`, `Ultra`, `Graphite`, `Kings`, `Star Wars`, two `Disney`, `Draft`, `VeeFriends`, `Optic` |
| Team extension | 6 | `FC`, two `Los Angeles`, `KC`, another two `Los Angeles` |
| Card name / release design | 7 | `5 Pick 2`, `Derby`, `Throwback`, `Kaboom Horizontal` |
| Exact serial | 4 | `027/150`, `5/5`, `04/25`, `038/220` |
| Components / card type | 6 | two `1st`, two `Jersey`, `Redemption Card` |

Representative direct recoveries:

- `reviewed_blind_940144961215fef91c18`: exhaustive preserved `5`, `PICK
  2`, and `027/150`; canonical emitted only `27/150`. This is an exact-span and
  leading-zero resolver case.
- `reviewed_blind_ee03ba06dd634655b4ba`: the slab label said `KABOOM
  HORIZONTAL`; canonical proposed `Blue Geometric`. Slab-label identity should
  outrank a visual finish guess.
- `reviewed_blind_8cabcafd0596fbab0bb0`: the front logo said `Optic O
  DONRUSS`; canonical shortened the product to Donruss. This is an anchored
  product extension.
- `reviewed_blind_4c8131eeda536c66d385`: `REDEMPTION CARD` was printed
  repeatedly and correctly labeled, but never became a component/card type.

### The 19 heuristic candidates

These occurrences are useful as candidates, not values:

| Candidate family | Occurrences | Why promotion is unsafe |
|---|---:|---|
| Copyright year as release year | 3 | `©2025/©2026` can trail production and does not establish a season by itself |
| Tennis imagery/licensing as product token | 2 | Establishes category, not necessarily the official product name |
| Color / pattern / finish inference | 14 | `red`, `white`, `gold`, `teal`, `geometric`, `refractor-style`, `sparkle-like`, and `border` can describe artwork instead of the named parallel |

Examples include `green` from a green portrait border, `white` from a
multicolor scheme, and `refractor` from a model-authored “refractor-style”
description. A product-specific parallel enumerator could use these spans to
rank candidates, but the spans alone are not sufficient evidence for a final
value.

### The 9 wrong-role collisions and 8 duplicate semantics

The nine wrong-role occurrences are concrete false-positive mechanisms:

- `dark` came from a player's cap and an autograph mark, not `Dark Blue
  Bordered`;
- `red` came from multicolor lot borders, not a shared Red parallel;
- `2` came from a statistics table, not `Series 2`;
- `horizontal` came from back-design stripes, not the Horizontal Downtown
  orientation;
- two `Rookie` hits came from career biography (`rookie season`, `Rookie of
  the Year`), not a rookie-card mark;
- `black` described a cow drawing, `blue` a uniform/background, and `all` the
  phrase `ALL RIGHTS RESERVED`.

Five other rows had a visible autograph and the reference used both `Auto` and
`Autograph`, while canonical correctly normalized it to `Auto`. Three rows had
an explicit `ROOKIE` badge and canonical normalized it to `RC`. Those eight
spans belong in evidence, but duplicating their synonym in an 80-character
title is metric gaming, not semantic recovery.

### Parser recovery ceilings

**Oracle ceiling:** the following counterfactuals append only reviewed-title
tokens, without charging them against the character budget.

| Oracle admission | Occurrences | Macro F1 | Delta vs canonical |
|---|---:|---:|---:|
| Audited direct incremental pool | 37 | 0.791425 | +0.021623 |
| Direct + all 19 heuristic candidates | 56 | 0.802634 | +0.032832 |
| Every raw schema-compression token | 73 | 0.812104 | +0.042301 |

The first row is the useful engineering target, not a forecast. A real parser
will also introduce false positives, respect bracket priority, and spend the
80-character budget, so its measured gain must be smaller than this ceiling.

### Row-level audit ledger for all 73 occurrences

Asset labels below omit the common `reviewed_blind_` prefix. An empty cell
means that class did not occur on that card. “Review” is the explicit
human/catalog/world-resolution queue; “reject” is evidence in the wrong role.

| Asset suffix | Direct incremental | Semantic duplicate | Review / candidate only | Reject collision |
|---|---|---|---|---|
| `dfba61396ec82f2b864e` | `19` |  |  |  |
| `cd842de8c33e22b20d47` |  |  | `2025` |  |
| `3c690ab7d28f6c3d3e89` | `fc` |  |  |  |
| `a78c9e94bec0ced79c29` |  | `autograph` |  |  |
| `3215d29874a3dad22bbb` | `nbl` |  |  |  |
| `9ef085a2c3022091aec0` |  |  | `tennis` |  |
| `a0f9f2aba5a459e23140` |  |  | `geometric` |  |
| `8541091b7125268e2d05` | `ultra` |  |  |  |
| `a12d7e8c2d623c870df4` |  |  |  | `dark` |
| `a38ced8b163264d9d95a` | `21` |  |  |  |
| `72e1bdac368317a7c3b1` | `graphite` |  |  |  |
| `52526222b532fbef54e2` |  |  | `green` |  |
| `89cde2e9bc69a6edb4fd` | `kings` | `autograph` |  |  |
| `46be33ef1f2dbc0956af` | `los angeles` |  | `red` |  |
| `bcc4e7ac4ac23e1e69d3` |  |  | `2026` |  |
| `098dbc6f39f5cccb43ff` |  | `autograph` |  |  |
| `f371844dc1d0c6e49f92` | `star wars` |  |  |  |
| `d3bcbaa288c732ffed37` | `disney` |  |  |  |
| `e0962fbbfd41c6c77f55` |  |  |  | `rookie` from biography |
| `69e5113bcd0c8438df45` |  |  | `geometric` |  |
| `940144961215fef91c18` | `5 pick 2 027/150` |  |  |  |
| `646c3f4af20b9ee7fe07` |  |  |  | `red` from multicolor lot borders |
| `bc9654d83b13db44d507` | `kc` |  | `border` | `2` from statistics |
| `cd081e3a017a5c05b5b5` |  |  |  | `horizontal` from back stripes |
| `12f2d135218a7ca35d3e` | `derby` |  |  |  |
| `8b3024b5cc435830e80c` | `throwback` |  |  |  |
| `316c9c2012386b0a64ed` | `jersey` |  |  |  |
| `c279329f2f78d7f65071` | `19` | `rookie` vs `RC` |  |  |
| `5578954f2c4a40caf3bc` | `5/5` |  |  |  |
| `34413231dd0ea69e68a4` |  | `rookie` vs `RC` | `red yellow` |  |
| `6683a671093f786a0948` | `jersey` |  |  |  |
| `b514a8918dbc221a17bd` | `los angeles` |  |  |  |
| `64d10f8c8986aa1c9af4` |  |  |  | `rookie` from biography |
| `d768c8f01fbfdd779bb0` | `1st` |  |  |  |
| `dbf99f2a5e722e98b87a` |  | `rookie` vs `RC` | `white` |  |
| `12eca650b27f025d5a1c` |  | `autograph` |  |  |
| `c6ecb08d49256335aa6b` | `1st` |  | `refractor` |  |
| `3304222f844f985e9574` |  |  | `refractor` |  |
| `4c8131eeda536c66d385` | `redemption card` |  |  |  |
| `ee03ba06dd634655b4ba` | `kaboom horizontal` |  |  |  |
| `8945fde9c65cb1b9f3a8` |  |  | `gold` |  |
| `04bed0401e6450349141` |  |  | `teal` |  |
| `8922f71c190ac8dbeca8` | `disney` |  | `2026 sparkle` |  |
| `0184bc4079b5350adad2` |  | `autograph` |  |  |
| `d1cc0f12cdbba0306e8b` |  |  |  | `all` from copyright |
| `c4905891fd0ed7eb8308` | `draft` |  |  |  |
| `7059d3b39d01402f0e61` | `veefriends` |  |  | `black` from cow drawing |
| `89e97f6cf6442bdbc497` | `04/25` |  |  |  |
| `0c7b873fec31df71ddb3` |  |  |  | `blue` from uniform/background |
| `1f3be5eca26948c10405` | `038/220` |  |  |  |
| `8cabcafd0596fbab0bb0` | `optic` |  |  |  |
| `413aa29a2561ee50f989` |  |  | `tennis` |  |
| `4a36645e653a8b8a8019` |  |  | `red` |  |

## Where all 53 downstream occurrences were lost

### Summary and independent oracle impact

| Root cause | Occurrences | Cards | Oracle F1 delta | Correct action |
|---|---:|---:|---:|---|
| Priority/budget drop | 25 | 16 | +0.012830 | Compact long values; do not violate COS priority globally |
| Marketplace suppression | 14 | 12 | +0.008907 | Add evidence-gated exceptions only after a paired replay |
| Lot grammar has no bracket | 4 | 2 | +0.002090 | Decide at CSM/SEM contract level |
| Silent normalization | 10 | 10 | +0.005984 | Make typed exceptions observable and test them |
| **All downstream losses** | **53** | **37** | **+0.029578** | Effects overlap by card; this is an oracle ceiling |

### 25 priority/budget drops — every token

| Asset | Lost reference-helpful token(s) | Dropped bracket |
|---|---|---|
| `reviewed_blind_410c0c9aa76e944a0cbc` | `donruss elite` | manufacturer, product |
| `reviewed_blind_b70318cffa06b389f851` | `game of thrones` | product |
| `reviewed_blind_bcc4e7ac4ac23e1e69d3` | `polanco ryan` | extra subjects |
| `reviewed_blind_6d227f82fdcb2ded4b6d` | `luis cova david refractor` | extra subjects, print finish |
| `reviewed_blind_12f2d135218a7ca35d3e` | `tribute` | product |
| `reviewed_blind_ba0f97b835e28571d19f` | `purple` | print finish |
| `reviewed_blind_e90ca474692fe8f57b44` | `orange` | print finish |
| `reviewed_blind_4aa0c1e7f7e95ed8ae49` | `topps violet speckle` | manufacturer, print finish |
| `reviewed_blind_3304222f844f985e9574` | `orange` | print finish |
| `reviewed_blind_2cada69235bf401f2a16` | `panini` | manufacturer |
| `reviewed_blind_4c8131eeda536c66d385` | `red` | print finish |
| `reviewed_blind_0dd3315a29711425e71b` | `shop` | print finish |
| `reviewed_blind_0184bc4079b5350adad2` | `immaculate` | product |
| `reviewed_blind_58264271a4854c4a73ed` | `green` | print finish |
| `reviewed_blind_5fd1a40d7b38a755be74` | `topps` | manufacturer |
| `reviewed_blind_4a36645e653a8b8a8019` | `uefa` | product |

The budget is real, but whole-bracket deletion often overshoots. For example,
the Game of Thrones uncompressed title is 108 characters and loses the entire
44-character product value, ending at 63. A hierarchical product value could
retain `Game of Thrones` while dropping `The Complete Series Volume 2`.
Conversely, the Mahomes title is 81 characters before compression and loses
`Panini`, ending at 74; it needs one character of compacting elsewhere, not a
different priority tier. Lot titles need compact subject forms rather than
blindly restoring all full names.

### 14 marketplace suppressions — every token

| Asset | Suppressed helpful token(s) | Policy |
|---|---|---|
| `reviewed_blind_cd842de8c33e22b20d47` | `spurs` | team/search optimization |
| `reviewed_blind_3c690ab7d28f6c3d3e89` | `arsenal` | team/search optimization |
| `reviewed_blind_0692862d56755fe4e863` | `lakers` | team/search optimization |
| `reviewed_blind_5edfef737b8f58f5253b` | `dodgers` | team/search optimization |
| `reviewed_blind_a0250627a306090528ce` | `mets` | team/search optimization |
| `reviewed_blind_46be33ef1f2dbc0956af` | `dodgers` | team/search optimization |
| `reviewed_blind_f371844dc1d0c6e49f92` | `df 3` | card number |
| `reviewed_blind_bc9654d83b13db44d507` | `royals` | team/search optimization |
| `reviewed_blind_b514a8918dbc221a17bd` | `dodgers` | team/search optimization |
| `reviewed_blind_86c114c0d0e9866d56cf` | `astros` | team/search optimization |
| `reviewed_blind_ac56300fcdbf84e6f7d2` | `white sox` | team/search optimization |
| `reviewed_blind_8e6763a0f5c15b07ef8a` | `76ers` | team/search optimization |

This table does not justify removing suppression. The checked-in policy records
that global card-number suppression had 113 wins to 3 losses and global team
suppression improved the larger replay. These 12 cards are exceptions. The
next candidate is a directly printed, normalized short-team exception and a
product/IP-specific card-number exception, both paired against the full
holdout.

### 4 lot-grammar omissions — every token

| Asset | Lost token(s) | Canonical field with no lot bracket |
|---|---|---|
| `reviewed_blind_646c3f4af20b9ee7fe07` | `rc` | observable components |
| `reviewed_blind_0dd3315a29711425e71b` | `promo` | set/release wording |
| `reviewed_blind_0dd3315a29711425e71b` | `psa 10` | grading info |

This is not an implementation typo. `semLotTitleOrder` has shared card name,
finish, numerical rarity, and search optimization, but no observable-components
or grading-info bracket. Adding them changes the CSM/SEM grammar and must be
decided there first; teaching the parser more words cannot make Composer emit a
bracket that does not exist.

### 10 silent normalizations — every token

| Mechanism | Assets and lost tokens | Count |
|---|---|---:|
| Bare color withheld because no exact/family finish grounded it | `5edf… orange`; `a12d… blue`; `098d… red`; `e2c5… gold`; `c6ec… blue`; `981c… orange`; `413a… green` | 7 |
| Category filler removed inside an identity-bearing value | `cd081… basketball`; `86c1… baseball`; `0c7b… card` | 3 |

Both current global policies are measured positive, so restoring all ten is not
a safe fix. The minimal candidates are an attested color/parallel resolver and
typed identity boundaries that retain `Basketball` in `One & One Basketball`,
`Baseball` in `Baseball Stars`, and `Card` in the manufacturer `Wild Card` while
still removing generic category prose.

## Measured Composer recovery — default-eligible subset

The first deterministic subset has now been implemented and replayed against
the exact stored 100-card control. The control reproduces macro F1
`0.7698022907754876` before the candidate is scored; this is an isolated
Composer comparison, not a comparison against a stale title version.

| Metric | Stored control | Candidate | Delta |
|---|---:|---:|---:|
| Macro F1 | 0.769802 | 0.775863 | **+0.006061** |
| Macro recall | 0.732959 | 0.741597 | **+0.008638** |
| Macro precision | 0.823428 | 0.826283 | **+0.002855** |
| Paired cards | 100 | 100 | 10 wins / 0 losses / 90 ties |
| Titles changed | — | 12 | 3 score ties |
| Titles over 80 characters | 0 | 0 | 0 |

The exact two-sided sign-test result is `p=0.001953125`. The candidate recovers
12 of the 53 downstream occurrences (`22.64%`) on ten cards:

This 100-card cohort was also used to discover the loss classes, so its
sign-test value is descriptive, not an independent confirmatory p-value. Two
broader stored-field replays therefore compare the candidate with the exact
pre-change Composer at git commit
`d8bc6590bc542ab7be0a0395e41d9a1bac344240`, rather than with historically
rendered titles that include unrelated Composer drift:

| Stored field cohort | Baseline F1 | Candidate F1 | Delta | Paired result | Safety proxy |
|---|---:|---:|---:|---:|---:|
| Current layered schema, 148 cards | 0.774493 | 0.777191 | **+0.002698** | 6 / 0 / 142, p=0.03125 | 0 critical-wrong proxies |
| Earlier v3 schema, 150 cards | 0.769713 | 0.772441 | **+0.002728** | 6 / 0 / 144, p=0.03125 | 0 critical-wrong proxies |

These cohorts overlap the diagnostic population and therefore are robustness
replays, not independent samples. What they establish is narrower and still
useful: the deterministic change remains non-negative across both the current
and previous canonical field shapes, with no 80-character violation, no lost
reference-helpful token, and no newly invented token in either replay.

| Original loss bucket | Recovered | Still unresolved | Recovery mechanism |
|---|---:|---:|---|
| Priority / budget | 9 / 25 | 16 | Lossless Auto de-duplication creates room; a repeated manufacturer prefix may yield to a one-word Product leaf instead of deleting Product entirely |
| Marketplace suppression | 0 / 14 | 14 | Deliberately unchanged |
| Lot grammar | 0 / 4 | 4 | Deliberately unchanged pending CSM decision |
| Silent normalization | 3 / 10 | 7 | Preserve a category token only inside a typed manufacturer/product identity |
| **Total** | **12 / 53** | **41** | — |

The recovered tokens are `Game of Thrones` (three), `Elite`, `Tribute`, two instances of
`Topps`, `Red`, `Immaculate`, `Basketball`, `Baseball`, and `Card`. Every newly
rendered token already exists in the card's canonical fields. The replay found
zero unbacked new tokens and zero lost reference-helpful tokens after treating
the contract's `Autograph/Autographed/Autos -> Auto` as one sanctioned semantic
normalization. This is a structural critical-wrong proxy, not a new human label
for factual correctness.

### What entered the default Composer

1. `Autograph`, `Autographed`, `Autographs`, and `Autos` normalize to `Auto`;
   an exact `Auto`/`Relic`/`Patch` already present in Card Name, Finish, Rarity,
   or Grade is not repeated in Observable Components. Patch, Jersey, and Relic
   remain distinct when separately present.
2. `Game of Thrones The Complete Series Volume 2` may serialize as its parent
   `Game of Thrones`, and `Immaculate Collection` as `Immaculate`, **only when**
   that bounded parent is what lets the title fit instead of dropping Product.
   Canonical storage keeps the full value. There is no generic token-by-token
   product truncation.
3. Category filler remains hidden by default, but typed identity wins for the
   syntactic cases exposed by the audit: manufacturer `Wild Card`, a leading
   named-product term such as `Baseball Stars`, and a mirrored construction such
   as `One and One Basketball`.
4. TCG Card Number and Numerical Rarity normalize whitespace around `/` while
   preserving every digit. Unit coverage pins `086 / 070 -> 086/070` and
   `027 / 150 -> 027/150`; no numeric coercion is allowed. The 100-card replay
   contains no spacing case, so this contract-safe behavior has no measured F1
   claim.
5. Every applied semantic normalization emits a reason code, including
   `card_name:autograph_to_auto`,
   `observable_components:auto_duplicate`,
   `product:hierarchy_suffix_removed`,
   `product:collection_suffix_removed`, and
   `manufacturer:identity_category_preserved`.

### What did not enter the default Composer

- Team and Standard Card Number stay under the measured eBay suppression
  policy. The 14 oracle-selected exceptions cannot overturn the larger positive
  control without an evidence-gated paired policy.
- Lot does not gain Components or Grading Info brackets. That is a CSM/SEM
  grammar decision, not a renderer shortcut.
- Bare color still does not render without an exact/family finish anchor.
- `Patch Relic` and `Jersey Relic` are not collapsed. The terms are separately
  expressible in CSM and reviewed titles sometimes intentionally contain both.

The machine-readable replay, including all 12 changed rows, is
`artifacts/extreme-observation-2026-08-01/composer-recovery-high-100.json`.
The two schema-robustness outputs sit beside it as
`composer-recovery-canonical-v4-148.json` and
`composer-recovery-canonical-v3-150.json`.
It is regenerated by `scripts/analyze-canonical-composer-recovery.mjs`; the
exact metrics are pinned by `scripts/analyze-canonical-composer-recovery.test.mjs`.

## Noise, verbosity, and what cannot be claimed

**Fact:** exhaustive mode emitted 4,803 observations, mean 48.03 per card
(`21..103`). It used 149,196 output tokens versus 10,788 for canonical mode,
or `13.83x`. Mean stored latency was 55,325 ms versus 50,845 ms; the run was not
designed as a latency benchmark, so only token amplification is a stable cost
claim.

Of the 4,803 observations:

- 4,645 (`96.71%`) were self-labeled High confidence;
- 2,496 (`51.97%`) had no token overlap with either the reviewed title or that
  card's canonical fields: 1,822 printed-text, 572 visual-property, and 102
  object-structure observations;
- only 131 (`2.73%`) contained any of the 73 raw schema-compression tokens;
- 23 cards declared 68 unreadable regions;
- zero parse/schema defects were recorded, which proves structural validity,
  not factual validity;
- cards with a raw schema recovery averaged 47.96 observations; cards without
  one averaged 48.11. Observation count and recovery count had Pearson
  `r=-0.0129`.

The 2,496 observations are an **irrelevance/noise proxy**, not 2,496
hallucinations. Reviewed titles intentionally omit statistics, biographies,
copyright text, layout, and many true visual facts. The stored data cannot
measure the exhaustive arm's absolute false-recognition rate because it has no
exhaustive human observation label. What it can prove is that self-confidence
does not separate useful title evidence, and that 17 of the 73 apparently
helpful occurrences were either semantic duplicates or wrong-role collisions.

The exhaustive title itself scored recall `0.784813`, precision `0.064356`, and
F1 `0.118089`. That score is diagnostic only, but it demonstrates why the
ledger cannot be passed directly to listing output.

## Minimal positive-asset implementation order

1. **Lossless evidence beside canonical fields, same call.** Preserve exact
   spans, source region, open label, and model confidence when they are not
   consumed by a canonical proposal. Deduplicate repeated front/back/copyright
   spans; do not enumerate generic statistics and layout in the runtime schema.
2. **Deterministic high-precision resolver.** First admit exact serials with
   leading zeroes, exact slab-label season/product/set text, printed product/IP
   logos, and explicit `1st`, Jersey, or Redemption marks. This targets the 37
   direct incremental occurrences without a second model call.
3. **Candidate-only resolver.** Route copyright years, visual colors, patterns,
   and “-style” finish descriptions into a candidate set. Promote only when a
   versioned catalog/world constraint leaves one compatible value; otherwise
   retain evidence or request review.
4. **Composer work after parser work is measured.** Add compact hierarchical
   identity rendering, observable reason codes for typed normalization, and
   separately ablate lot brackets and suppression exceptions. Do not change a
   global positive policy to recover an oracle-selected minority.
5. **Promotion gate.** Report per-card and per-field wins, false promotions,
   80-character drop changes, extra output tokens, and latency. Remove the
   runtime evidence lane if its paired semantic gain remains negative after the
   resolver is attached; evidence retention alone is not product value.

The cheapest recoverable model-side score is therefore not “ask Luna to say
everything.” It is “never discard a high-value exact span Luna already said,
but require semantic authority before that span becomes CSM or a title.”
