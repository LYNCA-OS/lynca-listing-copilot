# CSM thin Preview acceptance — 2026-08-01

## Decision

The CSM thin path is accepted as a release candidate, not as proof of commercial
accuracy. The accepted production shape is one direct Luna request followed by
CSM/SEM resolution, marketplace composition, and one atomic Supabase packet.
Cloud Run, OCR, vector retrieval, and legacy V4 execution are outside this path.

The release remains gated on a clean main commit, the production environment
readiness check, and an authenticated production smoke. Preview evidence must
not be represented as production evidence.

## Accepted Preview

- Deployment: `dpl_2MfKniMBYMcGScWXdFpVCp3kLbrz`
- URL: `https://lynca-listing-copilot-6zrfc4ks9-lyncafei-s-projects.vercel.app`
- Runtime route: `CSM_THIN_DIRECT`
- Model: `gpt-5.6-luna`
- Requested and served reasoning effort: `none`
- Image detail: `high`
- CSM persistence: configured and ready
- Retired Cloud Run, vector, and OCR execution: disabled
- Scheduler window: 120 jobs
- Provider burst guard: 83 active requests

The URL is Vercel-protected. Acceptance used authenticated Preview access and
the existing application session; an unauthenticated request stopped at the
Vercel protection boundary and did not invoke the provider.

The accepted Preview predates the final fail-closed check for the inverse
`V4_QUEUE_PUMP_DISABLED=true` flag. Production readiness additionally requires
that explicit value; route retirement and cron removal are not treated as a
substitute for stopping the old pump.

## End-to-end persisted evidence

### Fresh TCG projection-ledger canary

- Session: `csmsess_82af8c9f6ac31e7e865192ce65ac92814b4d5ee7`
- Intent: `preview-acceptance-20260801-tcg-projection-v5`
- Asset: `asset_c0b0cc0e-43d1-40e4-89a7-07809a494d39`
- Output: `2025 Pokemon JP Mega Absol ex Special Art Rare #089/063 Rainbow Holo CGC 10`
- Length: 75 characters
- Latency: 4,451 ms
- Tokens: 5,402 input and 105 output
- Stored rows, in stage order: 9 evidence, 17 candidates, 9 links, 1
  resolution, 17 resolved brackets, and 1 marketplace output
- Recognition packet SHA-256:
  `cb187b1d4890833f3cee14431dc920cbd5994304dd20dc807bc37e6c233dd468`
- Resolution packet SHA-256:
  `ac8cee6d6f37d976f38f799a29112202323569c88f9480ae4aabcd62acdaf5d8`
- Marketplace packet SHA-256:
  `48a4d2bab54870fbbc5f7d93b2926bc59d47f6aa738a981f7c75928532933193`
- Projection ledger: `product` dropped for the 80-character budget;
  `search_optimization` suppressed by the marketplace profile; nothing
  restored; `truncated=false`.

An independent remote read verified both canonical originals, all six CSM
tables, all three `COMPLETE` stages, all three hashes, the four projection
ledger keys, and an exact replay of the stored 75-character title.

### Non-TCG grammar canary

- Session: `csmsess_cf0b4b620f72607bde0c176274463b9bae81d881`
- Output: `2024 Panini Donruss Optic Downtown Legends Adrian Peterson 25/25 PSA 10`
- Length: 71 characters
- Latency: 3,593 ms
- Tokens: 4,768 input and 116 output
- Stored rows: 10 evidence, 17 candidates, 10 links, 1 resolution, 17
  resolved brackets, and 1 marketplace output

An independent remote read also replayed this output exactly. Together the two
canaries prove that the deployed path can persist and replay both COS-8
standard grammar and COS-9 TCG grammar. They do not prove that every recognized
field is correct.

## Defects found by the acceptance run

The first successful canaries exposed a silent projection bug: orchestration
passed public keys named `dropped_brackets`, `suppressed_brackets`, and
`restored_brackets` to a persistence builder that expected `dropped`,
`suppressed`, and `restored`. JSON serialization consequently retained only
`truncated=false`. The fresh TCG canary above was created after the mapping was
made explicit and is the acceptance evidence for the repair. The two older
canaries remain valid grammar and replay evidence, but not projection-ledger
evidence.

Earlier failed Preview attempts were pre-provider schema/session failures or
ambiguous post-provider persistence failures. Their operation identities were
not reused. The production dispatcher retries only failures proved safe before
the paid boundary or failures explicitly classified as safe by the durable
provider authority. A lost response after provider start remains ambiguous and
requires lookup, not a duplicate provider call.

The legacy `v4_recognition_sessions` root can remain `CREATED` while the CSM
stages are complete. On the enabled thin path, the UI consumes the direct
`PERSISTED` response and never polls that legacy root. Backfilling the root
would create a second source of truth, so the CSM stage rows and marketplace
output are authoritative.

## Accuracy boundary

Technical replay and grammar correctness are not commercial exactness:

- TCG reviewed reference: `2025 Pokemon JP Mega Absol Ex Mega Brave 089/063 Special Art Rare - Holo SAR CGC 10`.
  The fresh output retains the IP, language, subject, number, expanded rarity,
  finish, and grade concepts, but loses the `Mega Brave` set and the explicit
  `SAR` token. This is useful output, but one card cannot establish an accuracy
  rate.
- Non-TCG reference: `2024 Panini Donruss Optic Adrian Peterson Downtown Legends Black Auto PSA 10`.
  The canary omitted `Auto`, rendered a more specific observed finish in the
  CSM evidence, and added `25/25`. That is not an exact reference match.
- A title-only SEM parser can misclassify a TCG title when COS-9 correctly omits
  low-priority manufacturer/product tokens. Stored structured CSM fields, not a
  reparsed title, remain the authority. The parser should learn set/IP aliases
  such as `Mega Brave -> Pokemon`; it must not force manufacturer back into the
  composed title.

Against the reviewed TCG reference, v4 and v5 both had fair token recall
`0.866667`. V5 improved the formal SEM projection from `0.24` to `0.64` by
restoring the TCG IP and making the card number parseable, but remained below
the `0.87` acceptance threshold. It traded the prior missing `Pokemon` token
for a missing `Mega Brave` set token; `set` remained empty in CSM. This canary
therefore proves the projection-ledger repair and an IP/parser improvement, not
a net title-quality gain.

## Measured accuracy assets retained

- Canonical high-100 baseline: F1 `0.769802`.
- Safe Composer recovery for the 53 canonical-retained/Composer-missed cases:
  high-100 F1 `0.769802 -> 0.775466`, 9 wins, 0 losses, and no title over 80
  characters. The same rule was non-negative on the current-148 and old-v3
  replays, so it is retained.
- Of the 73 exhaustive-expressed/canonical-missed observations, only 37 were
  direct field recoveries across 29 cards; 8 were synonyms, 19 candidate-only,
  and 9 wrong-role. That set is an evidence-sidecar opportunity, not authority
  for an automatic resolver. The candidate resolver remains `NO_GO` until a
  paired held-out test proves positive value.
- Exhaustive output was about 13.83 times longer and had title F1 `0.118089`.
  It is retained only as a diagnostic experiment, not a runtime mode.
- `high` remains the production image detail. The paired `original` experiment
  did not prove a gain large enough to justify its extra payload and latency.

## Capacity and multi-tenant policy

The request quota is not the steady-state bottleneck. With a measured mean of
5,277.19 tokens per card and a 4,000,000 TPM hard limit:

`4,000,000 / 5,277.19 = 757.98 requests/minute`.

At the 90% operating target, the budget is about 682 requests/minute. With the
measured mean service time, Little's Law places the sustainable active-request
sweet point near 28.4; the hard-limit equivalent is about 31.5. Production
should therefore begin at 30 genuinely active provider requests, while keeping
120 scheduler slots for queued multi-tenant work and an 83-request short-burst
ceiling. A 5,000 RPM headline is not a license for 5,000 sustained Luna calls;
TPM is reached first.

Tenant fairness should use a shared global token bucket plus per-tenant
deficit-round-robin queues. Idle tenants lend their unused share; a busy tenant
may borrow it, but no tenant may reserve capacity while idle. On 429 or rising
TPM pressure, reduce the active window before adding retries. Retries reuse the
same operation identity and consume no second provider call after an ambiguous
outcome.

## Release gates

1. COS-25 and COS-26 have detailed evidence comments and are `Done` in Linear.
2. The canonical Supabase ledger is exact and the additive provider-admission
   migration is applied; no migration-history repair or broad `db push` is
   allowed.
3. The complete repository test suite passes with provider and Supabase
   credentials removed from the process environment.
4. The release commit must be merged to `main` before production deployment.
5. Production health must report CSM persistence and provider readiness, Luna
   `none`, zero Cloud Run/vector/OCR calls, and all retired execution flags off.
6. Authenticated production smoke must prove the new route and retired-route
   probes must return `410`; one real-card smoke is sufficient and must use a
   new operation identity.
