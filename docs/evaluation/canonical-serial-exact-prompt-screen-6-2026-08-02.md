# Canonical serial-exact prompt screen — 2026-08-02

This was a six-card paired paid screen, not a verdict. The control was the
existing `thin_canonical_high` arm. The treatment added one sentence asking
the model to copy serial characters exactly, including leading zeroes, without
normalising or inferring them. Both arms used GPT-5.6 Luna with `reasoning:
none`, `high` image detail, and the same six assets at concurrency 2.

There are two output directories. The first run in `screen-6/` is **invalid**:
the arm declaration carried the treatment prompt, but the request builder did
not override the actual `input_text`, so both paid arms received the same
production prompt. Its numbers are retained only as an audit trail and are not
evidence. The runner was fixed before the corrected run in
`screen-6-corrected/`.

## Corrected result

| Arm | n | F1 | Median latency | Median output | Wins |
| --- | ---: | ---: | ---: | ---: | ---: |
| Control | 6 | 0.7824 | 4.68 s | 112 | 1 |
| Serial-exact clause | 6 | 0.8217 | 5.49 s | 115 | 3 |

Paired delta was **+0.0393 F1**, with 3 treatment wins, 1 control win and 2
ties (`p=0.625`). The screen is too small to establish a gain. More
importantly, the treatment did not isolate the intended mechanism:

- `027/150` was recovered exactly on the George Kittle card (+0.10 F1).
- `05/20` stayed as `5/20`, so the clause did not guarantee leading-zero
  recovery.
- The CeeDee Lamb treatment changed `21/25` to `02/25`, a genuine serial and
  title win on this corrected run; this is not evidence that the prompt is
  safe, because the six-card arm still changed unrelated fields.
- The treatment had 5.49 s median latency versus 4.68 s for control (1.17x).
- Other fields changed between paired responses, so the observed lift is not
  attributable to serial transcription alone.

## Per-card ledger

| Card | Reference serial | Control serial / title | Treatment serial / title | ΔF1 |
| --- | --- | --- | --- | ---: |
| George Kittle | `027/150` | `27/150` · `2025 Topps Signature Class George Kittle 27/150 Auto` | `027/150` · `2025 Topps Signature Class George Kittle 027/150 Auto` | +0.1000 |
| Disney Anna | `082/100` | `82/100` · `2023 Topps Chrome Disney 100 Anna 100-Year Diamond Refractor 82/100 PSA 10` | `082/100` · `2023 Topps Disney100 Chrome Anna 100-Year Diamond Refractor 082/100 PSA 10` | 0 |
| CeeDee Lamb | `02/25` | `21/25` · `2022 Panini Donruss Legendary Logos CeeDee Lamb Silver Prizm 21/25 Relic` | `02/25` · `2022 Panini Donruss Legendary Logos CeeDee Lamb Purple Prizm 02/25 Relic` | +0.0952 |
| Jayden Daniels | `09/10` | `09/10` · `2024 Panini Prizm Jayden Daniels Gold Shimmer 09/10 RC PSA 10` | `09/10` · same serial and title tokens | 0 |
| Justin Herbert | `05/20` | `5/20` · `2020 Panini Flawless Justin Herbert Rookie Dual Patch Auto 5/20 RC PSA 9` | `5/20` · `2020 Panini Flawless Justin Herbert Rookie Dual Patch Auto 5/20 RC PSA 9` | +0.0741 |
| Shohei Ohtani | `018/150` | `018/150` · `2018 Topps Silver Pack Shohei Ohtani 1983 Chrome Promo 018/150 RC PSA 10` | `018/150` · `2018 Topps Silver Pack Shohei Ohtani 1983 Chrome Promo 018/150 RC PSA 10` | −0.0333 |

The George Kittle and CeeDee gains are serial-relevant, but the Disney and
Shohei title changes show that the prompt can alter unrelated identity wording.
The Justin treatment tied the control on this run, while Shohei lost F1 despite
an unchanged serial. This is why the screen cannot justify promoting the prompt
clause even though its aggregate direction was positive.

## Decision

**STOP.** Do not change the production canonical prompt and do not include
this arm in a 150-card confirmation bundle. The corrected screen is directionally
positive, but n=6, p=0.625, it changed unrelated fields, and it failed to
recover `05/20`; that is not a safe model-level improvement. The zero-cost
exhaustive replay still supports a narrowly source-anchored same-value serial
resolver, but that resolver remains evaluation-only until an independent
observation channel exists in the production response.

The arm and its six-card asset manifest remain in the experiment worktree for
auditability; they are not part of the production path.

Artifacts:

- `artifacts/accuracy-mechanism-screen-serial-exact-2026-08-02/screen-6/` (invalid harness run; audit only)
- `artifacts/accuracy-mechanism-screen-serial-exact-2026-08-02/screen-6-corrected/`
- `experiments/accuracy/serial-exact-screen-ids.json`
