# COS-59 Listing Copilot drift audit

Date: 2026-08-11

Audited revision: `de55b031523237fc5572523886e25e7d3a1529d8`

Authority: COS-58, COS-59 and COS-60
Linear receipt: COS-59 comment `d3144ad1-ac4f-4159-a903-669c1d979882`

This audit was published to Linear before implementation began. It separates
strategy semantics from the execution chain so that a naming improvement cannot
silently change authentication, storage, provider authority, persistence,
concurrency or release behavior.

## Contrary hypothesis and decision

The visible gap with Codex is not proof that `reasoning.effort=low` is wired
incorrectly. A current-contract, cloud-hosted paired run found that `none` was
faster, but introduced hard errors including `50/50 -> 30/50`, an unsupported
`Refractor`, and `Jersey -> Patch`. The higher-confidence common cause is the
output profile: all sixteen low and none sessions persisted a Card Number, and
the current Composer suppressed it in all sixteen outputs.

Production therefore remains on `gpt-5.6-luna` with low effort. The immediate
repair belongs to the versioned Composer profile, not the reasoning setting.

## Drift findings

| Current behavior | Classification | Required convergence |
| --- | --- | --- |
| `ebay-profile-v1` suppresses `card_number` for Standard and Lot titles. | Replace artificial output constraint. | COS-60 makes Card Number a P0 machine-identity anchor; canonical value has no `#`, display value does. |
| `DROP_ORDER.standard` begins with `card_number` and directly drives whole-bracket deletion. | Replace artificial output constraint. | Separate selection priority from fixed render order and preserve full serial as P0. |
| The strict canonical object is treated as the complete model understanding. | Reinterpret now; replace incrementally. | Keep the canonical projection as an audit/interoperability view and define a richer Collectible Semantic State separately. |
| Recognition and Identity Resolution are persisted as cognitive boundaries. | Reinterpret as audit views. | Preserve stage records without requiring future frontier-model cognition to be split into isolated calls. |
| Production gives the model images and a strict schema but no governed general research tool. | Defer. | Define source, citation, conflict, budget, single-attempt and evaluation contracts before adding research. |
| Phrase repair, narrow vocabularies and parent inference partly simulate collectible expertise. | Split. | Preserve formatting, deduplication, budget and anti-fabrication invariants; retire expertise-simulating rules only through grounded-understanding evaluation. |
| Marketplace output is effectively one `EBAY` 80-character profile. | Replace incrementally. | Add a versioned LYNCA Standard Name profile and represent other target profiles in the contract. |
| Existing trace does not fully distinguish selected, omitted, abbreviated, transformed and rejected tokens. | Replace in COS-60. | Emit a machine-readable profile decision trace. |
| Auth, tenant/storage isolation, idempotency, one-paid-attempt authority, persistence, replay, rollback lineage and protected release gates. | Preserve safety/infrastructure. | No change in the COS-60 vertical slice. |
| Writer feedback is `ADMIN_TEST_ONLY` with durable `OBSERVE_ONLY`, never single-record truth. | Preserve governance boundary. | No change. |

## Minimal architecture delta

```text
supported canonical projection
-> profile token candidates
-> selection priority under the target budget
-> fixed profile render order
-> title plus decision trace
```

The COS-60 slice adds a new LYNCA Standard Name profile and Composer version.
It does not modify the Luna request, recognition schema, semantic truth,
provider-call count, persistence authority, queueing, authentication, storage,
concurrency or release workflow. Historical Composer/profile dispatch remains
literal and executable so previously persisted titles do not change on replay.

## Evaluation contract

Results are reported separately for:

1. grounded understanding;
2. target-profile projection fitness;
3. Writer Journey reliability;
4. Production integrity and latency.

The three COS-60 fixtures must be exact. The sixteen current low sessions are
then replayed without a provider call to test the profile. A Composer may expose
supported Card Number and full serial values, but it may not repair an observed
identity error such as `CPALD` versus `CPA-LD` by guessing.

Five of the sixteen raw Codex titles exceed the Production 80-character limit,
so raw string equality and the current length contract cannot both hold. The
valid target is an evidence-grounded title that is exact under the versioned
LYNCA profile; a Codex error or over-budget string is not copied merely for
parity.

## Deferred work

- governed external research and citation-bearing evidence;
- a richer Collectible Semantic State and any associated migration;
- broader output-profile families;
- removal of expertise-simulating phrase/candidate rules after separate evals.

None of these may ride along with the COS-60 Composer-only change.
