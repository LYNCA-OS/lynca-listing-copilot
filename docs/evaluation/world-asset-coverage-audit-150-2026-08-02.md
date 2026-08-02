# Source-versioned world asset coverage audit — fresh150

## Decision

The opposing hypothesis wins: a larger generic player/team knowledge base is not the current accuracy optimum. Existing world assets produce only **1 final-title correction** and a +0.000606 replacement oracle, just 3.0% of the requested +0.02 contribution. Team ranking is already negative.

- **STOP current assets for accuracy promotion.** Product-year has a useful candidate-level signal, but the resolver/Composer consumes none of its 15 wins in the current final titles.
- **STOP local official data alone.** Its 143 required records contain 15 product-set pairs, but **0 product-parallel, 0 set-parallel, and 0 product-set-parallel tuples**. It physically cannot validate the largest finish ambiguity head.
- **GO build one minimal source-versioned release identity graph**, centered on release/year/product/set/parallel/finish, then run a full 150-card resolver+Composer counterfactual. This is an asset-build decision, not production approval.

Provider calls: 0. Runtime/Production changes: 0.

## Relation coverage and risk

| relation | supported cards | candidate-rank changes | final-title corrections | correct-value false-reject risk | decision |
|---|---:|---:|---:|---:|---|
| subject_year | 10 | 4 | 1 | 28.0% | HOLD_SUPPORT_ONLY_NO_HARD_REJECT |
| subject_team_year | 31 | 9 | 0 | — | STOP_NEGATIVE_AND_SEMANTICALLY_POLLUTED |
| subject_character_ip | 0 | 0 | 0 | — | STOP_MISSING_RELATION |
| product_year | 46 | 15 | 0 | 34.7% | HOLD_CANDIDATE_SIGNAL_BUT_RESOLVER_DOES_NOT_CONSUME_IT |
| set_product_year | 4 | 0 | 0 | — | STOP_NO_TYPED_SCREEN_AND_KNOWN_FALSE_ENUMERATION |
| release_product_set_parallel | 5 | 0 | 0 | — | GO_BUILD_SOURCE_VERSIONED_RELATION_ASSET_STOP_CURRENT_GRAPH |

Two existing relations prove why advisory-only is a hard boundary: treating missing edges as contradictions falsely rejects 28.0% of covered correct subject-years and 34.7% of covered correct product-years. The team relation contains at least 784 visibly non-team or ambiguous edges and scored 1 win / 6 losses.

## Where +0.02 could physically come from

| relation-addressable precision scope | extra tokens | cards | delete-label oracle delta |
|---|---:|---:|---:|
| subject_year | 15 | 14 | 0.003327 |
| release_identity | 103 | 66 | 0.023747 |
| subject_ip_team | 19 | 8 | 0.003701 |
| finish_parallel | 91 | 57 | 0.022958 |
| combined_world_scope | 228 | 104 | 0.056275 |

These are deliberately impossible label-reading oracles: they delete every candidate token that the one writer omitted, including potentially valid facts. They measure mass, not expected gain. Even deleting all 33 independently clear factual-error tokens adds only 0.007838, so clear precision corrections alone cannot deliver +0.02.

| greedy precision-only scope | +0.02 reachable | high-impact cards needed | tokens removed | achieved delta |
|---|---:|---:|---:|---:|
| subject_year | no | 14 | 15 | 0.003327 |
| release_identity | yes | 48 | 85 | 0.020080 |
| subject_ip_team | no | 8 | 19 | 0.003701 |
| finish_parallel | yes | 44 | 78 | 0.020076 |
| combined_world_scope | yes | 21 | 89 | 0.020647 |

The combined relation oracle needs at least 21 concentrated high-impact cards; current verified coverage is 1. Finish-only would need 44 of its affected cards, and release identity alone 48. This is why raw edge counts are the wrong KPI: the asset must change a typed final field on high-impact cards.

On recall, world-family losses cover at most 34/255 (13.3%) of exhaustive-not-expressed occurrences. A ranker cannot recover facts Luna never emitted.

## Minimal asset, not a generic world model

The first asset is an append-only edge table with: `edge_id`, `subject_type`, `subject_normalized`, `predicate`, `object_type`, `object_normalized`, `release_id`, `valid_from`, `valid_to`, `category_or_ip`, `source_url`, `source_sha256`, `source_version`, `evidence_type`, `coverage_contract`, `confidence`, `adjudication_status`. Every edge carries source version and provenance. Coverage remains positive-only; absence is UNKNOWN.

Priority is release/year/product/set/parallel/finish, then character/IP/release identity, then versioned product-year/set-product. Player-team-year comes last, after semantic cleanup, because it has low marketplace value and current negative evidence. Serial numbers stay outside the world model: they require visible transcription, not background knowledge.

## Offline counterfactual gate

1. Freeze the Luna candidate multiset and type phrases before ranking.
2. Stable-rank only candidates with positive source-backed edges; never create, mutate, delete, or reject visible evidence.
3. Replay the full CSM/SEM resolver and the same 80-character Composer on all 150 cards.
4. Require final macro F1 Δ ≥ +0.02, wins > losses, zero numeric/subject critical regression, zero candidate mutation, and zero protected-visible rejection.
5. Run shuffled-edge, longest-candidate, and source-removed controls; the reference title never enters the ranker.

Until that gate passes, the result remains **STOP for runtime and Production**.
