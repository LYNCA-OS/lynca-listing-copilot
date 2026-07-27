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
3. **Parallel family.** A first-pass vision read at confidence ≥ 0.78 grounds
   `surface_color` but not `parallel_family`, which can only be grounded by a
   focused crop-and-read that mostly never runs. Same image, same observation,
   `Orange` kept and `Refractor` dropped. Fixed in `2b1b7f4`, **live validation
   in flight**.

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

### 0. Finish validating the parallel-family fix

A paired eval is running (`/tmp/parallel-ab.log`, label `parallel-family`,
production as baseline against preview `hx151ix2k`). Wait for the verdict and
record it. If NOT_PROVEN, say so and leave the commit unvalidated rather than
re-running for a better number.

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
