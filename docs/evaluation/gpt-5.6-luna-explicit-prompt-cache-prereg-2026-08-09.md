# GPT-5.6 Luna explicit prompt-cache cloud screen — preregistration

## Decision

`READY_FOR_PREVIEW_PREFLIGHT`; paid execution is
`HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED`. Nothing has been executed and
this is not a Production recommendation.

The contrary hypothesis is the default: explicit caching is a net loss if the
stable prefix is shorter than 1,024 tokens, if a second identical request does
not produce a cache read, or if changing only the synthetic image invalidates
the read. Any one of those observations stops this mechanism. Character and
JSON byte counts are not substituted for provider token receipts.

The screen is isolated under `experiments/vercel-capacity-probe`, defaults to
`execution_authorized=false`, uses the existing cloud-only `OPENAI_API_KEY`,
and cannot route into the Production API. No key is copied to the local
checkout. The zero-call preflight receipt is bound to the exact Preview
environment, Singapore region, deployment id, immutable deployment hostname,
and release Git SHA. A saved receipt plus the explicit CLI flag
`--execution-authorized` is necessary but deliberately insufficient for paid
execution.

The capacity lab has a durable local checkpoint, but no Preview-side shared
authority that can atomically claim a run id exactly once. A stateless
function and a local file cannot prevent two clients from spending the same
run concurrently. The endpoint therefore returns
`HOLD_DURABLE_SINGLE_USE_AUTHORITY_REQUIRED` with `provider_calls=0`. It does
not borrow Production Supabase service-role access and does not add a KV just
for this screen.

Current evidence: provider calls `0`; deployments `0`; accuracy claims `0`.

## Why this screen exists

OpenAI's GPT-5.6 caching behavior does not fall back to the longest unmarked
stable prefix when the implicit breakpoint contains changing content. The
official guide recommends placing an explicit breakpoint at the end of stable
content, reusing a `prompt_cache_key`, and setting
`prompt_cache_options.mode="explicit"` so the changing suffix is not repeatedly
written. It also states that GPT-5.6 needs a strict minimum 1,024-token prefix,
that structured-output schemas can be cached, and that Responses usage reports
reads in `cached_tokens` and writes in `cache_write_tokens`.

Sources:

- [OpenAI Prompt Caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI GPT-5.6 model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI GPT-5.6 Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

The current stable material is the exact Production structured-output schema
plus the exact Production input text. The text is 2,782 bytes and the schema
is 7,984 bytes, but only the provider's token receipts can establish whether
the rendered prefix crosses 1,024 tokens.

## Frozen request boundary

The experiment builds the request through the active Production provider
adapter with the active Luna controls, then adds only three transport fields:

- `prompt_cache_key` at the request root;
- `prompt_cache_options={mode:"explicit",ttl:"30m"}`;
- `prompt_cache_breakpoint={mode:"explicit"}` on the stable `input_text` block.

Removing those fields must recover the Production request bytes exactly. The
frozen semantic contract is:

| field | preregistered value |
|---|---|
| model | `gpt-5.6-luna` |
| reasoning effort | `low` |
| image detail | `high` |
| max output tokens | `8192` |
| prompt SHA-256 | `fa248c5cd3b0f52bfa3554bbe96d4a84d80de94f6cc3e003494e09d75793efc7` |
| schema SHA-256 | `ec1f0851a88c41a73858fc657cc6f7611d030b3fdaf08ae9e0d390fde5be3197` |
| stable-prefix SHA-256 | `f14c18ceb882c8ad47aa946cb728690deac368405ccbf5465a7f5eadf9990f9b` |
| image-normalized semantic SHA-256 | `63045a2ed07f90f7221ba9e1a226eae53f40ff63ce986c287dee694566aa249d` |

Each row records a `semantic_request_sha256` after cache fields are removed and
a separate `transport_request_sha256` with cache controls present. The cache
policy id and hashed run-scoped key are transport receipts. A cache shard key
never enters the semantic operation identity; changing a shard must not create
a new logical recognition operation or justify another paid recognition call.

## Sequential experiment

One 96 x 128 synthetic PNG is used for the first two requests and a distinct
synthetic PNG for the third. Neither model output nor a title is scored.

1. `same_card_cold`: require `cached_tokens=0` and
   `cache_write_tokens>=1024`.
2. `same_card_warm`: same full request bytes; require
   `cached_tokens>=1024` and `cache_write_tokens=0`.
3. `cross_card_warm`: identical stable prefix and cache key, different image
   bytes; require `cached_tokens>=1024` and `cache_write_tokens=0`.

The calls are sequential, with zero retries. A received HTTP/provider failure,
missing usage receipt, incomplete response, wrong model, cache rewrite on a
warm step, or insufficient read stops before the next request. A fetch/Abort
exception is not a definite failure: the request may have reached the
provider, so it is durably recorded as `AMBIGUOUS_PROVIDER_OUTCOME` with the
known call-attempt count and `retry_allowed=false`. A lost Preview response is
also durably marked ambiguous and is never automatically retried.
The one experiment key is derived from a fresh run id. If that id was already
used and the nominal cold call reports any cached tokens, the screen classifies
the cold baseline as polluted and stops after that first call.

Passing all three steps means only `PASS_CANDIDATE_NOT_PRODUCTION`: explicit
cross-image prefix reuse exists for this request shape. It does not establish
an accuracy gain, a latency distribution, a Production cache hit rate, or a
promotion decision.

## First-principles cost condition

For the reusable prefix alone, Luna lists uncached input at 1.0 relative cost,
cached reads at 0.1, and GPT-5.6 cache writes at 1.25. Therefore:

- cold write plus one proven read: `1.25 + 0.10 = 1.35`, versus `2.00`
  uncached, a theoretical 32.5% prefix-input saving;
- cold write plus two proven reads: `1.25 + 0.10 + 0.10 = 1.45`, versus `3.00`
  uncached, a theoretical 51.7% prefix-input saving.

This excludes the changing image suffix, output tokens, misses, and operational
traffic shape. The screen must therefore prove both reads before the cost case
is considered real. Three calls are intentionally insufficient for a latency
claim; their latency is retained only as directional diagnostic evidence.

## Artifacts and execution boundary

- Machine preregistration:
  `experiments/vercel-capacity-probe/luna-explicit-cache-prereg.mjs`
- Production-bound local builder:
  `experiments/vercel-capacity-probe/luna-explicit-cache-contract.mjs`
- Preview-safe frozen wire validator:
  `experiments/vercel-capacity-probe/luna-explicit-cache-wire-contract.mjs`
- Preview endpoint:
  `experiments/vercel-capacity-probe/api/prompt-cache.js`
- Fail-closed runner:
  `experiments/vercel-capacity-probe/run-luna-explicit-cache-screen.mjs`

The current turn intentionally stops at zero provider calls. A later execution
must first deploy the isolated capacity lab to an immutable protected Singapore
Preview and save the zero-call preflight. Before the three-call flag can have
any effect, the lab also needs a separately reviewed, least-privilege durable
single-use claim authority; until then the paid path remains HOLD.
