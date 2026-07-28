# Task brief: cut the output contract, and let the model use what it knows

For Cola X. Two tasks, in this order. Everything here is measured; where a
number appears, it is a count taken from production, not an estimate.

Read `docs/ambition.md` first. This brief assumes it.

---

## 1. What we are building, and the thought behind it

> The system should be the best card person in the world, working as an
> experienced lister. It looks once, knows what the card should be called, and
> hands that name to other listers.

That sentence is the whole specification. Three properties fall out of it, and
each one is currently violated:

| an expert lister | our system today |
|---|---|
| looks once, answers in seconds | **25.5s** median |
| uses what they see **and what they know** | prompt says *"Do not guess"*; **117** prohibitions, **0** invitations to use knowledge |
| says the name | emits **825** output tokens of form, **69.3%** of it `null`/`false`/`[]` |

### The architectural finding that shapes both tasks

A card carries, as readable text: year, subject, set name, card number, serial
number, and (visually) its colour. It does **not** carry, as text: the product
line — that is an emblem, verified by reading card images at full size — or the
parallel's proper name.

So a name is assembled from three sources, and knowing which is which is the
whole game:

1. **Read it** — what the image plainly states. This is the model's job.
2. **Derive it** — what the constraints determine. Kobe played for one team, so
   the team is not read or guessed; it is *determined*. This is the world
   engine's job.
3. **Know it** — ordinary world knowledge. That Kobe played for the Lakers is
   not a guess and not a catalog lookup; it is a fact any card person holds.

We built (1), built (2) and never wired it forwards, and **actively forbade
(3)**. Task A fixes the cost of (1). Task B unlocks (3).

**A manufacturer checklist is not on this list, deliberately.** A per-card index
makes naming wait for someone else to publish, which is the opposite of naming a
card on the day it exists. What we need is a *vocabulary* (a few hundred entries,
ages slowly), not a *card index* (millions of rows, ages daily).

---

## 2. Where we are now

### Committed and on `develop` (this repo)

| commit | what |
|---|---|
| `0aa353e5` | world engine runs forwards: `enumerateTeam` / `enumerateProduct`, plus `player_team_years` and `set_product_years`; dual-player parsing bug fixed |
| `6ed03eac` | stopped discarding observed colour (contradiction rule + colour vocabulary, in both the policy and the prompt) |
| `7ef98e28` | `composeParallel`: emits `Silver /75` instead of nothing |
| `edc836e1` | telemetry export: Codex's verification contract + pacing/retry/preflight |

### Production state

- The recognition queue was dead ~19h (`V4_QUEUE_PUMP_DISABLED` left set after
  the 2026-07-27 disk incident). Fixed and verified: queue drains, 0 open jobs.
- Database is on `pro`, 1355 MB, not under pressure. Preview jobs, phoenix
  orphans and a capacity-lease leak were removed.
- Telemetry is exported and verified locally: 172,492 rows, per-file sha256, at
  `~/lynca-telemetry/export-verification.json`.

### The measurements you will be judged against

All from `v4_recognition_sessions`, 4,527 sessions with a final title:

```
latency        p50 25.5s   p90 55.4s   p99 83.8s   under 3s: 21 (1.6%)
               recognition_core p50 23.9s  -- 94% of latency is the provider call
tokens         input 6,953 avg (7,475 observed, 2 images)   output 825
               825 tokens / 54 tok-per-sec = 15.3s.  Latency IS output length.
emptiness      69.3% of output field slots are null / false / []
context        94% of calls (1,227/1,299) produce ZERO anchor candidates
fields         team null 2,655 (of which 2,594 have a known subject)
               card_number null 2,306    parallel filled 39 (0.9%)
               surface_color read 2,090  serial_denominator read 2,502
world engine   89.0% of covered players have exactly one team
               62% of our highest-volume subjects resolve to VALUE or EMPTY
               38% UNKNOWN -- Kobe, Jordan, Messi, Haaland: basketball/soccer
               coverage gaps, because Panini checklists do not state teams
```

---

## 3. Task A — cut the output contract

**Claim to act on:** latency is output length. 825 tokens at ~54 tokens/sec is
15.3 seconds, and 69.3% of those tokens say "no", "none", "false".

**And it is not only speed.** Forcing the model to fill 50 fields it cannot see
is an invitation to invent. `2021 Panini Contours JALYN DANIELS` — invented year,
invented product, invented player — is what that pressure produces. Asking for
less should reduce fabrication as well as latency. Measure both.

### Steps

1. **Classify every field in the output schema into exactly one of:**
   - `READ` — only the image can answer it (subject, set name, card number,
     serial number, surface colour, grade, auto/relic/patch as *visible* marks)
   - `DERIVED` — the world engine determines it (team, product line, sport,
     parallel identity)
   - `DROP` — nothing consumes it, or it is always the default

   Do not guess which is which: for each field, `grep` for its consumers and
   count how often it is non-empty in production. A field that is null 100% of
   the time and read by nobody is `DROP`. Put the counts in the PR.

2. **Emit only `READ` fields.** Target ≤ 150 output tokens. `DERIVED` fields are
   filled after the call by `lib/listing/catalog/constraint-enumerator.mjs`.

3. **Verify with deterministic replay first** — `scripts/replay-render-from-eval.mjs`.
   It costs nothing and catches the obvious failure: a title that loses a field
   because the renderer expected a key that no longer arrives. Do not proceed to
   a live run until replay is clean.

4. **Then a paired interleaved A/B** (`scripts/run-paired-eval.mjs`). Arms must
   alternate. This is not optional — see Boundaries.

5. **Report three numbers, always together:** `policy_fair_token_recall` on
   familiar products, the same on unseen products, and p50 latency. A change
   that improves latency and costs unseen-product accuracy is not a win.

---

## 4. Task B — let the model use what it knows

**The defect, stated precisely:** the prompt does not distinguish *card-surface
marks* from *world knowledge*, and forbids inference on both.

- Forbidding inference on **surface marks** is correct. An RC logo, an SSP
  marker, a serial number are printed or they are not. Inferring them from
  "market memory" is exactly the fabrication we fear. **Keep every one of these
  prohibitions.**
- Forbidding inference on **world knowledge** is wrong. The card does not print
  the team. That Kobe Bryant played for the Lakers is a fact, and refusing to
  use it leaves `team` null on 2,594 cards whose subject we successfully read.

### Steps

1. In `lib/listing/pipeline/provider-prompt.mjs` and
   `prompts/listing-intelligence-v1.md`, separate the two categories explicitly.
   Give the model an identity — an experienced card lister — and permission to
   use ordinary knowledge for `DERIVED` fields, while keeping every surface-mark
   prohibition verbatim.

2. **Require the model to mark its basis.** Every `DERIVED` value it supplies
   must carry whether it was `OBSERVED` or `KNOWN`. A value it merely knows is
   still useful and still checkable; a value it cannot distinguish is neither.

3. **Gate `KNOWN` values through the world engine.** `refute()` in
   `scripts/build-constraint-model.mjs` already exists for this. Where the engine
   has coverage it decides; where it does not, a `KNOWN` value stands and is
   labelled as such. Model proposes, engine refutes — better than either alone.

4. **Measure the gap this closes.** Today: 38% of high-volume subjects are
   `UNKNOWN` for team, all basketball and soccer. If the model's knowledge closes
   most of that at zero token cost, harvesting Wikidata becomes optional rather
   than urgent. Test that before building a harvester.

---

## 5. Boundaries — these are not negotiable

Each one was paid for.

1. **Paired, interleaved evaluation.** Never measure one arm today and the other
   tomorrow. The same change read NOT_PROVEN at sd=0.0456 across a time gap, and
   IMPROVED at +0.0231 when interleaved with sd=0.0084. Cross-time comparison is
   5.4x noisier and will lie to you.

2. **Absent coverage is not evidence against.** A manufacturer, player or set we
   have not harvested is `UNKNOWN`, never `EMPTY` and never refuted. This exact
   error caused two reverted changes.

3. **`EMPTY` and `UNKNOWN` must never collapse.** `EMPTY` = the field cannot
   apply (a Mickey Mouse card has no team — and 38 of them were being counted as
   a missing team). `UNKNOWN` = our coverage cannot say, carries the candidate
   set, and is never answered with a guess.

4. **Never invent a proper noun.** If the manufacturer's name for a parallel is
   unknown, emit the descriptive form (`Silver /75`). Correct and sellable beats
   authoritative and wrong.

5. **Measure before fixing.** Five changes in two days were reverted or withheld
   after measurement: two were inert because the gate they patched never fires,
   two regressed by 5.4 and 11.75 points, one produced 16 false positives out of
   17. Write the measurement first.

6. **Every claim is a count.** "This gate never fires" is `0/60`, not an argument
   from reading code.

7. **Completeness before authority.** Giving an incomplete index more power
   amplifies its errors. Consulting the catalog before observation regressed
   11.75 points because the index did not contain the product.

8. **Production safety.** The title cap is 80 characters (CSM contract). Do not
   run bulk reads or writes against the production database without pacing — an
   unpaced export took it down on 2026-07-28. Env changes need a redeploy to take
   effect; `vercel env pull` returns encrypted values as empty strings and cannot
   be used to verify one.

9. **Two scoreboards, always reported together.** Familiar-product accuracy and
   unseen-product accuracy. The 35-point gap between them *is* the ambition; a
   change that lifts the first and leaves the second flat is not progress.

---

## 6. What done looks like

Task A is done when:

- output tokens ≤ 150 (from 825), and p50 latency ≤ 5s (from 25.5s)
- deterministic replay shows no field lost from rendered titles
- a paired interleaved A/B shows unseen-product accuracy **not** regressed
- the PR states, per dropped field, how many production rows ever carried a
  non-empty value for it

Task B is done when:

- surface-mark prohibitions are unchanged and provably so (diff them)
- every `DERIVED` value carries `OBSERVED` or `KNOWN`
- team `UNKNOWN` on our highest-volume subjects falls from 38% toward single
  digits, with no rise in refuted values
- a paired interleaved A/B shows unseen-product accuracy improved or flat

### What would falsify the plan

- If cutting the output does not cut latency roughly proportionally, then
  latency is not output length and the whole diagnosis is wrong. Say so.
- If letting the model use world knowledge raises fabrication (measured as
  refutations by the constraint model, not impressions), the separation between
  surface marks and world knowledge is not holding — report it rather than
  tuning the prompt until the number moves.
