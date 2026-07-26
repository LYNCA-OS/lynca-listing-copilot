# Overnight task: price every component of the recognition pipeline

Written 2026-07-26 for one long unattended run. This is a single task, not a
list of chores. It takes most of a night and the result is a table nobody has
ever been able to produce.

## Why this is worth a night

The pipeline has roughly ten components that can be switched off with an
environment variable. Every one of them is on because someone once believed it
helped. **Not one has ever been measured against a control.**

Today one of them was measured by accident. `completeEvidence` — a second pass
that re-runs retrieval and focused re-reads to fill unresolved fields — turned
out to be the largest single segment of a recognition:

```
evidence_completion   29.4s     ← larger than the vision model call
provider (GPT vision) 20.9s
vector_embedding       3.8s
catalog_retrieval      1.0s
renderer               0.01s
```

The first round of an A/B scored **higher with it switched off** (0.8325
against 0.7915). One round proves nothing, and that run is still going. But it
raises the question this task exists to answer for every component at once:

> Which parts of this pipeline earn what they cost?

Latency is currently the worst dimension against the goal — "as fast, as
accurate, as stable as possible". A lister waits ~54 seconds for a title they
could type in 25. Every component that turns out to be dead weight is latency
removed for free, and every component that proves load-bearing is one we stop
re-litigating. There is no cheaper accuracy-and-speed work available, and it is
pure grinding: the protocol is fixed, the harness returns a verdict, and no
judgement is needed at any step.

## The deliverable

One table, written to `docs/component-ablation-results.md`, one row per
component:

| component | flag | accuracy delta | verdict | latency delta | recommendation |
|---|---|---|---|---|---|

plus the raw `artifacts/smoke/paired-eval/<label>.json` for each. A component
whose removal is NOT_PROVEN on accuracy but saves real time is the prize: that
is free speed. Say so where it happens.

## Components to price

Each is one A/B. Work down the list in order — the ones at the top are the
biggest time sinks and the most likely to be dead weight.

| # | flag | set to | what it turns off |
|---|---|---|---|
| 1 | `ENABLE_EVIDENCE_COMPLETION` | `false` | second-pass retrieval and focused re-reads (**already running**, finish it) |
| 2 | `DISABLE_CANDIDATE_PROMPT_INJECTION` | `true` | injecting retrieved candidates into the provider prompt |
| 3 | `ENABLE_POST_OBSERVATION_RETRIEVAL_DEADLINE` | `false` | post-observation retrieval budget (`post_observation_*` segments are ~11s combined) |
| 4 | `ENABLE_VECTOR_ASSIST_DEFAULT` | `false` | visual vector retrieval as an assist lane |
| 5 | `ENABLE_CATALOG_ASSIST_DEFAULT` | `false` | catalog retrieval as an assist lane |
| 6 | `ENABLE_RETRIEVAL_APPLICATION` | `false` | applying retrieved candidates to resolved fields |
| 7 | `ENABLE_FAST_INITIAL_PROVIDER_PROMPT` | `false` | the compact first prompt |
| 8 | `ENABLE_VECTOR_LAZY_MODE` | `false` | deferring vector work |
| 9 | `ENABLE_CATALOG_LOOKUP_CACHE` | `false` | catalog lookup caching |
| 10 | `ENABLE_LISTING_FAST_PATH` | `false` | the fast render path |

Numbers 2, 5 and 6 are the interesting ones beyond latency: candidate injection
has never had a control arm at all. An earlier analysis claimed cards with
injected candidates scored 0.8041 against 0.6818 without — worthless, because
the "without" group was simply cards where retrieval found nothing, a harder
population rather than a control.

## Protocol — follow exactly, it is the part that is easy to get wrong

### One at a time

Two paired evals contend for the same provider capacity and pollute both. Check
before starting:

```bash
ps aux | grep "[r]un-paired-eval"
```

If anything is running, wait. Do not parallelise to save wall-clock; a
contaminated result is worse than no result and there is a whole night.

### Build the two arms

Same commit, differing only in the one variable:

```bash
cd /Users/paidaxin/Documents/Lynca/lynca-catalog-vocab
npx vercel deploy --yes -e <FLAG>=<control-value>   # arm A
npx vercel deploy --yes -e <FLAG>=<ablated-value>   # arm B
```

Deploy them **sequentially**. Deploying in parallel makes the two URLs
indistinguishable in the output, and there is no endpoint that echoes the flag
back.

### Verify which arm is which — empirically

This is not optional and not bookkeeping. Run one card through each arm and
read the stage timings back from the job:

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

then read `jobs[0].timing.response_timing` from
`/api/v4/listing-job-status?job_id=<the job id>` on
`https://listing.lyncafei.team` and confirm the ablated arm's corresponding
segment really went to zero (or that its total dropped as expected).

Today the evidence-completion arms were identified this way:
`evidence_completion_ms` read 27,064 on one and 0 on the other. Mislabelling the
arms inverts the conclusion, and a component ablation is exactly the setting
where that mistake is invisible.

If a flag has no obvious timing signature, use `provider_prompt_chars` or
`total_ms`, and if nothing distinguishes them, **say so and skip that component**
rather than guessing.

### Run it

```bash
node --use-env-proxy <env files> scripts/run-paired-eval.mjs \
  --label ablate-<flag-in-kebab> --rounds 6 \
  --baseline-url <control arm> --candidate-url <ablated arm> \
  --dataset artifacts/smoke/cold20.json \
  --sealed-labels artifacts/smoke/cold20-labels.jsonl
```

The control arm is always **baseline**, the ablated arm always **candidate**, so
a positive delta always means "removing this helped".

`run-paired-eval.mjs` interleaves the arms and stops early on a decisive
verdict. Do not work around the interleaving. Measuring the arms hours apart
today inflated a baseline's spread from sd=0.0084 to sd=0.0456 and returned
NOT_PROVEN for a change actually worth +0.0231.

### Record the latency too

Half the value is here. For each arm take the median `total_ms` and the median
of the segment the flag governs, from the probe job in the verification step.
An ablation that is NOT_PROVEN on accuracy but removes 20 seconds is a
recommendation to remove it.

## Rules that override everything

1. **Never deploy to production.** Preview deployments only. However good a
   result looks, flipping a production flag overnight is a morning decision.
2. **No database writes.** The Panini cohort ingest (1.58M rows) is out of
   scope. Today the database went down for ~40 minutes when sessions idle
   inside open transactions consumed the cluster's 60 connections and starved
   GoTrue's fixed pool of 10, so every login returned 503.
3. **NOT_PROVEN is a result.** Report it and move to the next component. Do not
   re-run hoping for a better number; that is how a noise floor gets mistaken
   for a finding.
4. **If an arm fails to log in, stop that component and move on.** A run that
   dies at round 1 wastes the batch. Verify login on both arms before starting.

## Environment

```
repo    /Users/paidaxin/Documents/Lynca/lynca-catalog-vocab   (branch feat/catalog-field-vocabulary)
env     node --env-file=/Users/paidaxin/lynca-listing-copilot/.env.production.local \
             --env-file=/Users/paidaxin/lynca-listing-copilot/.env.local
```

Env file **order matters**: production first, local second. Both define
`VERCEL_AUTOMATION_BYPASS_SECRET` and the production copy holds an empty string
that clobbers the real value if loaded last. `METAVERSE_USERNAME` /
`METAVERSE_PASSWORD` come from the production file.

Any node process talking to a `*.vercel.app` host needs `--use-env-proxy`: this
machine's DNS resolves those hosts to a wrong address and node's fetch does not
read the environment proxy on its own. `listing.lyncafei.team` is unaffected.

## If the queue empties

Unlikely — ten components at roughly forty minutes each fills a night. If it
does, these are offline, deterministic and need no model calls:

- **The 14 cards missing the denominator entirely.** Of 41 benchmark cards
  whose reviewed title carries a serial and ours does not, 27 had the
  denominator right and were missing only the numerator, which commit `78cf4d8`
  addresses. The other 14 have no denominator at all and nobody has looked at
  why. Determine from `artifacts/smoke/paired-eval/vocab17-candidate-r*.json`
  whether the pipeline holds the print run anywhere or never read it — the
  split decides whether this is a rendering problem or a reading problem.
- **The 110 missing `structural` tokens**, the largest missing class in the
  lister-facing eval. Same method: held-but-not-printed, or never resolved.
- **A guard against literal placeholders in titles.** One benchmark title reads
  `2026 Topps Chrome Lionel Messi (none) Shadow Etch Black Refractor`.

Prove any renderer change with
`node scripts/replay-render-from-eval.mjs --input <report>` over the three
benchmark reports. That replay is deterministic and costs no model calls.

## What a finished night looks like

`docs/component-ablation-results.md` with a row per component priced in both
accuracy and seconds, and an honest count of how many were NOT_PROVEN. If most
of them are NOT_PROVEN on accuracy while costing real time, that is the finding
— it means the pipeline can be made dramatically faster at no measured cost,
and that is the single most valuable thing this project could learn tonight.
