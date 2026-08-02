# Canonical IP v1 screen (20 cards, 2026-08-02)

## Decision

Hold as a candidate mechanism. Do not wire it to production and do not spend
the independent 150-card gate on this version alone. The field-only replay is
directionally positive with zero losses, but it has only one win on 20 cards;
the contract-grammar replay exposes a real loss. Keep it in the next 5--8
mechanism bundle.

## What was tested

This was one additional required field, not an open evidence ledger and not a
second model call. The request added `ip` to the CSM-shaped response and asked
for a printed game/franchise/IP only for TCG cards. The value was admitted only
when the same response called the card `tcg`; no catalog, world lookup, or
inference was used.

The cohort was 20 cards: five known TCG/collectible cards (Disney, Pokemon,
VeeFriends, Pokemon and Disney Lorcana) plus 15 non-TCG controls. The control
rows are the same cards from the earlier paid canonical-high run, so this is a
development screen and not an independent 150-card confirmation.

## Paired live result (diagnostic only)

The treatment response changed unrelated fields as well as `ip`, so this is
not an attribution-safe measure of the field.

| Arm | F1 | Wins | Losses | Ties | Median latency | Median input | Median output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Earlier canonical control | 0.7538 | — | — | — | 5.786 s | 5,402 | 104 |
| IP candidate | 0.7573 | 6 | 4 | 10 | 6.513 s | 5,631 | 110 |

The live delta is `+0.0035`, but it is confounded by the model changing finish,
set, card name and serial on other cards. It is not a promotion result.

## Isolated replay

The replay starts with the control's canonical fields and changes only what the
IP candidate supplied. It measures two policies separately:

| Replay | F1 delta | Wins / losses / ties | Interpretation |
| --- | ---: | ---: | --- |
| IP only; retain control grammar | +0.0035 | 1 / 0 / 19 | Safe, but only one title changed: Disney Elsa |
| IP plus `grammar=tcg` when IP is present | -0.0007 | 1 / 1 / 18 | STOP: VeeFriends lost `Original Artwork` after the TCG order was applied |

The treatment emitted an IP on all five TCG cards, four of which were new over
the control. It emitted no IP on the 15 standard cards, no title exceeded 80
characters, and no false standard-card IP was observed. The positive Elsa case
is real but too sparse to establish a gain. Pokemon and Disney Lorcana already
had enough identity in the control title; VeeFriends is the important counter-
example because the model's simultaneous grammar change is not free.

## Cost and boundary

Adding this field increased median latency from 5.786 s to 6.513 s (+12.6%),
median input tokens from 5,402 to 5,631 (+4.2%), and median output tokens from
104 to 110 (+5.8%). This is materially cheaper than the open-evidence arm, but
not free.

The code is evaluation-only:

- `lib/listing/thin/canonical-ip-v1.mjs`
- `scripts/run-canonical-ip-screen.mjs`
- `scripts/analyze-canonical-ip-screen.mjs`
- `artifacts/canonical-ip-screen-20-2026-08-02/analysis.json`

The production canonical schema and request path were not changed.
