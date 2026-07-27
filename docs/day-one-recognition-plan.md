# Day-one recognition

The ambition: a card that exists in the world for the first day, photographed
and handed to this system, comes back named to the SEM standard. Not a card
that becomes recognisable after the market has listed it a hundred times.

And it should feel like a conversation — send a picture, the system goes and
finds out what the card is, and tells you.

## What today's architecture actually is

A closed-world matcher. Recognition reads the card, then confirms what it read
against a catalog snapshot imported some time earlier. Two measurements from
2026-07-26/27 say what that costs:

- **The catalog confirms nothing on the benchmark.** Across all twenty cold20
  cards, `pre_l2_anchor_catalog_candidate_count` is zero, while fifteen of
  twenty get vector candidates. We imported 75,990 official checklist rows and
  harvested 2.26M Panini cards, and the retrieval lane returned no candidate on
  any benchmark card.
- **Without confirmation the pipeline must guess, and guessing loses.** The
  `parallel_family` fix (`2b1b7f4`) let a first-pass vision read state the
  finish family without catalog backing. It regressed 5.4 points and was
  reverted. A Chrome card shines like a Refractor whether it is one or not.

A day-one card is permanently in that second position. **This is not an
accuracy problem that more benchmark tuning reaches.**

Measured scope of the gap: of 219 manufacturer product-years harvested, **139
(63%) are unknown to our catalog**, covering **1,038,840 cards (46%)**. And
that is only Panini, only three years.

## The reframe that makes it tractable

A first-day card is not an unknown card. **Manufacturers publish their
checklists at or before release.** Verified: Panini's live selection API served
26 product lines and 8,957 sets for 2025 football when harvested on 2026-07-26.
Topps publishes checklist PDFs the same way.

So the requirement is not "infer a card with no prior information", which is
impossible. It is:

> **hold the manufacturer's checklist within hours of publication, and read a
> card against it without ever having seen that specific card.**

That is an engineering problem, and half of it is already built.

## Architecture

### Layer 1 — the catalog becomes a mirror, not an archive

Today the catalog is imported in bulk, occasionally. It needs to be a
continuously synced mirror of what each manufacturer has published, with a
freshness measured in hours.

`scripts/harvest-panini-checklists.mjs` already walks Panini's tree; it becomes
a delta sync on a schedule rather than a one-off. Topps is a manifest of
published PDFs; the same applies.

This layer alone converts "day one" from impossible to default, for anything a
manufacturer publishes.

It also **reverses part of the demand-tier direction** from 2026-07-26. Gating
the catalog on eBay liquidity was right for "which cards are worth building
first" and is wrong for "which cards we are able to name". If the goal is to
define the naming standard, coverage cannot be conditional on a card already
trading. Demand tier stays as a priority signal, not an admission gate.

### Layer 2 — resolve open-world at recognition time

When the mirror cannot confirm a card, the system should go and find out:
manufacturer site, marketplace listings, the open web. Decide, answer, and
**write the answer back into the catalog**.

This is the conversational quality the ambition asks for — not a lookup, an
investigation. And the write-back is what makes it compound: the first card of
a new product pays the cost of the investigation, and every subsequent card of
that product is a hit.

### Layer 3 — SEM is the product

If the ambition is to define the industry's naming standard, then SEM is the
asset and the catalog is how it gets applied consistently. Every resolution
emits a SEM-canonical name; every disagreement between our name and the
market's name is data that sharpens the standard.

`UCC` versus `UEFA Club Competitions` is a miniature of exactly this — we were
right and the market abbreviates, and that is a standards decision, not an
accuracy bug.

## How progress is measured

The existing `policy_fair_token_recall` on cold20 measures how well we do in
familiar territory. It stays. It does not measure the ambition.

The new scoreboard is **unseen-product naming**: cards drawn from product lines
absent from our catalog, scored the same way. Today that number does not exist.
Getting it is step one, and it is expected to be poor — the point is that
without it every architectural change is unfalsifiable.

Both numbers are reported together from here on. A change that lifts familiar
accuracy while leaving unseen-product accuracy flat is not progress toward the
ambition.

## Plan, reordered after two failures

The first ordering put "make the catalog speak earlier and louder" first and
"make the catalog complete" last. Two live paired evals proved that backwards.

**Attempt 1 — let a vision read state the finish family** (`2b1b7f4`). The
trace correctly showed `parallel_family` dying at the resolver. Extending the
colour's grounding to cover it regressed 5.4 points on familiar products and
was reverted. A Chrome card shines like a Refractor whether it is one or not.

**Attempt 2 — consult the catalog before the model observes** (`88d807ad`).
Keyed on (player, card_number) the harvested checklist resolves to a median of
one product line, so a shortlist looked free. On the unseen benchmark it
regressed 11.75 points, 0.4939 to 0.3764, and was reverted.

The reason is the whole lesson. That median of one was measured over the 2.26M
cards **in the harvest files on disk**. Retrieval queries the **database**, and
the database holds zero rows for Phoenix — the product fifteen of the seventeen
benchmark cards come from. So the earlier lookup took a correctly-read player
and card number to an index that does not contain the answer, returned the
nearest wrong product, and anchored the model to it. Worse than a free guess,
because now the guess had false confirmation.

> **Giving an incomplete index more authority amplifies its errors. Completeness
> comes first, always.**

So:

1. **Make the catalog complete for a bounded slice, and re-measure.** Ingest
   the products the unseen benchmark draws from and run the same seventeen
   cards. This tests the load-bearing claim of everything below -- that an
   unseen product becomes recognisable once the checklist is present -- at a
   size that can be reverted in one command.
2. **Let a high-confidence catalog row state identity without the model's
   endorsement.** Today 2,626 application decisions are rejected as
   `not_in_provider_prompt_safe_candidate_ids` and `product` is blocked on
   60 of 60 cards. Only worth doing once (1) shows the catalog is right.
3. **Move retrieval before observation** -- the change just reverted, retried
   against a complete index.
4. **Feed the constraint engine.** `productSchemas` is `[]` at every call site,
   so `parallelSerialTaxonomyCompatibility` and `allowedCardTypes` evaluate over
   an empty set and constrain nothing. It should have rejected
   `2021 Panini Contours`, a year and set combination that does not exist.
5. **Scheduled delta sync per manufacturer**, with a freshness metric. This is
   what makes "day one" true rather than "true for what we happened to import".
6. **Open-world fallback with write-back**, off the critical path: on a miss,
   investigate, answer, and write the answer into the catalog so the next card
   of that product is a hit.

### Coverage priority is currently misaligned with demand

The catalog work so far went to Panini because its API was the easiest to
harvest. Our own trade history says the volume is elsewhere: Topps Chrome
(3,275 listings), Bowman Chrome (1,115), MTG Final Fantasy (854), Pokemon
(454), against Panini (425). Sync order should follow that, not harvest
convenience.
