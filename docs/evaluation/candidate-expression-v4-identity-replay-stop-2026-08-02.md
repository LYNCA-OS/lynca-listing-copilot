# Candidate expression v4 identity replay — STOP

## Decision

Stop the v4 identity overlay. It is evaluation-only and must not enter the
production CSM/SEM authority path.

The replay used the stored v4 candidate responses and the stored canonical
responses for the same asset IDs. It made no provider calls. The population is
only 102 cards from the development cohort, so this is a rejection of the
mechanism, not an independent 150-card accuracy estimate.

| Metric | Result |
|---|---:|
| Cards matched | 102 |
| Changed cards | 16 |
| Wins / losses / ties | **4 / 12 / 86** |
| Baseline macro F1 | 0.761042 |
| Replay macro F1 | 0.756854 |
| Delta | **−0.004188** |
| Critical false identity promotions | 12 loss cards |
| New model calls | 0 |

## What failed

The resolver admitted a visible `logo_or_symbol` identity or affiliation as
`set` whenever the canonical Set was empty. In this cohort, the visible mark
was often a team, players association, grading company, or a product logo
fragment rather than the checklist Set. The false additions cost precision and
did not recover the reference token.

| Card | Baseline → replay | ΔF1 | Cause |
|---|---|---:|---|
| Spencer Dinwiddie | `…Optic Dinwiddie…` → `…Optic O Dinwiddie…` | −0.0368 | logo fragment treated as Set |
| Shohei Ohtani | `…Bowman Chrome Ohtani…` → `…Bowman Chrome B Chrome Ohtani…` | −0.0549 | product logo fragment |
| George Kittle | `…Signature Class Kittle…` → `…Signature Class NFLPA Kittle…` | −0.0333 | NFLPA affiliation |
| Jahmyr Gibbs | `…Obsidian Gibbs…` → `…Obsidian NFLPA Gibbs…` | −0.0909 | NFLPA affiliation |
| Jonathan Kuminga | `…Optic Kuminga…` → `…Optic Golden State Warriors Kuminga…` | −0.1270 | team affiliation |
| Elsa | `…Chrome Elsa…` → `…Chrome Disney Elsa…` | +0.0833 | true IP identity |
| Mufasa | `…Chrome Mufasa…` → `…Chrome Disney Mufasa…` | +0.0989 | true IP identity |
| Buddy Hield | `…Optic Hield…` → `…Optic O DONRUSS Hield…` | −0.0421 | product/logo fragment |
| Cam Skattebo | `…Optic Skattebo…` → `…Optic O DONRUSS Skattebo…` | −0.0381 | product/logo fragment |
| Ricky Pearsall | `…Black Pearsall…` → `…Black NFLPA Pearsall…` | −0.0421 | NFLPA affiliation |
| LeBron James | `…Pristine LeBron…` → `…Pristine BECKETT LeBron…` | −0.0395 | grading-company mark |
| Shedeur Sanders | `…Optic Sanders…` → `…Optic O Donruss Sanders…` | −0.0254 | product/logo fragment |
| Adaptable Alien | `…Chrome Adaptable Alien…` → `…Chrome VeeFriends Adaptable Alien…` | +0.0809 | true IP identity |
| LeBron James | `…Chrome LeBron…` → `…Chrome Los Angeles Lakers LeBron…` | +0.0066 | team happened to match reference |
| Josh Hart | `…Finest Josh Hart…` → `…Finest NEW YORK KNICKS Josh Hart…` | −0.1333 | team affiliation absent from reference |
| D’Angelo Russell | `…Optic Russell…` → `…Optic O Donruss Russell…` | −0.0333 | product/logo fragment |

## Asset conclusion

This is a negative runtime asset. The useful observation is narrower: visible
IP marks such as `Disney` and `VeeFriends` can be correct, but a generic
logo/affiliation source is not a safe Set admission rule. Keep those facts in
an evidence/candidate lane only. A future identity mechanism must distinguish
IP/product identity from team, players-association, grading-company, and logo
fragments before it earns another paid confirmation.

Source replay:

```text
node scripts/replay-candidate-identity-v1.mjs \
  --canonical artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl \
  --candidates artifacts/candidate-expression-v4/development-150/thin-path-gpt-5.6-luna.jsonl \
  --out artifacts/candidate-expression-v4/development-150/identity-replay-v1.json
```
