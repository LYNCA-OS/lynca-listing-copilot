# Brief: the road to naming a card on the day it exists

For Codex. This is the whole queue, not a single task. Read
`docs/ambition.md` and `docs/brief-output-contract-and-world-knowledge.md`
first; this one assumes both.

---

## 0. How this brief is to be executed

**The result is required. The route is negotiable.**

If a path in here turns out to be wrong, that is useful information and it does
not end the task. Report what you measured, state why the path is dead, and
**propose and take the next route to the same result**. Coming back with "this
approach does not work" and nothing else is not an acceptable outcome.

Three things are always acceptable:

- "I did it, here are the numbers."
- "The primary route failed for this measured reason, so I took route B, here
  are the numbers."
- "All routes I can see fail, here is the evidence for each, and here are the
  two options I would try next with what each would cost."

One thing is not acceptable: stopping at the first obstacle.

And the counterpart: **never manufacture a result.** If a number cannot be
obtained honestly, say so plainly and say what is blocking it. A fabricated
pass is worse than a reported failure — every discipline in section 5 exists
because someone, including me, once believed a number that was not real.

---

## 1. The result required

> A card that exists in the world for the first day, photographed and handed to
> this system, comes back named to the SEM standard — in two or three seconds,
> the way a conversation answers.

Concretely, and each of these is measurable today:

| target | today | measured on |
|---|---|---|
| p50 latency ≤ 3s | **25.5s** | 1,299 sessions |
| unseen-product accuracy ≥ familiar | 0.4939 vs 0.8414 | 17 vs 60 cards |
| the same card never re-identified from scratch | **2,066 repeats, 829 minutes** | 4,349 sessions |
| the system can say "I don't know" | **it cannot** | abstention rate does not exist |
| a field the card states is never dropped | 430 colours lost | 2,090 cards |

---

## 2. What is already built — do not rebuild these

In `lynca-catalog-vocab`, all committed, all tested:

| module | what it does | state |
|---|---|---|
| `lib/listing/catalog/constraint-enumerator.mjs` | world engine run forwards: VALUE / EMPTY / UNKNOWN for team and product | **built, tested, NOT WIRED into the pipeline** |
| `lib/listing/catalog/subject-normalizer.mjs` | merges truncated duplicates, strips foreign tokens, tolerant index lookup | built, tested, wired into the enumerator only |
| `lib/listing/parallel-policy.mjs` → `composeParallel` | `Silver /75` instead of nothing | **built, tested, NOT WIRED** |
| `scripts/harvest-wikidata-athletes.mjs` | career intervals + sport from Wikidata | built, 121 subjects harvested |
| `scripts/build-constraint-model.mjs` | 2.29M cards → 4.8MB of constraints | built |
| `docs/output-contract-field-census.md` | every output field counted against production | done |

**The single most valuable fact in this table is the phrase "NOT WIRED".** Two
of the three highest-leverage pieces built this week run in no production path.
That is the eighth instance of the pattern named in `ambition.md`: a feature
exists and never runs.

---

## 3. The work queue

Ordered by measured value. Each item states the evidence, what done looks like,
and what to do when the primary route fails.

### A. Cache the card, not the photograph

**Evidence.** The identity cache key is `tenant_id + image content sha256`
(`lib/listing/cache/identity-result-cache.mjs`). Two photographs of the same
card — two slabs, two angles, PSA 9 and PSA 10 — produce different hashes and
therefore a full re-recognition.

```
4,349 sessions  ->  2,697 distinct card identities
2,066 repeat recognitions, 1,921 of which called the provider
829 minutes spent re-identifying cards the system already knew
```

That is 38% of all work, and it is also an accuracy problem: two independent
runs of the same card are not guaranteed to agree, and today they do not —
`luka dončić` and `luka donči`, `dan marino` and `dan marino teal dolphins`, are
the same card named two ways in our own data.

**Done looks like.** A second cache layer keyed on card identity —
`year + product + set + subject + card_number + parallel` — with grade, cert
number and image hash deliberately excluded. On a hit, only the slab label is
read. Report: repeat provider calls, minutes spent re-identifying, and p50
latency for a second copy.

**If the primary route fails** (e.g. identity is not stable enough to key on):
fall back to keying on the subset of fields that *are* stable, measured rather
than assumed — start from `year + product + card_number` and report the
collision rate. If that also fails, a perceptual image hash that survives
re-photographing is route C. Do not stop at route A.

### B. Give the provider back its `sport`

**Evidence.** `sport` is requested on every one of 4,695 calls and has been
returned **zero** times. It costs twice: the enumerator cannot answer EMPTY
without it (39 Mickey Mouse and 26 Dark Magician cards counted as *missing* a
team rather than having none), and it cannot separate namesakes — five people
are called Michael Jordan, two NFL players are called Josh Allen, and 16% of
resolved cards come from ambiguous names.

**Done looks like.** `sport` non-empty on the large majority of cards, and the
enumerator's ambiguous-name rate falling. This is likely a one-line prompt or
schema fix; find out why it never returns before writing code.

**If it cannot be made to return:** derive it from the product line, which the
card does state — but measure the mapping's accuracy before trusting it.

### C. Wire what is already built

`constraint-enumerator.mjs` and `composeParallel` are finished and unused.
Wiring them is the cheapest value left on the table.

- The enumerator resolves **65%** of empty-team cards to VALUE or EMPTY.
- `composeParallel` turns a `parallel` field that is filled 0.8% of the time
  into `Silver /75` wherever colour or print run was read (46% and 55%).

**Done looks like.** Both consulted in the resolver, after observation and
before the title is built. Derived values must be labelled as derived, never
merged silently into observed ones. Paired interleaved A/B, both scoreboards.

### D. The output contract (already assigned)

See the other brief. It is the only item that fixes latency and fabrication
with one change. The census in `docs/output-contract-field-census.md` is step 1,
already done — twelve fields never filled once, six fields carrying the same
print run.

### E. Widen the athlete index

121 subjects carry 624 career intervals and take the resolved rate from 50% to
65%. The harvest is one call per name at ~2s, and the top 200 subjects cover 93%
of the volume, so this is roughly ten minutes of wall time for the remainder.

**Watch for:** name collisions. The conservative rule now refuses to answer a
shared name unless the sport separates the namesakes — which is why item B
unlocks this one.

### F. Populate `catalog_parallels` from our own corpus

The table exists with exactly the right columns — `parallel_family`,
`parallel_exact`, `surface_color`, `expected_serial_denominator` — and holds
**0 rows**. Fill it from our own verified titles, not from manufacturer
checklists: a checklist makes naming wait for someone else to publish, which is
the opposite of naming a card on day one.

### G. Teach the vector index to read the emblem

The product line is never text on a card; it is an emblem, verified by reading
card images at full size. This is the one thing the model genuinely cannot read,
and it is what the vector index should be doing — a few hundred stable brand
marks, not "which of 2.29M cards is this".

**Note the evidence against the obvious alternative:** using visual similarity
for *parallels* regressed 5.4 points and was reverted, because a Chrome card
shines like a Refractor under a phone camera. Emblem classification is a
different problem from finish discrimination. Do not conflate them.

### H. Build abstention

The system cannot currently say "I don't know", so its only options are a right
answer and a confident wrong one. `2021 Panini Contours JALYN DANIELS` —
invented year, invented product, invented player — is what that costs.

The enumerator's three-outcome contract (VALUE / EMPTY / UNKNOWN) is the shape
this should take at the title level: a title that omits what is unknown, and a
system that reports its abstention rate as a first-class metric alongside the
two accuracy scoreboards.

---

## 4. Things to verify — I could not, or did not

1. **Does cutting the output actually cut latency proportionally?** The whole
   diagnosis rests on `latency = output_tokens / 54 tok-per-sec`. One call
   measured 825 tokens in 15.3s. If output drops 80% and latency does not
   follow, the diagnosis is wrong — say so.

2. **Does the enumerator's 65% survive being wired in?** It was measured
   offline against `resolved_fields`. Live, the claim may differ.

3. **Does world knowledge raise fabrication?** Measure it as refutations by the
   constraint model, not as an impression.

4. **The 360 unexplained dropped colours.** Of 430 cards that lost a colour the
   card stated, 25 are explained (a `parallel_exact` contradicting the
   observation) and ~45 by vocabulary. The rest are not. Ruled out already —
   do not re-run these: the 80-character cap (66.7 vs 65.9 characters, no
   difference), writer rewriting (7 of 2,090), `field_states` (null in both
   groups), `v4_field_evidence` (zero surface_color rows in either group).
   The renderer does build the module correctly — rendering a failing card
   yields `print_finish: "Purple Hyper"` — but with `status: REVIEW` and an
   empty evidence summary. That is the thread to pull.

5. **Why does the pipeline emit a truncated duplicate subject?** Titles read
   `Pelé / Pel`, `Dončić / Donči`, `Modrić / Modri`. One person is carried as
   two, the second being the first with its final non-ASCII character dropped.
   The normalizer in this repo mitigates 12% of it; the cause is upstream.

6. **Why does a colour reach the subject but not `surface_color`?**
   `dan marino teal dolphins` has `surface_color: Green`. The word `teal` went
   into the name instead of the colour field — two fields contradicting each
   other on one card.

7. **The paired-20 asset anomaly.** 20 sessions covered 11 distinct assets where
   10 pairs should give 10. Confirm before trusting the next run.

---

## 5. Boundaries — not negotiable, each one paid for

1. **Paired, interleaved evaluation.** Never one arm today and the other
   tomorrow. The same change read NOT_PROVEN at sd=0.0456 across a gap and
   IMPROVED at +0.0231 interleaved at sd=0.0084.
2. **Absent coverage is never evidence against.** Unharvested is `UNKNOWN`,
   never `EMPTY`, never refuted. This error has caused three reverted changes —
   the third was mine, this week: an undated Wikidata membership covering every
   year put "arizona cardinals" on a basketball card.
3. **`EMPTY` and `UNKNOWN` must never collapse.**
4. **Never invent a proper noun.** `Silver /75` beats a guessed parallel name.
5. **A confident wrong answer is worse than a gap.** We gave up five points of
   coverage to stop answering ambiguous names, deliberately.
6. **Measure before fixing.** Five changes in two days were reverted or withheld
   after measurement.
7. **Every claim is a count.** "This gate never fires" is `0/60`.
8. **Two scoreboards, always together**, plus latency. Improving familiar while
   unseen stays flat is not progress toward the ambition.
9. **Production safety.** 80-character titles. Pace bulk database work — an
   unpaced export took production down. Env changes need a redeploy; encrypted
   values read back empty and cannot be verified that way.

---

## 6. What would falsify the whole plan

- If unseen-product accuracy does not move once the catalog and the world engine
  contain those products and people, then completeness is not the bottleneck and
  the reading layer is.
- If cutting the output does not cut latency, the latency diagnosis is wrong.
- If the identity cache cannot be keyed on card identity because identity is not
  stable across two photographs, then the naming layer is not deterministic
  enough to cache, and that is a deeper problem than caching.

Report any of these plainly if you find them. Finding the plan wrong, with
evidence, is a result — and it is the one thing that is worth more than
finishing the queue.
