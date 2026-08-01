# Candidate expression v3: mechanism6 result (2026-08-01)

## Decision

`STOP`. Do not run this arm on the confirmatory 50-card cohort.

The arm is a useful learning asset but not a runtime asset. It proves that a
candidate-first response can recover one identity atom that v2 compressed, but
it still misses the one target that requires semantic synthesis and produces
too much low-value literal text.

## Bound result

- arm: `candidate_expression_v3_high`
- model / effort / detail: `gpt-5.6-luna` / `none` / `high`
- cohort: six known identity misses; mechanism use only
- completion: 6/6, one provider attempt per card
- candidate facts: 88 total; 11--16 per card
- target capture: 5/6
- model-knowledge candidates: 0
- canonical fields or production promotions: 0
- parser/schema defects: one duplicate candidate on one card
- input / output / total tokens: 24,470 / 3,078 / 27,548
- median output tokens: 526, above the pre-registered 400 cap
- median total tokens: 4,589
- median latency: 20,191 ms; observed range 6,544--38,055 ms

The gate's hard failures are:

1. `Draft` was not captured for the Leaf Metal card;
2. one response repeated an identical candidate;
3. median output tokens exceeded 400.

The machine-readable decision is in
`artifacts/candidate-expression-v3/mechanism6/gate.json`.

## What improved

| Target | v2 semantic identity | v3 candidate expression | Result |
|---|---|---|---|
| `Draft` | missing | missing | no gain |
| `VeeFriends` / Common Sense Cow | missing | visible logo plus `VeeFriends, LLC` | recovered |
| `MJx` | present | visible `mjx` logo | retained |
| `VeeFriends` / Adaptable Alien | present in canonical set | visible logo | retained |
| `Star Wars` | present | visible front logo and back text | retained |
| `UFC` | present | visible logos and text | retained |

The strict v2 product gate captured 3/6; counting v2's legal identity family
(`product + set + IP`) gives 4/6. V3 captured 5/6 without canonical fields. The
increment is specifically Common Sense Cow's `VeeFriends`, which is visibly
printed on the back but was discarded by v2's copy-only residual ledger.

## What did not improve

The prompt permitted card-world knowledge, but Luna emitted zero
`model_knowledge` facts and marked all 88 candidates as certain. It copied
literal text until the candidate budget was nearly full instead of synthesizing
`Leaf Metal Draft`.

The ledger also spent capacity on facts that a listing does not need:

- company/legal entities such as `ZUFFA, LLC`, `Lucasfilm Ltd.`, and
  `The Upper Deck Company, LLC`;
- slogans such as `THE FORCE IS WITH YOU!` and `Survival favors the flexible.`;
- game facts such as `February 14, 1990`, `135-129`, `12`, and `23`;
- duplicate front/back subjects and brands.

The broad labels are suggestions, not truth. `VF` and `VT` were labeled as
finish candidates; `USA` was labeled as language; `Brian Gray` was labeled as
identity. There were only two `finish` candidates in all 88 facts, and neither
was a valid reviewed finish. The arm also omitted Common Sense Cow's visible
`07/10`, so it avoided v2's wrong `1/10` but did not recover the serial.

## Cost interpretation

The output-only cap correctly stops this pre-registered run, but it is not the
right long-term cost objective by itself. Compared with v2 on the same six
cards, v3 used 51.5% more output tokens but 30.6% fewer input tokens; total
tokens fell from 37,296 to 27,548, a 26.1% reduction. Future gates should bind
total provider cost/tokens and useful target capture, while retaining a
separate upper bound against exhaustive-output bloat.

This observation does not change the v3 decision after the fact: the missing
`Draft` target and lack of any knowledge synthesis independently require
`STOP`.

## Next minimum experiment

Do not make the candidate list larger. Split perception from synthesis inside
the same response:

1. a smaller visible-fact ledger that excludes companies, slogans, biographies,
   game statistics, and repeated front/back facts;
2. a required one-to-three-item `identity_hypotheses` ledger produced after the
   visible facts, with concise supporting values and explicit
   `visible_combination` versus `model_knowledge` derivation.

This is a positive expression obligation, not canonical-field authority. Its
six-card mechanism gate should require all six targets inside identity
hypotheses, zero canonical/persistence writes, and total-token cost below the
v2 mechanism arm. A pass still leads only to zero-cost resolver replay.

Finish and serial should remain separate experiments. This run shows that a
general open candidate list does not cause Luna to name the exact finish or
read small stamped numbering more accurately.

## Reproducible artifacts

- `artifacts/candidate-expression-v3/mechanism6/thin-path-gpt-5.6-luna.jsonl`
- `artifacts/candidate-expression-v3/mechanism6/thin-path-gpt-5.6-luna.manifest.json`
- `artifacts/candidate-expression-v3/mechanism6/gate.json`
