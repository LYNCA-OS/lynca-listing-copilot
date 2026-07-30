# Overnight brief, 2026-07-29

For Codex. Three parts: what changed while you were working, what to verify,
and what to think about. The third part matters most — I have taken a first pass
at each question and want yours, not agreement.

Governance is unchanged from `docs/brief-the-road-to-day-one-naming.md` §0: **the
result is required, the route is negotiable, and a dead path is reported with
its evidence and followed by the next route.** Its counterpart applies with
equal force tonight — several sections below are asking you to look for evidence
that *I am wrong*. If you find it, that is the deliverable.

---

## Part 1 — What changed today

Two PRs, both open, neither merged.

**[#151] Two latency cuts**, confined to cold files, deliberately avoiding
`native-recognition-core.mjs` (three commits from you today).

- Vector retrieval **disabled by default**. 3,659 calls, 3,556ms average,
  **92.7% returned zero candidates**, searching an index of 587 rows last
  written 2026-07-06. The 266 calls that did return candidates are not rescuing
  hard cards: they read a card number 58.3% of the time against 33.7%, and
  retrieval keys on the card number, so that is the entry condition rather than
  the payoff. On team and parallel the groups are indistinguishable.
- OCR rendezvous wait **capped at 2s** (was 22s default, 24,539ms observed max).
  A ceiling and not a switch, because the rendezvous does change a field on
  4.6% of sessions. 2s keeps everything up to the observed p90.

**[#152] World engine, scan, corrections.** Offline only, no production path
touched. `constraint-enumerator` (team 65%, product 30%), `subject-normalizer`,
`derive-fields` as a single wiring point, `second-look-planner`,
`build-parallel-ladder`.

**Three claims corrected, each still being reasoned from:**

| claim | status |
|---|---|
| `ambition.md`: 60.4% of set names uniquely identify a product-year | **false on production.** Measured on the harvest, never transferred. 14%, or 30% with the product-name reading |
| the output brief: 69.3% of output is waste | **falsified by your Task A.** Marked SUPERSEDED |
| "~3s of fixed overhead" | **wrong, and I made it.** A regression intercept |
| "10,841ms uninstrumented" | **also wrong, also mine. RETRACTED 2026-07-30** — see below |

**Infrastructure fact you will need:** the GCP billing account is **closed**
(`open: False`). Cloud Run cannot be modified, OCR workers return
`ocr_worker_unavailable`, and the vector index is frozen at 587 rows. Nothing is
accruing cost; several things are quietly not running.

---

## Part 2 — Verify

Each is falsifiable and each has a number attached. Report the number, not a
verdict.

1. **Do the two cuts actually recover the time?** Predicted: 3.5s from vector,
   up to 22s of tail from the OCR cap, no accuracy change on either scoreboard.
   Paired interleaved, both scoreboards, as always. If accuracy moves at all,
   my "the 266 are not rescuing hard cards" reasoning is wrong and I want to
   know.

2. ~~**Instrument the 10.8 seconds.**~~ **WITHDRAWN. The premise was false.**
   I computed `recognition_core − provider − vector` and called the remainder
   uninstrumented. On 3,295 rows carrying all three spans, **29.5% have a
   negative residual** — provider plus vector exceeds core — so the spans
   overlap or use different clocks and the residual is not interpretable at all.
   Per-row interval union gives **p50 0.111s / p95 0.629s** genuinely uncovered.
   There is no hidden budget. The time is in the instrumented post-provider
   stretch (p50 14.898s), which is a different and more tractable problem.

3. **Attribute the unseen failure by SEM module.** 0.4056 against a target of
   0.85 is a 44-point gap, and nobody has established whether it is lost in
   *reading* or in *assembly*. I cannot do this: the cohort-to-session mapping
   lives in your gate artifacts. Splitting the loss per module is the
   prerequisite for any 85% plan.

4. **The paired-20 asset anomaly.** 20 sessions covered 11 distinct assets where
   10 pairs should give 10. Confirm before trusting the next run.

5. **Is `card_number` recoverable at all?** It is missing on 54% of cards, it is
   the single largest field gap, and it drives the entire economics of the
   two-stage route. 92% of the cards missing one had a back image in hand — so
   the picture was there and the number was not read.

---

## Part 3 — Think

Here is where I want your mind rather than your executor. My first pass on each
is included so you can attack it.

### 3.1 Why does identical input produce different output?

The finding that outranks everything else today:

```
same asset, re-recognised within one hour, identical deployed code
  identity agreed   50.3%
  title agreed      12.4%
prompts of identical size
  identity agreed   53.5%
```

`temperature: 0` is already set. Deploy drift is excluded by the one-hour
window. Prompt drift is real but secondary — it explains the gap between 53.5%
and 37.6%, not the 46.5% that remains when the prompt is the same size.

**My first pass:** temperature 0 is not determinism on a mixture-of-experts
model — routing and batch composition vary — but 46.5% feels too large for that
alone. Candidates I could not separate: image ordering between front and back;
signed-URL differences changing what the model actually receives; a race in how
OCR patches and provider fields are merged, so the same two sources land in a
different order.

**What I want from you:** run the same asset N times deliberately, holding the
prompt byte-identical, and report the distribution. If it is still ~50%, the
non-determinism is in the model and the only defence is to cache a decision
once made. If it drops sharply, it is ours and it is fixable — and that changes
which of the two we build first.

This is the prerequisite for identity caching, for trusting any paired
evaluation, and for one card having one name in the shop.

### 3.2 Is a single large structured call the right shape at all?

Three measurements sit uneasily together:

- latency is output length, ~11ms per token, input nearly free
- accuracy needs the full field checklist in the request
- the world engine can derive a third of what the checklist asks for

**My first pass:** the current shape asks one expensive model to both *look* and
*fill in a form*, and the form is what costs the time. A different decomposition
would be: the vision call returns a **short natural-language description** of
what is on the card — maybe 60 tokens, sub-second — and a cheap text pass plus
the world engine turns that into fields. Looking and form-filling stop competing
for the same tokens.

**Attack it:** the obvious objection is that free text loses the discipline the
schema enforces and reintroduces exactly the fabrication the schema prevents.
Is that true, or does the schema's discipline actually live in the
*downstream validation* rather than in the output format? If it is downstream,
the format is free to change and this is a large latency win. If the schema
itself is doing the work, this idea is dead and I want to know why.

### 3.3 What can 2–3 seconds actually be built from?

Honest arithmetic from today's numbers: the provider call alone averages
10,885ms. Even if our own 10.8s of uninstrumented overhead went to zero, and the
vector and OCR costs are already cut, the provider call does not fit in three
seconds at current output lengths.

**My first pass** at the only three levers that touch it:

1. fewer output tokens — but Task A showed a request-side cut costs accuracy;
   §3.2 is the version that might not
2. a faster tier for a first answer, with a slower one refining it — the shape
   your targeted assist already has
3. streaming, and stopping when the title is complete rather than when the
   object is

**Attack it:** which of the three survives contact with the accuracy
requirement? And is there a fourth I have not seen? Note that (3) interacts with
the identity-stability question — if the first tokens are stable and the tail is
not, early stopping might improve consistency as a side effect, which would be a
rare case of latency and correctness pulling the same way.

### 3.4 What does 85% on unseen actually require?

I do not have a path to this and will not pretend otherwise. 0.4056 to 0.85 is
not a tuning distance.

**My first pass at bounding it:** the card carries year, subject, set name,
card number, serial and colour as readable text. It does not carry the product
line — that is an emblem — nor the manufacturer's proper name for a new
parallel. On unseen products the world engine cannot supply either, by
definition of unseen. So the ceiling on unseen accuracy is roughly *what the
card states plus what can be inferred from its own structure*, and the open
question is what fraction of the SEM score that ceiling represents.

**What I want:** verification item 3 gives the shape of the loss. If the loss is
mostly in fields the card *does* state, then 85% is a reading problem and
reachable. If it is mostly product line and parallel proper nouns, then 85% on
unseen requires either emblem recognition or accepting descriptive forms in the
score — and that is a product decision, not an engineering one, which is
exactly the kind of thing to surface rather than quietly optimise around.

---

## Boundaries

Unchanged, and all nine still apply — `docs/brief-the-road-to-day-one-naming.md`
§5. The two that today kept earning themselves:

- **Absent coverage is never evidence against.** It bit again this week in a new
  place: an undated Wikidata membership covering every year put "arizona
  cardinals" on a basketball card.
- **Every claim is a count.** Three claims corrected today were all plausible,
  all repeated, and none had been checked against the population they were being
  applied to.
