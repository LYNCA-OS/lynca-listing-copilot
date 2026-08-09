# K-fold few-shot live identity correction — 2026-08-09

## Verdict

The 2026-08-05 k-fold few-shot result is **VOID and non-promotable**. This is a
measurement-integrity failure, not evidence that few-shot helps or hurts.

## What failed

`examplesFor` addresses the reviewed corpus by its sealed-label `row.key`. The
live runner instead supplied `${asset_id}::${arm}`. With no matching own row,
the near-duplicate guard had no reviewed title to compare against and could
admit answer-bearing examples.

A zero-provider-call replay over the 255-card corpus found:

- 9/255 card prompts with exact-self or near-duplicate exposure;
- 8/255 prompts containing the card's exact reviewed title;
- 0 provider calls and therefore no new accuracy claim.

Consequently the historical `+0.0051` F1 and `9W/7L/34T` are not a positive
signal. They must not be combined with valid arms or used for promotion.

## Corrected contract

The live request and checkpoint reconstruction now use one fail-closed card
identity: sealed-label key first, physical-card identity second. A card-keyed
arm without either identity cannot run. Its run manifest hashes every selected
card's actual dynamic prompt and pinned reasoning effort, and checkpoint rows
must carry an explicit provider effort attestation.

The retained historical artifacts remain append-only evidence of the defect.
A future re-run must use a fresh output directory and produces a new result; it
does not repair the old measurement retroactively.
