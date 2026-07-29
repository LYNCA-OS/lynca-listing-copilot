# Output contract: what every field is actually worth

Step 1 of `docs/brief-output-contract-and-world-knowledge.md`. Every field the
provider is asked to return, counted against production rather than judged by
reading the schema.

Source: 4,694 `v4_recognition_sessions` with a final title. A field counts as
non-empty when its value is not `null`, `false`, `[]` or `""`.

## The headline

```
output tokens per call        825
of which null / false / []    69.3%
latency                       825 tokens / ~54 tokens-per-sec = 15.3s
                              and recognition_core is 94% of total latency
```

Latency is output length. Everything below is about which tokens are worth
paying 18 milliseconds each for.

## DROP — never once filled, in 4,694 recognitions

| field | non-empty | read by |
|---|---|---|
| `artist` | 0 | 5 files |
| `category` | 0 | 10 |
| `standardness` | 0 | 1 |
| `character` | 0 | 22 |
| `route` | 0 | 0 |
| `attributes` | 0 | 3 |
| `sketch` | 0 | 7 |
| `case_hit` | 0 | 8 |
| `print_run_review_required` | 1 | — |
| `suspicious_print_run` | 1 | — |
| `tcg_card_number` | 2 | — |
| `redemption` | 4 | — |

These are read by code, so they are not dead — but that does not make them
worth asking for. **The model has never once produced a value for any of them,
so every consumer already only ever sees the empty case.** Removing them from
the output contract cannot change downstream behaviour, because downstream has
never seen anything else. That is an empirical claim, not an argument from
reading the code: 0 of 4,694.

`route` is worth a separate look — 36 files mention it and none read it off a
resolved field.

## DERIVED — the world engine answers these, and better

| field | non-empty | why the model should not be asked |
|---|---|---|
| `team` | 40.6% | 77% of empty-team cards are answerable from career intervals |
| `product` | 92.6% | never printed on the card; it is an emblem. Set name identifies it |
| `sport` | **0.0%** | asked for on every call, produced never |
| `parallel` | 0.8% | composed from `surface_color` + `serial_denominator` |

`sport` is the clearest case in the whole census: it is in the schema, it is
requested on all 4,694 calls, and it has never been returned once. It is also
what the enumerator needs to answer EMPTY, so its absence costs twice.

## READ — only the image can answer these, keep every one

| field | non-empty | |
|---|---|---|
| `players` | 98.3% | |
| `player` | 97.8% | |
| `year` | 94.4% | |
| `brand` / `manufacturer` | 94.5% | |
| `card_name` | 91.5% | |
| `set` | 87.8% | printed large; the route to `product` |
| `serial_number` | 55.0% | the route to the parallel identity |
| `serial_denominator` | 54.8% | |
| `surface_color` | 45.6% | the one visual judgement worth making |
| `collector_number` | 42.0% | |
| `auto` | 41.1% | |
| `card_grade` / `grade_company` / `grade` | 32-35% | slab text |
| `card_number` | 30.6% | |
| `rc` | 24.6% | printed logo, never inferred |

## Redundancy inside the kept set

Six fields carry the same print run, and the model is asked to emit all six:

```
serial_number  numbered_to  serial_denominator  expected_serial_denominator
print_run_number  print_run_denominator      -- all 54.8%, all the same value
print_run_numerator                          -- 46.4%
```

`54.8%` six times over is not six observations, it is one observation copied six
times. One field plus a parser is the same information at a sixth of the tokens.

## What this predicts

Dropping the twelve never-filled fields, the four derived fields and five of the
six print-run duplicates removes roughly 21 of the ~50 emitted keys, and those
keys are disproportionately the ones carrying `null`. If output falls from 825
tokens to ~150, latency should fall from 15.3s to ~2.8s at the same generation
rate.

**That prediction is the test.** If output drops by 80% and latency does not
drop roughly proportionally, then latency is not output length and the whole
diagnosis in the brief is wrong — report that rather than tuning around it.

## What this does not license

Nothing here says the pipeline should stop *having* these fields. It says the
provider should stop being asked to *fill* them, because filling a field it
cannot see is what produced `2021 Panini Contours JALYN DANIELS`. The derived
four come back from the world engine; the never-filled twelve come back as the
empty they already were.
