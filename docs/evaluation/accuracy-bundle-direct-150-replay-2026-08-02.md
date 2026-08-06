# Direct 150-card replay receipt — 2026-08-02

## Decision boundary

This is the requested 150-card zero-cost replay. It reuses the already-paid
canonical and exhaustive observations; it is not a new provider sample and it
does not authorize a production promotion. A new label-blind 150-card paid
cohort is still the independent confirmation gate.

Artifact: `artifacts/accuracy-bundle-confirmatory-150-2026-08-02/replay-direct-150-2026-08-02.json`

## Final result

| Cards | Baseline F1 | Candidate F1 | Delta | Wins / losses / ties | Changed cards | Reference-loss cards | Over 80 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 150 | 0.771494 | 0.778394 | **+0.006900** | **13 / 0 / 137** | 13 | 0 | 0 |

The result is paired at the card level. Every changed card improved; no card
lost a reference-helpful token and no final title crossed the 80-character
contract. This is a replay receipt, not a claim that the model saw new images.

## Cumulative stage screen

Each row is scored against the same baseline, so the rows are cumulative and
must not be summed. The first column is the stage's changed-card count; the
last column is the cumulative paired delta.

| Stage | Changed cards | Wins / losses / ties | Cumulative F1 | Cumulative delta |
|---|---:|---:|---:|---:|
| identity replay v3 | 4 | 4 / 0 / 146 | 0.773681 | +0.002187 |
| attested insert | 5 | 5 / 0 / 145 | 0.774030 | +0.002536 |
| finish family (color only) | 5 | 5 / 0 / 145 | 0.774030 | +0.002536 |
| SAR rarity | 6 | 6 / 0 / 144 | 0.774294 | +0.002801 |
| Trainer Gallery | 6 | 6 / 0 / 144 | 0.774294 | +0.002801 |
| 1st Bowman | 7 | 7 / 0 / 143 | 0.774690 | +0.003196 |
| known-manufacturer product extension | 10 | 10 / 0 / 140 | 0.776563 | +0.005070 |
| single-digit serial normalization | 13 | 13 / 0 / 137 | 0.778394 | **+0.006900** |

The most productive cumulative steps were the guarded product extension and
the serial normalization. The finish-family and Trainer Gallery overlays made
no additional change on this 150-card pool; they remain harmless but unproven
for promotion.

## All changed cards

The JSON artifact contains all 150 card records. The table below expands every
one of the 13 cards whose final paired F1 changed, including the exact
baseline, reference, final title, and mechanism attribution.

| Asset | Baseline | Reference | Final title | Mechanism | ΔF1 |
|---|---|---|---|---|---:|
| `ee03ba06dd634655b4ba` | 2024-25 Panini Revolution Victor Wembanyama Horizontal RC BGS 9 | 2024-25 Panini Revolution Victor Wembanyama Kaboom-Horizontal BGS 9 | 2024-25 Panini Revolution Victor Wembanyama KABOOM HORIZONTAL RC BGS 9 | attested insert | +0.052381 |
| `8945fde9c65cb1b9f3a8` | 2023 Leaf Metal Xavier Hutchinson 1/1 Auto RC | 2023 Leaf Metal Draft Xavier Hutchinson Portrait Auto Super Gold RC 1/1 | 2023 Leaf Metal Draft Xavier Hutchinson 1/1 Auto RC | known-manufacturer product extension | +0.057143 |
| `8922f71c190ac8dbeca8` | 2026 Topps Chrome Elsa #168 025/150 | 2026 Topps Chrome Disney Elsa Blue Sparkle Refractor 025/150 | 2026 Topps Chrome Disney Elsa #168 025/150 | identity Set=Disney + product extension | +0.083333 |
| `7059d3b39d01402f0e61` | 2026 Topps Chrome Common Sense Cow Original Artwork #49 | 2026 Topps Chrome VeeFriends Common Sense Cow Black Mini Diamond Refractor 07/10 | 2026 Topps Chrome VeeFriends Common Sense Cow Original Artwork #49 | identity Set=VeeFriends + product extension | +0.064935 |
| `1ab36981fdce86771040` | 2026 Topps Chrome Mufasa #164 | 2026 Topps Chrome Disney Mufasa Dalmatian Refractor 004/101 | 2026 Topps Chrome Disney Mufasa #164 | identity Set=Disney | +0.098901 |
| `8cabcafd0596fbab0bb0` | 2022 Panini Donruss Legendary Logos CeeDee Lamb 2/25 Relic | 2022 Panini Donruss Optic Cee Dee Lamb Legendary Logos 02/25 | 2022 Panini Donruss Legendary Logos CeeDee Lamb 02/25 Relic | single-digit serial | +0.105263 |
| `c2b77d787bd8cd8345e3` | 2025 Pokemon Pokémon Mega Brave Mega Absol ex Special Art Rare #089/063 CGC 10 | 2025 Pokemon JP Mega Absol Ex Mega Brave 089/063 Special Art Rare - Holo SAR CGC 10 | 2025 Pokemon Mega Brave Mega Absol ex Special Art Rare #089/063 SAR CGC 10 | SAR rarity | +0.039683 |
| `e5c7694ffc8faf61ee31` | 2024 Panini Prizm Jayden Daniels 9/10 RC PSA 10 | 2024 Panini Prizm Jayden Daniels Gold Shimmer Rookie 09/10 RC PSA 10 | 2024 Panini Prizm Jayden Daniels 09/10 RC PSA 10 | single-digit serial | +0.095238 |
| `7815e1aeda1f8e00dd4e` | 2026 Topps Chrome Adaptable Alien | 2026 Topps Chrome VeeFriends Adaptable Alien Orange Mini Diamond Refractor /25 | 2026 Topps Chrome VeeFriends Adaptable Alien | identity Set=VeeFriends + product extension | +0.080882 |
| `a4051a222e9be2cf8149` | Topps Chrome Black Autograph Paul Kasey Auto | 2025 Star Wars Smugglers Outpost Paul Kasey Edrio Two Tubes Chrome Auto | Topps Star Wars Chrome Black Autograph Paul Kasey Auto | known-manufacturer product extension | +0.150376 |
| `77f1063c48c35c3d3583` | 2020 Panini Flawless Justin Herbert Rookie Dual Patch Auto 5/20 RC PSA 9 | 2020 Panini Flawless Justin Herbert Rookie Dual Patch Auto Silver RC 05/20 PSA 9/10 | 2020 Panini Flawless Justin Herbert Rookie Dual Patch Auto 05/20 RC PSA 9 | single-digit serial | +0.074074 |
| `7ae66142ce80a2d06fc0` | 2025-26 Topps Bowman Chrome Caleb Wilson Prospect Auto 1/1 | 2025 Bowman Sapphire Caleb Wilson Chrome Auto Padparadscha Refractor 1st 1/1 RC | 2025-26 Topps Bowman Chrome Caleb Wilson Prospect Auto 1/1 1st Bowman | 1st Bowman | +0.059289 |
| `a8a73b44f77bf6e823e2` | 2026 Topps Chrome Patrick Mix RC | 2026 Topps Chrome UFC Patrick Mix RC Refractor X-Fractor RC | 2026 Topps Chrome UFC Patrick Mix RC | known-manufacturer product extension | +0.073529 |

## Interpretation

This is a positive, low-cost replay asset. It earns a place in the next
independent 150-card confirmation bundle, but it is not production evidence by
itself because the observations and labels are from the existing reviewed
pool. The strongest low-cost candidates to carry forward are:

1. single-digit serial normalization;
2. guarded known-manufacturer product extension;
3. attested insert vocabulary;
4. the narrowly vetoed logo-to-Set identity fill.

The replay does not justify reopening the stopped free-expression v5 or
world-knowledge one-call hypotheses. Those remain separate negative/neutral
experiments with their own receipts.
