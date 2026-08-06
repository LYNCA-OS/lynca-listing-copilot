# Finish/rarity expression prompt screen — 2026-08-02

## Decision

**STOP. Keep evaluation-only; do not promote the extra prompt.**

The treatment was intended to recover printed parallel/finish/rarity words
(`Refractor`, `SSP`, `Raywave`, colour names, and similar marks) while leaving
identity, serial, and card number unchanged. On this six-card paired screen it
did not recover a new reviewed-title token, lost one token already recovered by
the control, reduced macro F1, and increased latency. This is a diagnostic
result, not evidence that a second visual pass is useless in general; it shows
that this wording is not a positive asset at its current form.

## Method

- Control: `thin_canonical_high`.
- Treatment: `thin_canonical_finish_rarity_high`.
- Same six blind reviewed cards, same image detail (`high`), model
  `gpt-5.6-luna`, reasoning `none`, and paired arm order rotation.
- 12 paid provider calls total; concurrency 2; no production or CSM schema
  change.
- Run fingerprint:
  `331ee4e2ee0d554bade44637a3bea48e8b4e0850fe98ed0ce040c4e180070ae8`.

The screen is deliberately too small to establish a production gain. Its only
purpose is to reject a clearly unsafe direction before spending a 150-card
confirmation run.

## Aggregate result

| arm | F1 | recall | precision | token recall | median latency | median input tokens | low-confidence rows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| control | 0.6688 | 0.5750 | 0.8258 | 0.6210 | 4,832 ms | 5,402 | 0/6 |
| treatment | 0.6617 | 0.5917 | 0.7870 | 0.6396 | 5,680 ms | 5,516 | 1/6 |

Paired macro-F1 delta was **−0.0071** (treatment wins 2, control wins 1,
ties 3; sign-test `p=1.0`). The treatment was 848 ms slower at the median
(17.6%) and used 684 more input tokens across six calls (2.2%).

The apparent recall/token-recall increase is not a finish/rarity recovery:
the treatment did not add a reviewed-title target token and changed unrelated
fields on two cards. It is therefore not a positive asset.

## Per-card evidence

Reviewed titles are the sealed reference titles; field-level labels remain
unavailable, so token claims below are limited to exact reviewed-title text.

| card | reviewed title (abridged) | control → treatment | paired result | finish/rarity evidence |
| --- | --- | --- | ---: | --- |
| `3c690…` | `…Home Advantage SSP` | `…Rainbow Prizm` → `…Rainbow` | +0.0455 | **No `SSP` recovered**. Treatment also changed product/set representation and removed `unreadable: product`. |
| `b58559…` | `…1st Purple Raywave Refractor 105/250` | `…Briefing…` → `…Briefing… Purple Wave…` | +0.0273 | **No `Raywave` or `Refractor` recovered**. `Wave` is not the reviewed token. |
| `9ef085…` | `…1st Gold Refractor 37/50 RC` | `…Gold` → `…Green` | 0.0000 | Treatment **lost `Gold`**, and neither arm recovered `Refractor` or `RC`. |
| `5edfef…` | `…RC Orange Refractor 12/25 Auto Dodgers` | `…Orange…` → `…Orange…` | 0.0000 | Both kept `Orange`; neither recovered `Refractor`. |
| `67bb24…` | `…Ronaldinho Home Advantge SSP` | `…Home Advantage Ronaldinho` → `…UCL Ronaldinho Home Advantage` | −0.1154 | **No `SSP` recovered**; treatment introduced a wrong set expression. |
| `46be33…` | `…Gusto Red Refractor 5/5 Dodgers` | same `…Gusto Red 5/5` | 0.0000 | Both kept `Red`; neither recovered `Refractor`. |

The two treatment wins are not targeted wins: they come from other title
token placement/identity choices. Treating them as finish/rarity evidence
would be circular and would overstate the experiment.

## Follow-up

1. Do not edit the production prompt or schema from this screen.
2. Preserve the raw paired checkpoint and this report for audit/replay.
3. The next low-cost candidate should expose model observations separately
   (capture-only) and let SEM resolve only exact printed evidence; a prompt
   that merely asks for a second pass is not enough.
4. A candidate can proceed to a 150-card paid confirmation only after a
   zero-cost replay shows no reference losses and no unrelated identity drift.
   An independent 150-card cohort is still required before any production
   promotion.
