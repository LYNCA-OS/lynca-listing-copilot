# Overnight task: price every component of the recognition pipeline

Written 2026-07-26. One long task, not a list of chores. It takes most of a
night and produces a table nobody has been able to produce before.

## Why this is worth a night — and the result that proves it

The pipeline has ten components that can be switched off with an environment
variable. Every one is on because someone once believed it helped. **None had
ever been measured against a control.**

Tonight the first one was. `completeEvidence` is a second pass that re-runs
retrieval and focused re-reads to fill unresolved fields, and it is the largest
single segment of a recognition — larger than the vision model call itself:

```
evidence_completion   29.4s
provider (GPT vision) 20.9s
vector_embedding       3.8s
catalog_retrieval      1.0s
renderer               0.01s
```

Paired A/B against a control, arms interleaved, decisive at round three:

```
baseline  (on)   median 0.7910   mean 0.7880   sd 0.0057
candidate (off)  median 0.8325   mean 0.8331   sd 0.0016
delta +0.0415, threshold 0.0068, IMPROVED, 3 of 3 rounds
```

**Switching it off makes the pipeline 4.15 points more accurate and cuts
end-to-end latency from 53.8s to 28.0s.** It also makes it three times more
consistent — the arm without it has a third of the spread.

Twenty-nine seconds were being spent to make correct answers worse. Nine
components have never been checked. That is what this task is for, and after
this result the prior should be that more of them are dead weight.

There is a pattern behind it worth carrying into the remaining components. Two
bugs fixed earlier today — evidence absence treated as evidence against, and a
three-state serial verification collapsed into two — were both the pipeline
**doubting itself into a worse answer**. `completeEvidence` is the most
expensive instance of the same habit. When a component's ablation improves
accuracy, that is the mechanism to look for.

## The deliverable

`docs/component-ablation-results.md`, one row per component:

| component | flag | accuracy delta | verdict | latency delta | recommendation |
|---|---|---|---|---|---|

Plus the raw `artifacts/smoke/paired-eval/<label>.json` for each. The prize row
is a component whose removal is NOT_PROVEN on accuracy but saves real seconds —
that is free speed. Say so explicitly where it happens.

## Components to price

| # | flag | set to | what it turns off | status |
|---|---|---|---|---|
| — | `ENABLE_EVIDENCE_COMPLETION` | `false` | second-pass retrieval and focused re-reads | **done: IMPROVED +0.0415, −25.8s** |
| 1 | `ENABLE_POST_OBSERVATION_RETRIEVAL_DEADLINE` | `false` | post-observation retrieval budget (~11s across `post_observation_*` segments) | |
| 2 | `DISABLE_CANDIDATE_PROMPT_INJECTION` | `true` | injecting retrieved candidates into the provider prompt | |
| 3 | `ENABLE_RETRIEVAL_APPLICATION` | `false` | applying retrieved candidates to resolved fields | |
| 4 | `ENABLE_VECTOR_ASSIST_DEFAULT` | `false` | visual vector retrieval as an assist lane | |
| 5 | `ENABLE_CATALOG_ASSIST_DEFAULT` | `false` | catalog retrieval as an assist lane | |
| 6 | `ENABLE_FAST_INITIAL_PROVIDER_PROMPT` | `false` | the compact first prompt | |
| 7 | `ENABLE_VECTOR_LAZY_MODE` | `false` | deferring vector work | |
| 8 | `ENABLE_CATALOG_LOOKUP_CACHE` | `false` | catalog lookup caching | |
| 9 | `ENABLE_LISTING_FAST_PATH` | `false` | the fast render path | |

Number 1 leads because it is the same shape as the component that just failed:
a timed budget spent doing more work after an answer already exists.

Numbers 2, 3 and 5 matter beyond latency. Candidate prompt injection has never
had a control arm at all — an earlier analysis claimed cards with injected
candidates scored 0.8041 against 0.6818 without, which is worthless because the
"without" group was simply cards where retrieval found nothing, a harder
population rather than a control.

## Protocol — this is the part that is easy to get wrong

### One at a time

Two paired evals contend for the same provider capacity and pollute both arms:

```bash
ps aux | grep "[r]un-paired-eval"
```

If anything is running, wait. Do not parallelise to save wall-clock. A
contaminated result is worse than no result, and there is a whole night.

### Build the two arms

Same commit, differing only in the one variable:

```bash
cd /Users/paidaxin/Documents/Lynca/lynca-catalog-vocab
npx vercel deploy --yes -e <FLAG>=<control-value>    # arm A
npx vercel deploy --yes -e <FLAG>=<ablated-value>    # arm B
```

Deploy them **sequentially**. Deploying in parallel makes the two URLs
indistinguishable in the output, and no endpoint echoes the flag back.

### Verify which arm is which — empirically, not from bookkeeping

Not optional. Run one card through each arm:

```bash
node --use-env-proxy <env files> scripts/v4-ebay-smoke.mjs \
  --base-url <arm-url> --model gpt-5-mini --queue --speculative \
  --use-preingestion --ultra-image-detail high \
  --concurrency 1 --preparation-concurrency 1 --submission-concurrency 1 \
  --disable-identity-cache --sample-mode UNSPECIFIED \
  --dataset artifacts/smoke/cold20.json \
  --sealed-labels artifacts/smoke/cold20-labels.jsonl \
  --limit 1 --out /tmp/probe-<arm>.json
```

Then read `jobs[0].timing.response_timing` from
`https://listing.lyncafei.team/api/v4/listing-job-status?job_id=<job id>` and
confirm the ablated arm's segment really went to zero, or that its `total_ms`
dropped as expected.

The evidence-completion arms were identified exactly this way:
`evidence_completion_ms` read 27,064 on one and 0 on the other. Mislabelling the
arms inverts the conclusion, and component ablation is precisely where that
mistake is invisible.

If a flag has no timing signature, try `provider_prompt_chars` or `total_ms`.
If nothing distinguishes the arms, **say so and skip that component** rather
than guessing.

### Run it

```bash
node --use-env-proxy <env files> scripts/run-paired-eval.mjs \
  --label ablate-<flag-in-kebab> --rounds 6 \
  --baseline-url <control arm> --candidate-url <ablated arm> \
  --dataset artifacts/smoke/cold20.json \
  --sealed-labels artifacts/smoke/cold20-labels.jsonl
```

Control is always **baseline**, ablated is always **candidate**, so a positive
delta always reads "removing this helped".

`run-paired-eval.mjs` interleaves the arms and stops early on a decisive
verdict. Do not work around the interleaving. Measuring arms hours apart today
inflated a baseline's spread from sd=0.0084 to sd=0.0456 and returned
NOT_PROVEN for a change actually worth +0.0231.

### Record the latency too

Half the value. For each arm take median `total_ms` and the median of the
segment the flag governs, from the probe job above. An ablation that is
NOT_PROVEN on accuracy but removes twenty seconds is a recommendation to remove
it.

## Rules that override everything

1. **Never deploy to production.** Preview deployments only. However good a
   result looks — and one already looks very good — flipping a production flag
   overnight is a morning decision.
2. **No database writes.** The Panini cohort ingest (1.58M rows) is out of
   scope. Today the database went down for ~40 minutes when sessions idle
   inside open transactions consumed the cluster's 60 connections and starved
   GoTrue's fixed pool of 10, so every login returned 503.
3. **NOT_PROVEN is a result.** Report it and move on. Do not re-run hoping for
   a better number; that is how a noise floor becomes a finding.
4. **Verify login on both arms before starting.** A run that dies at round one
   wastes the batch.
5. **Measure before fixing.** Four plausible fixes were abandoned today after
   measurement contradicted them: `card_number` backfill (1 recoverable row in
   14,056), `team` backfill (the source column is polluted with player and
   character names), a price-based catalog gate (no discriminative power at
   all), and PSA population data (no such API exists). If a measurement does
   not show the problem you expected, report that and move on rather than
   building the fix anyway.

## Environment

```
repo    /Users/paidaxin/Documents/Lynca/lynca-catalog-vocab   (branch feat/catalog-field-vocabulary)
env     node --env-file=/Users/paidaxin/lynca-listing-copilot/.env.production.local \
             --env-file=/Users/paidaxin/lynca-listing-copilot/.env.local
```

Env file **order matters**: production first, local second. Both define
`VERCEL_AUTOMATION_BYPASS_SECRET` and the production copy holds an empty string
that clobbers the real value if loaded last. `METAVERSE_USERNAME` and
`METAVERSE_PASSWORD` come from the production file.

Any node process talking to a `*.vercel.app` host needs `--use-env-proxy`: this
machine's DNS resolves those hosts to a wrong address and node's fetch does not
read the environment proxy on its own. `listing.lyncafei.team` is unaffected.

**Network and filesystem access are required.** Tasks dispatched through the
Claude Code Codex plugin earlier today ran in a sandbox rooted at
`/Users/paidaxin/freqtrade` with networking disabled — writes outside that root
were denied and every `curl` returned `000`, so nothing could run. Confirm you
can reach `https://listing.lyncafei.team` and write inside the repo above
before starting; if either fails, report that immediately rather than working
around it.

## Checking progress

```bash
bash scripts/night-status.sh
```

Reports what is running and for how long, ablation verdicts so far, and what
has actually landed on disk. It trusts live processes and commits, not job
receipts.

## If the queue empties

Ten components at roughly forty minutes each should fill the night. If it does
empty, these are offline, deterministic, and need no model calls:

- **Confirm the evidence-completion result on a larger set.** The verdict came
  from cold20, 20 cards over 3 rounds. `artifacts/smoke/reviewed-200.json` with
  `reviewed-200-labels.jsonl` is the same protocol at ten times the size. This
  is the one thing that would most strengthen the morning's decision.
- **The 14 cards missing the denominator entirely.** Of 41 benchmark cards
  whose reviewed title carries a serial and ours does not, 27 had the
  denominator right and were missing only the numerator, which commit `78cf4d8`
  addresses. The other 14 have no denominator at all and nobody has looked at
  why. Determine from `artifacts/smoke/paired-eval/vocab17-candidate-r*.json`
  whether the pipeline holds the print run anywhere or never read it — the
  split decides whether it is a rendering problem or a reading problem.
- **The 110 missing `structural` tokens**, the largest missing class in the
  lister-facing eval (`scripts/writer-acceptance-eval.mjs`). Same method:
  held-but-not-printed, or never resolved.
- **A guard against literal placeholders in titles.** One benchmark title reads
  `2026 Topps Chrome Lionel Messi (none) Shadow Etch Black Refractor`.

Prove any renderer change with
`node scripts/replay-render-from-eval.mjs --input <report>` over the three
benchmark reports. That replay is deterministic and costs no model calls.

## What a finished night looks like

`docs/component-ablation-results.md` with every component priced in both
accuracy and seconds, and an honest count of how many were NOT_PROVEN. If most
are NOT_PROVEN on accuracy while costing real time, that is the finding: the
pipeline can be made dramatically faster at no measured cost. Given that the
first component measured turned out to cost 29 seconds *and* 4 accuracy points,
that is now the likely outcome rather than the hopeful one.
