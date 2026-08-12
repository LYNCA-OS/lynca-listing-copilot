# COS-63 Founder Beta MVP

Date: 2026-08-12

Status: dormant/shadow selectable; Production unchanged

## One decision

Keep the current execution chain and let the same `gpt-5.6-luna` low-effort
Responses request decide whether built-in Web Search is needed. The request has
`tool_choice: "auto"` and `max_tool_calls: 1`. There is no second model call,
application-side search, retry path, new Runtime, database writer, or migration.

## Executable semantic amendment

This is the versioned successor to the COS-56 `Product > Set > Card Name`
heuristic; it does not rewrite the historical decision or its replay bytes.

- **Set** is a collection/checklist container. A projected Set requires a
  `CURRENT_CARD_MEMBER_OF_SET` relationship from the current-card fact.
- **Card Name** is a printed name for this card or design. A projected Card
  Name requires `CURRENT_CARD_NAMED_BY_DESIGN` from the current-card fact.
- One normalized phrase cannot occupy both roles. A missing/wrong relationship
  fails validation rather than silently moving the string between fields.
- The field-only confusion evaluator reads no title and reports Set -> Card
  Name, Card Name -> Set, duplication, omission, and unexpected values.

The dormant `lynca-standard-name-v0.3` profile renders
`Set -> Card Name -> Subject`. Subject remains mandatory under the 80-character
optimizer. v0.1 and v0.2 remain byte-replayable, and v0.2 remains active.

## Minimum Web receipt

The response adapter derives, rather than trusts, one receipt containing:

- one provider request, zero isolated model calls;
- exact served `gpt-5.6-luna` model and `low` reasoning effort;
- Web Search used/count and query strings;
- sanitized HTTPS source URLs returned by the provider tool trace;
- per-field supporting, conflicting, and unresolved URLs;
- the validated semantic-state hash.

A model-cited URL must occur in the provider-returned tool sources or
annotations. HTTP, credentials, ports, overlong URLs, unreturned URLs, more
than one Web Search call, and sources without a tool call fail closed. Query
strings and fragments are removed from the public receipt. Current-card image
evidence remains authoritative for card number, serial, grading, finish,
surface/parallel identity, and special stamps when Web evidence conflicts.

## Preserve / absorb / defer

- **Preserve:** one Luna-low request, approved images, current physical-fact
  authority, strict schema, deterministic 80-character Composer, historical
  profile replay and rollback.
- **Absorb:** autonomous built-in Web Search and source-linked identity
  resolution inside that one response.
- **Defer:** Production activation and live paid acceptance.
- **Out of scope:** broad Registry work, domain-ranking systems, auth, tenant,
  queue, concurrency, storage, database topology, UI, deploy, or migration.

## Evidence and activation gate

Focused tests must prove no-search and search-used responses, the one-tool-call
budget, URL sanitation/rejection, support/conflict/unresolved mapping, relation
validation, title-independent confusion counts, v0.3 order, mandatory Subject,
and unchanged v0.1/v0.2 output. A later explicit activation must additionally
prove one fresh no-search Writer Journey and one fresh search-used Writer
Journey, both provider attempt one/retry zero, before COS-59 is Done.
