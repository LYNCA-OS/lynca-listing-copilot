# The ambition

## What we are building

> A card that exists in the world for the first day, photographed and handed to
> this system, comes back named to the SEM standard — in two or three seconds,
> the way a conversation answers. Not a card that becomes recognisable only
> after the market has listed it a hundred times.
>
> And further out: our name for a card becomes the name the industry uses.

Four properties follow. Each is measured, and each is currently blocked by
something specific.

| the ambition demands | today | measured on |
|---|---|---|
| a card absent from the model's training prior is still named | **0.4939** against **0.8414** on familiar products | 17 unseen-product cards vs 60 familiar |
| the index, not the model's prior, decides identity | the catalog is a juror on the model's guess | 2,626 of its application decisions rejected as `not_in_provider_prompt_safe_candidate_ids` |
| the system never names a card that does not exist | it does, confidently | the product line named existed nowhere on **9 of 17** unseen cards |
| two to three seconds | ~12s, and only ever measured cold | provider call alone is 9–21s; the warm path has never been evaluated once |

The worst single output so far: **`2021 Panini Contours JALYN DANIELS Silver RC`**
for a card that is `2025 Panini Phoenix Contours Jaxson Dart #24`. Invented
year, invented product, invented player, stated without hesitation. For a
product whose ambition is to define the naming standard, naming a card that
does not exist is worse than naming nothing.

## The central architectural finding

The catalog does two jobs, and they are worth very different amounts.

**Job A — supplying identity (which card is this).** Largely a detour. The card
carries its own player, card number and set name; the checklist is a second
copy. Mirroring every manufacturer's every card is unbounded work that still
leaves an unharvested manufacturer unnameable.

**Job B — constraining what can exist.** Irreplaceable, and it needs three
orders of magnitude less data:

```
2,292,135 harvested cards  ->  2.13 MB of constraints
                               20,816 players with the years they appear in
                               30,602 set names with the years they exist in
                                4,731 players with the teams they played for
                                  162 product lines with years and sports
                                  247 product-years with card-number ranges
```

Constraints also age far more slowly: a few dozen new products a year against
millions of new cards. **This is where the memory should live.**

### The one thing the card does not carry

Verified by reading the actual card images at full size:

| card | set name | product line |
|---|---|---|
| Myles Garrett | `CONTOURS` printed large | **phoenix emblem only** |
| Nikola Jokić | `FADE TO BLACK` printed vertically | **phoenix emblem only** |
| Tyreek Hill (Base) | none — Base cards print no set | **phoenix emblem only** |

**Panini Phoenix is never text on the card. It is an emblem.** The model read
everything it could read and still invented the product line, because that
information does not exist as text.

So the cheapest path to a product line is not better reading and not a
card-level catalog — it is: **read the set name, look it up.** 60.4% of 30,602
harvested set names identify exactly one product-year. `Fade To Black` and
`Fire Fabrics` each belong to Panini Phoenix and nothing else.

Base cards are the blind spot in that path: no set name to read. They need the
card-number range, the team, or an honest "I don't know".

## Two scoreboards, always reported together

- **familiar-product accuracy** — `policy_fair_token_recall` on cold20. Measures
  how well we do on ground already covered. Currently **0.8414**.
- **unseen-product accuracy** — the same metric on cards from product lines
  absent from the catalog. Measures the ambition. Currently **0.4939**.

A change that lifts the first and leaves the second flat is not progress toward
the ambition. The 35-point gap between them *is* the ambition.

A third is needed and does not exist yet: **abstention rate** — how often the
system correctly says it does not know, instead of inventing. Today it is zero
because the system cannot abstain.

## Coverage is misaligned with demand

Trade history against catalog coverage:

```
Topps Chrome     3,275 listings      Topps overall: 66 of ~883 sources  (7.5%)
Bowman Chrome    1,115 listings
MTG Final Fantasy  854 listings      1,367 cards, fully harvested
Pokemon            454 listings      nothing harvested
Panini             425 listings      2,259,519 cards harvested
```

The catalog is strongest exactly where we trade least, because Panini's API was
the easiest to walk. Sync order should follow demand, not harvest convenience.

## How we work — earned the hard way

**1. Paired, interleaved evaluation.** Two arms alternate; never measure one
today and the other tomorrow. The same change measured across a gap read
NOT_PROVEN at sd=0.0456, and IMPROVED at +0.0231 when the arms were
interleaved and sd fell to 0.0084.

**2. Measure before fixing.** Five changes in two days were reverted or
withheld after measurement: two were inert because the gate they patched never
fires, two regressed by 5.4 and 11.75 points, one produced 16 false positives
out of 17. Write the measurement first.

**3. Absent coverage is not evidence against.** A manufacturer we have not
harvested must be `UNCHECKED`, never `FABRICATED`. This exact error caused two
of those reversions. It is why the constraint model covers Magic but the
existence check still refuses to judge Topps.

**4. Completeness before authority.** Giving an incomplete index more power
amplifies its errors. Consulting the catalog before observation regressed 11.75
points because the index did not contain the product — a correctly-read player
and number went to an index without the answer, came back with the nearest
wrong product, and anchored the model to it.

**5. Every claim is a count.** "This gate never fires" is `0/60`, not an
argument from reading code.

## The debt that keeps surfacing

Five separate cases where a feature exists and never runs, or runs invisibly:

```
productSchemas: []             at every call site; the constraint engine never constrained
pre-observation catalog lookup  0/60, gated on knowing the product it would establish
ENABLE_LISTING_FAST_PATH        0/60; the harness disables the identity cache
smoke hard-codes enable_*       why three component ablations came back "unmeasurable"
l1_title / title_stage          hard-coded constants; a whole stage invisible to every measurement
```

**None of these are broken features. They are broken observation.** Any claim
about what the pipeline does should be checked against whether we can see it at
all.

## What would falsify the plan

- If unseen-product accuracy does not move once the catalog contains those
  products, then completeness is not the bottleneck and the reading layer is.
- If set-name lookup does not lift the product line, then the 60.4% uniqueness
  figure does not survive contact with what the model actually reads.
- If constraint refutation cannot get its false-alarm rate on familiar cards
  below single digits once coverage improves, then the approach is wrong rather
  than under-fed. It currently sits at 88%, and the causes measured so far are
  coverage and naming alignment, not the logic.
