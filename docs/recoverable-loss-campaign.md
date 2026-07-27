# Campaign: recover the accuracy we already have

Written 2026-07-27. One long campaign, seven to ten hours. Not a checklist —
a repeated investigation with the same method applied to four buckets.

## The premise, measured

An offline audit of the reviewed benchmark splits every missing title token by
whether the pipeline **had the value and failed to print it** or **never read
it at all**:

```
recoverable (held, not printed)      88
  RESOLVER_HELD_NOT_RENDERED         49
  CANDIDATE_HELD_NOT_APPLIED         27
  serial RESOLVER_HELD_NOT_RENDERED   8
  EVIDENCE_HELD_NOT_RESOLVED          4
never held (real recognition gap)    30
```

**Seventy-five percent of the remaining accuracy loss needs no better model.**
The information is already inside the pipeline and is being discarded on the
way to the title. That is the campaign.

### Read this before touching any of it

**"Recoverable" means the value is present, not that printing it is an
improvement.** The first fix attempted from this audit regressed by 5.4 points
and was reverted.

`2b1b7f4` extended the grounding that already trusts a first-pass vision read
for `surface_color` to cover `parallel_family` as well, on the reasoning that
the finish family is a coarse visual property of the same kind as the colour
sitting beside it. The audit said it would recover twenty-two tokens. The live
paired eval said:

```
baseline  (production)  median 0.8414
candidate (the fix)     median 0.7875
delta -0.0539 against a 0.0123 threshold, REGRESSED, 3 of 3 rounds
```

The reasoning was wrong, and the gate was load-bearing. A colour is readable
off the pixels; a finish family is not — a Chrome card shines like a Refractor
whether or not it is one, so the first pass guesses, and printing the guess put
a wrong word on more cards than it fixed the right word on. The twenty-two
recovered tokens were bought with more than twenty-two wrong ones.

Two consequences for everything below:

1. **The audit counts tokens missing, not the tokens a fix would add wrongly.**
   Every entry in the queue is a hypothesis about a fix, not a scored win. Do
   not sum the buckets into an expected gain.
2. **A live paired eval is mandatory before any of these is called an
   improvement**, and REGRESSED is a likely outcome for at least some of them.
   Revert on REGRESSED, record why, and move to the next bucket. Finding that a
   gate is load-bearing is a real result — it is how we learned that
   `ENABLE_RETRIEVAL_APPLICATION` must stay on, and now that this one must too.

Reproduce the split any time with:

```bash
node scripts/audit-offline-benchmark-losses.mjs \
  artifacts/smoke/paired-eval/vocab17-candidate-r*.json --out /tmp/audit.json
```

## The method — this is the transferable part

Three of these losses have already been traced to root cause, and all three
were **the same bug wearing different clothes**: a field is rejected because a
verification step that never runs did not confirm it. Absence of a signal
treated as a signal against.

1. **Print-run evidence.** The renderer suppressed a resolved print run
   whenever no `field_evidence` entry existed for it — and the provider never
   emitted one. Fixed in `f14f7df`.
2. **Serial numerator.** `serialNumeratorVerified` is a three-state value
   (confirmed / refused / nobody looked) built by two producers that could only
   express two, so "nobody looked" arrived at the renderer as "the image
   refused it" and printed `#/25` instead of `12/25`. Twenty-seven of sixty
   cards, twenty-three of which held the exactly correct numerator. Fixed in
   `78cf4d8`.
3. **Parallel family.** A first-pass vision read at confidence >= 0.78 grounds
   `surface_color` but not `parallel_family`. The trace named the loss exactly
   -- `RESOLVER_NOT_PRESERVED` -- and the diagnosis was correct. The *fix* was
   not: `2b1b7f4` extended the colour's grounding to the family and regressed
   by 5.4 points, and was reverted in `9237e0f`. The recipe below finds where a
   value dies; it does not tell you that reviving it is safe.

The recipe that found all three:

1. Pick a card from `artifacts/smoke/paired-eval/vocab17-candidate-r*.json`
   whose reviewed title has the token and whose `final_title` does not.
2. Read `evaluation_decision_trace_packet`. It carries `normalization`,
   `resolver` (with `before`, `after` and an explicit `dropped` list),
   `retrieval`, `selection`, `application` and `renderer`. **The stage where
   the value disappears is stated outright** — `parallel_family` was labelled
   `RESOLVER_NOT_PRESERVED` and that was the whole diagnosis.
3. Prove the stages you suspect are innocent, do not assume it. Feed the
   renderer the exact field shape from the trace and see what it emits:
   giving it `surface_color` + `parallel_family` produced `Orange Refractor`,
   which proved the renderer innocent and put the loss upstream in one step.
4. Find the gate in the guilty stage and ask the diagnostic question: **is this
   a check the field can pass, or a guarantee it is dropped?** If the required
   signal is produced by a step that does not run, it is the latter.
5. Fix so the three states stay three. Reject only when something actually
   refused.

## Queue

Work in order. Each entry is: diagnose, fix, validate live, record. Do not
batch fixes — one change per paired eval, or the verdict cannot be attributed.

### 0. Done: parallel family, REGRESSED and reverted

Verdict recorded in `artifacts/smoke/paired-eval/parallel-family.json`, revert
in `9237e0f`. The finish family stays gated behind a focused crop-and-read.

The open question this leaves is worth more than the fix was: the family is
genuinely present in the reviewed titles, so it has to arrive some other way --
from the catalog rather than from a vision guess. Which is item 7, where the
catalog currently returns nothing at all.

### 1. The rest of RESOLVER_HELD_NOT_RENDERED (49)

The parallel-family fix addresses part of this bucket. Re-run the audit after
it lands and see what remains. Expect more than one distinct cause — the
missing-token histogram shows `sapphire` 6, `ucc` 4, `rookie` 4, `lucky` 3
alongside the finish words.

Two known traps in this bucket:

- **`sapphire` is not a vocabulary gap.** It is absent from
  `parallelFamilyTokens`, and adding it is the obvious fix and the wrong one:
  `sapphire` is also a product line (`Bowman Chrome Sapphire`,
  `Topps Chrome Sapphire`), so adding it would tear product names in half. Any
  fix has to be context-aware. The same trap ate a `team` backfill earlier that
  proposed `team="kylo ren"`.
- **`ucc` is not a recognition failure at all.** The reviewed title says `UCC`
  and we say `UEFA Club Competitions` — we are right and the writer abbreviates.
  That is a rendering-vocabulary question, not an accuracy one, and it should
  be fixed as an abbreviation mapping with no model involvement.

### 2. CANDIDATE_HELD_NOT_APPLIED (27)

A retrieved candidate carried the value and the application layer did not use
it. Start at `lib/listing/candidates/retrieval-application-layer.mjs` and the
decisions recorded in `l2_candidate_debug.retrieval_application.decisions` on
each row — every decision carries a `reason`, so the histogram of reasons
across these 27 tokens tells you which gate to open before you read any code.

Note that `ENABLE_RETRIEVAL_APPLICATION=false` **regressed accuracy by 2.31
points** in last night's ablation, so this layer is load-bearing. The goal is
to widen what it applies, not to weaken it.

### 3. serial RESOLVER_HELD_NOT_RENDERED (8)

These are cards missing the denominator entirely, where the resolver holds the
print run. Distinct from the 27 numerator-only cases already fixed. Same
recipe.

### 4. EVIDENCE_HELD_NOT_RESOLVED (4)

Smallest bucket, likely a single cause. Do it last.

### 5. Confirm the cumulative result at ten times the sample

Everything above is measured on `cold20` — twenty cards. Detecting a 0.02
difference reliably needs roughly 850–900 card-evaluations; three paired rounds
of cold20 is sixty. The individual verdicts are sound because the effects were
large, but the **cumulative** claim deserves the bigger set.

```bash
node --use-env-proxy <env files> scripts/run-paired-eval.mjs \
  --label cumulative-recoverable --rounds 4 --limit 200 \
  --baseline-url https://listing.lyncafei.team \
  --candidate-url <preview of final HEAD> \
  --dataset artifacts/smoke/reviewed-200.json \
  --sealed-labels artifacts/smoke/reviewed-200-labels.jsonl
```

At roughly twelve seconds per card this is about forty minutes per arm, so
budget three hours. It is the right way to end the campaign.

### 6. Measure the warm path — it has never been measured at all

This is the largest item in the campaign and it is not an ablation.

Every number this project has — 0.8329 accuracy, ~12s latency, 21.7% lister
acceptance — comes from runs that pass `--disable-identity-cache`. All twenty
cold20 rows report `route: COLD_START_SAFE_DRAFT` and `identity_cache_hit:
false`. Last night's ablation recorded `ENABLE_LISTING_FAST_PATH` as
"no trigger opportunities", which is true and is the wrong conclusion to stop
at: the fast path cannot fire because the harness forbids it, so **the warm
path has never been evaluated once.**

A lister works through a stack of cards from the same product. From the second
card onward they are on the path we have never looked at.

It is measurable. `buildIdentityResultCacheKey` keys on
`sha256(image content sha256 + role)` plus a version fingerprint, so the same
card images produce the same key: run the dataset once to populate, then again
without `--disable-identity-cache`, and the second pass hits. The version
fingerprint includes model and prompt version, so **each arm must warm itself**
— warm arm A, measure arm A, warm arm B, measure arm B, interleaved as usual.

Report warm-path accuracy, warm-path latency, and the cache hit rate. If warm
accuracy is materially different from cold, that changes what the whole project
should be optimising.

### 7. Find out why the catalog returns no candidates

On cold20, 15 of 20 cards get vector candidates and **0 of 20 get catalog
candidates** (`pre_l2_anchor_catalog_candidate_count` is zero on every row).

This is why `DISABLE_CANDIDATE_PROMPT_INJECTION` measured as "no active
effect": there were no catalog candidates to withhold. The flag is fine; the
catalog is contributing nothing on this dataset.

That matters more than the flag. The catalog now holds 75,990 official
checklist rows and 14,056 auto-parsed ones, and a day was spent expanding it.
If it retrieves nothing on the benchmark, either the retrieval query never
matches, the admission gate rejects everything, or the lane is not running.
Diagnose it from `l2_candidate_debug` and the retrieval trace on recorded rows
first — no model calls needed — and only then look at code.

### 8. Unshadow the three flags the harness overrides

`scripts/v4-ebay-smoke.mjs` hard-codes into every request:

```js
enable_catalog_assist: true,
enable_vector_retrieval: true,
vector_retrieval_mode: "assist",
```

Request options beat environment defaults, which is exactly why
`ENABLE_CATALOG_ASSIST_DEFAULT`, `ENABLE_VECTOR_ASSIST_DEFAULT` and
`ENABLE_VECTOR_LAZY_MODE` came back unmeasurable. They are not unmeasurable —
the wrong lever was being pulled.

Add CLI overrides so an ablation can send `false` (or omit the key), then run
the three A/Bs that were previously impossible. Keep the current values as
defaults so every existing run is unchanged.

### 9. Give the catalog lookup cache a trace signature

`ENABLE_CATALOG_LOOKUP_CACHE` came back unmeasurable because nothing in the
trace distinguishes a hit from a miss, so the two arms cannot be told apart —
and arm identity must be established empirically, never from deploy
bookkeeping.

The flag is read at `native-recognition-core.mjs:3048`. Add hit/miss counters
alongside the existing `catalog_cache_ms` timing, surface them in
`response_timing`, then run the A/B. The counters are worth having regardless
of how the ablation turns out.

## Protocol

**One paired eval at a time.** Two runs contend for provider capacity and
pollute both arms. Check `ps aux | grep "[r]un-paired-eval"` before starting.

**Baseline is production, candidate is the preview of your fix.** A positive
delta then reads "the fix helped".

**Render replay cannot validate everything.** `replay-render-from-eval.mjs` is
deterministic and free, but it replays the renderer from recorded
`resolved_fields` — anything upstream of that is invisible to it. The
parallel-family fix produced replay numbers byte-identical to the previous
day's serial fix, which is the tell that the replay saw nothing. Use replay for
renderer changes; use a live paired eval for resolver, constraint-engine and
candidate-application changes.

**NOT_PROVEN is a result.** Record it, leave the commit marked unvalidated,
move on. Do not re-run hoping for a better number.

**"Cannot be measured" is not a finished answer.** The point of the campaign is
a number, not a status. Last night four components came back unmeasurable and
every one of them turned out to be measurable within the hour: three because
the harness hard-codes the option that the environment flag was supposed to
control, and one because nothing in the trace distinguished the arms. Neither
is a property of the component — both are properties of the tooling, and
tooling is ours to change.

So when a path is blocked, the deliverable is not "blocked". It is:

1. **what exactly blocks it**, quoted from the code or the data — "the harness
   sends `enable_catalog_assist: true` at `v4-ebay-smoke.mjs:819`, which beats
   the environment default", not "the flag is shadowed";
2. **the smallest change that unblocks it**, and then **make that change and
   run it**;
3. only if the change is genuinely out of scope — it needs production access,
   a paid API, or a human decision — say so and say precisely what is needed.

Reporting a blocker honestly is right and is much better than inventing a
result. Reporting it *instead of removing it* is the thing to avoid. Budget for
this: unblocking the tooling is expected work in this campaign, not a detour
from it.

**Never deploy to production.** Preview deployments only. Production currently
runs the validated set and should stay there until a human decides otherwise.

**No database writes.** The Panini cohort ingest is out of scope.

## Environment

```
repo    /Users/paidaxin/Documents/Lynca/lynca-catalog-vocab   (branch feat/catalog-field-vocabulary)
env     node --env-file=/Users/paidaxin/lynca-listing-copilot/.env.production.local \
             --env-file=/Users/paidaxin/lynca-listing-copilot/.env.local
```

Env file order matters: production first, local second. Both define
`VERCEL_AUTOMATION_BYPASS_SECRET` and the production copy holds an empty string
that clobbers the real value if loaded last. `METAVERSE_USERNAME` and
`METAVERSE_PASSWORD` come from the production file.

Any node process talking to a `*.vercel.app` host needs `--use-env-proxy`; this
machine's DNS resolves those hosts wrongly and node's fetch does not read the
environment proxy on its own. `listing.lyncafei.team` is unaffected.

**Confirm network and filesystem access before starting.** Tasks dispatched
through the Claude Code Codex plugin ran sandboxed to `/Users/paidaxin/freqtrade`
with networking disabled — every `curl` returned `000` and writes outside that
root were denied, so nothing could run. If either fails, report it immediately
rather than working around it.

## Progress

```bash
bash scripts/night-status.sh
```

## What a finished campaign looks like

`docs/recoverable-loss-results.md`: one section per bucket with the root cause
named, the fix, the live verdict, and the token count recovered. Plus the
cumulative reviewed-200 number.

The honest failure mode is finding that a bucket has no single cause and is
twenty small ones. If that happens, say so after the third card rather than
grinding through all of them — that finding is worth more than a partial fix,
because it means the remaining loss is not cheap after all and the effort
belongs somewhere else.
