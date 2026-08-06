# Bounded Evidence v2: mechanism6 result (2026-08-01)

## Decision

`STOP`. Do not expand this treatment to the confirmatory 50-card cohort.

This is a mechanism failure, not a throughput failure. All six direct local
requests completed successfully on the first provider attempt, but the
pre-registered target channel was incomplete and one promoted serial reading
was critically wrong.

The result supports a narrower principle: increase the model's observation and
expression bandwidth first, but keep that output append-only until a separate,
deterministic CSM/SEM admission step has established that a candidate is safe.
It does not support giving an open expression channel production authority.

## Bound run contract

- arm: `thin_canonical_bounded_evidence_v2_high`
- model / effort / image detail: `gpt-5.6-luna` / `none` / `high`
- cohort: `mechanism6`, six known product-token misses
- selection role: `mechanism_probe_known_wins`
- run fingerprint: `5c952431b5e3678991e560d1f0871d66af4165c2ef05f82249ea053cb2716abf`
- cohort asset hash: `075c6f877e0582c63310cc58a90fee47475ed1b7ed63e091c78f5a95bf0e0880`
- completion: 6/6 rows, 0 duplicates, one attempt per row
- usage: 35,264 input tokens, 2,032 output tokens, 37,296 total tokens
- latency: 25,587 ms median; 7,940--37,013 ms observed range
- title score on this deliberately difficult mechanism set: F1 0.662959
- same-response resolver delta: 0.000000; 0 wins / 0 losses / 6 ties
- subjects: 6/6 correct
- exact reviewed finish: 0/6 correct
- cards whose reviewed title requires a serial: 1/4 correct, 1/4 critically
  wrong, 2/4 omitted

## Per-card account

| Target | Canonical/evidence outcome | Final-title result | Earliest material loss |
|---|---|---|---|
| `UFC` | canonical product `Topps Chrome UFC`; evidence only `Topps Chrome` | target retained, but `Silver Prismatic` conflicts with reference `Refractor X-Fractor` | finish perception / world-knowledge compatibility |
| `VeeFriends` (Common Sense Cow) | absent from canonical and evidence | target missing; `Purple Sparkle` conflicts with `Black Mini Diamond Refractor`; `1/10` conflicts with visibly stamped and reviewed `07/10` | model expression/perception, before admission |
| `Draft` | canonical product stops at `Leaf Metal`; evidence also stops at `Leaf METAL` | target missing; `Portrait` and `Super Gold` also missing | model expression, before admission |
| `Star Wars` | canonical product and printed evidence both retain `Star Wars` | target retained, but year `2025` and `Smugglers Outpost` are missing while `Chrome Black` is an unsupported replacement relative to the reviewed title | identity completion remains incomplete |
| `VeeFriends` (Adaptable Alien) | represented in legal canonical `set`, not in the pre-registered product/evidence target channel | final title retains `VeeFriends`; product `Topps Chrome` is dropped under TCG grammar; `Orange Sparkle` conflicts with `Orange Mini Diamond Refractor`, and `/25` is missing | field allocation is usable, finish/serial perception is not |
| `MJx` | canonical product `Upper Deck MJx`; evidence contains literal `mjx` | target retained; `Timepieces`, `Bronze`, and `102/230` are missing, replaced by `MJ Timeline Silver Holo` | downstream target succeeds, other identity/finish/serial facts fail earlier |

Semantic identity was present somewhere in the canonical object for four of six
cards when `set` is counted. The pre-registered mechanism gate correctly counts
only three canonical-product rows, plus one product-like evidence row, because
changing the target channel after seeing the result would invalidate the test.
No expressed target was lost during admission. Composer's one explicit identity
loss was `Topps Chrome` on Adaptable Alien; the two genuinely missing targets,
`Draft` and Common Sense Cow's `VeeFriends`, were absent before admission.

## Why v2 failed

1. The response still begins with a closed canonical form. The appended ledger
   is described as `SMALL`, only for facts the model "could not safely type",
   and says "empty is better than noise". That encourages the same compression
   behaviour the experiment was intended to measure.
2. `exact_text` is copy-only. It cannot preserve a useful model hypothesis such
   as `VeeFriends` from a `VF` mark or `Leaf Metal Draft` from card identity when
   the whole phrase is not printed contiguously.
3. The ledger mixes observation with renderer authority. A single model reading
   of a stamped number is not independent verification. On Common Sense Cow,
   both the canonical field and ledger repeated the same wrong `1/10`, while an
   original-resolution crop clearly reads `07/10`.
4. The evidence resolver has no product resolver, so the treatment and its
   canonical control necessarily composed identical titles. The zero delta is
   therefore a real mechanism result, not evidence that extra expression has
   no value.

## Cheapest next experiment

Do not spend 50 more calls on v2. Build one evaluation-only, one-call v3 whose
response is a standalone open-set `candidate_facts` channel, not canonical
fields with another residual ledger appended. Each candidate should retain a
phrase, its visible or model-knowledge basis, image provenance, and uncertainty.
It should explicitly preserve the most specific identity, finish, year, and
stamped-number candidates even when they conflict or their CSM role is not yet
known.

The first resolver remains zero-cost and append-only. It measures where a
reference-supported atom exists; it does not write CSM/SEM. Only after the same
six-card mechanism probe demonstrates capture without a critical false
promotion should a fresh, label-blind confirmatory cohort be called.

Serial candidates get no automatic renderer authority in v3. A wrong serial is
more damaging than an omitted serial, and model self-repetition inside one
response is not corroboration.

## Reproducible artifacts

- `artifacts/bounded-evidence-v2/mechanism6/thin-path-gpt-5.6-luna.jsonl`
- `artifacts/bounded-evidence-v2/mechanism6/thin-path-gpt-5.6-luna.manifest.json`
- `artifacts/bounded-evidence-v2/mechanism6/promotion-labels.jsonl`
- `artifacts/bounded-evidence-v2/mechanism6/helpful-evidence-labels.jsonl`
- `artifacts/bounded-evidence-v2/mechanism6/gate.json`
