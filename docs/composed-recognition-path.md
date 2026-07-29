# The composed path

B, C and D were measured as competing routes. They are not competitors. Each is
strongest at a different node, and the reason they looked like alternatives is
that each was tested as a whole pipeline rather than as a stage.

Read as stages, they form a cascade with **falling coverage and rising cost** —
which is the shape you want, because the cheap stages absorb most of the traffic
before the expensive ones are reached.

Every number below was measured today. Nothing is an estimate unless it says so.

---

## The cascade

```
                                        covers        costs
  1  identity cache, keyed on the card    38%          ~0ms
  2  world engine derivation              team 65%     ~0ms
                                          product 30%
  3  one provider call, full request,     everyone     ~3s floor
     compressed response                  else         + 11ms per output token
  4  targeted second look                 gap-only     3.5s, only when it pays
  5  compose, or abstain                  all          ~0ms
```

### 1. Cache the card, not the photograph — *the missing stage*

Not from B, C or D. Measured separately and it dominates all three:

```
4,349 sessions -> 2,697 distinct cards
2,066 repeats, 1,921 of which called the provider
829 minutes spent re-identifying cards already known
```

The current key is `tenant_id + image sha256`, so two photographs of one card —
PSA 9 and PSA 10, or the same card shot twice — miss each other. Keyed on
`year + product + set + subject + card_number + parallel`, with grade and cert
excluded, 38% of traffic never reaches stage 3 at all.

This is also the only stage that makes two listings of one card *agree*. Today
they do not: `luka dončić` and `luka donči` are the same card named twice.

### 2. Derive before asking — *route D, plus the enumerator*

Free, local, and it shrinks what stage 3 has to be asked for:

- team: **65%** to VALUE or EMPTY
- product: **30%**, after reading the set field as a product name where that is
  what it holds

D's own ROI was low — 14% to 30% — and that is the correct verdict on D *as a
route*. As a *stage* it costs nothing and runs before the expensive call, so a
low hit rate is still free coverage. A route worth rejecting can be a stage
worth keeping.

### 3. One call: full request, compressed response — *route B*

The measurement that makes this the right shape, taken over 4,785 production
calls, holding output constant:

| output band | input range | corr(input, latency) |
|---|---|---|
| ~638 tokens | 3,603 – 42,521 | **0.134** |
| ~1,111 | 4,429 – 19,131 | 0.076 |
| ~1,365 | 4,429 – 15,410 | **−0.050** |
| ~2,301 | 5,080 – 15,413 | 0.005 |

A twelvefold change in input moves latency almost not at all. Across bands,
latency tracks output at **~11ms per token**.

So the field checklist belongs in the request, where it is nearly free and
where it keeps the model looking, and the compression belongs in the response,
where the tokens actually cost time. Removing fields from the *request* — what
Task A tested — bought latency that could have been had for nothing and paid
6.91pp familiar and 7.74pp unseen for it.

### 4. Look again only when it pays — *route C*

The decision lives in `lib/listing/catalog/second-look-planner.mjs`; the
executor already exists in production behind a gate (two originals, four crops,
3.5s deadline).

```
63% of cards have at least one always-present gap   <- too expensive as a trigger
  of which 2,714 of 3,125 are the card number alone
  everything else together is under 20%
```

So C's economics rest entirely on the card number — and **92% of the cards
missing one had a back image in hand**. The picture was there; the number was
not read. That is an observation failure, which a targeted crop is the right
instrument for. Had it been a missing-asset problem, C would be worthless.

### 5. Compose or abstain

`composeParallel` emits `Silver /75` where colour or print run was read (46% and
55%) instead of the 0.8% the `parallel` field currently carries. What no stage
could settle is omitted rather than invented — the abstention the system still
cannot perform.

---

## What the cascade predicts

Composed from separately measured parts. **This is a prediction, not a result**,
and it is the thing to falsify first.

```
38% cache hit                       ~0.2s
62% miss:  3s floor + ~177 tokens x 11ms   ~5s
           plus 3.5s on the subset needing a second look

predicted p50  ~4-5s        from 25.5s today
```

## The floor is the thing none of them touch

The measurement that matters most for the ambition is in the lowest output band:

> **165 output tokens still took 4,850ms.**

At 11ms per token, generation accounts for ~1,815ms of that. **The remaining
~3 seconds is fixed** — prefill, image upload, network, our own pipeline — and
no amount of output cutting reaches it.

So: the composed path plausibly takes p50 from 25.5s to 4-5s. **Two to three
seconds is not reachable without a separate assault on the fixed overhead**,
which is a work item nobody has opened, and which was invisible until today
because every latency conversation until now assumed output length was the whole
story. It is most of the story, and it is not all of it.

---

## Falsification

- If the identity cache hit rate is far below 38% in practice, identity is not
  stable across two photographs — a deeper problem than caching.
- If restoring the full request does not restore accuracy, attention is not what
  was lost in Task A, and the accuracy regression has another cause.
- If the fixed overhead is not ~3s when measured directly rather than inferred
  from a regression intercept, the floor figure is wrong and the ambition is
  closer or further than this says.
