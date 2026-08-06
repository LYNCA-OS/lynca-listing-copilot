# Supabase migration ledger audit — 2026-08-01

This is a secret-free, read-only audit of project `osrrujmpxxiefppjfgpd`. Remote SQL was fetched into an isolated temporary directory and discarded after hashing; no SQL body, connection string, token, or password is persisted here.

## Decision

**DB push is BLOCKED.** The ledger is divergent; receipt `osrrujmpxxiefppjfgpd:csm_atomic_stage_packet_v1:20260801094353` is valid.

| Metric | Value |
|---|---:|
| `local_file_count` | 107 |
| `remote_file_count` | 86 |
| `local_version_count` | 88 |
| `remote_version_count` | 86 |
| `shared_version_count` | 17 |
| `local_only_version_count` | 71 |
| `remote_only_version_count` | 69 |
| `duplicate_local_version_count` | 9 |
| `duplicate_remote_version_count` | 0 |
| `same_name_different_version_mapping_count` | 43 |
| `ledger_exact` | false |
| `db_push_allowed` | false |

Normalization profile: `sql-line-endings-trailing-space-empty-tail-v1`. It only removes representation noise listed in the JSON audit and is not a general SQL semantic-equivalence claim.

## Pinned CSM receipt

The already-applied `csm_atomic_stage_packet_v1` migration is pinned as remote `20260801094353` ↔ local `20260801123000`. A controlled-path request for the local file must fail as already applied; neither DDL replay nor migration-history repair is permitted.

## Guard commands

`node scripts/supabase-migration-ledger.mjs guard-db-push --linked` succeeds only after a fresh linked list/fetch proves an exact ledger. On a divergent ledger, use `guard-single --linked --migration <file> --ack single-migration-only-no-db-push`; success authorizes only that reviewed file and never executes or authorizes `db push`.

## Same-name, different-version mappings

Changed lines are reported as local/remote counts; SQL text is intentionally omitted.

| Name | Local version | Remote version | Content summary | Changed lines |
|---|---:|---:|---|---:|
| `atomic_enqueue_verified_image_set_v2` | `20260717192000` | `20260717120641` | normalized_equivalent | 0/1 |
| `atomic_v4_noncritical_persistence` | `20260712072310` | `20260712073353` | content_changed | 211/147 |
| `atomic_v4_noncritical_persistence` | `20260712072310` | `20260712073552` | normalized_equivalent | 0/1 |
| `atomic_v4_writer_feedback_transaction` | `20260711200533` | `20260712033532` | content_changed | 117/94 |
| `basketball_catalog_v0` | `20260626083423` | `20260626121414` | normalized_equivalent | 1/1 |
| `catalog_anchor_filter_rpc_v1` | `20260704060000` | `20260704032228` | content_changed | 186/169 |
| `catalog_clean_writer_title_tcg_lot_star_v0` | `20260703044509` | `20260703044544` | normalized_equivalent | 1/1 |
| `catalog_clean_writer_title_tcg_sales_terms_v0` | `20260703044401` | `20260703044448` | normalized_equivalent | 1/1 |
| `catalog_clear_unknown_categories_v0` | `20260703041438` | `20260703041702` | content_changed | 59/59 |
| `catalog_first_corrected_title_v0` | `20260626115429` | `20260626121534` | normalized_equivalent | 1/1 |
| `catalog_search_all_categories_v0` | `20260703034116` | `20260703040500` | normalized_equivalent | 1/1 |
| `catalog_search_blob_materialized_v1` | `20260706130000` | `20260706123735` | content_changed | 239/36 |
| `catalog_search_blob_normalization_v1` | `20260724215000` | `20260723213927` | content_changed | 5/3 |
| `cert_registry_v1` | `20260709170000` | `20260709123119` | content_changed | 53/42 |
| `create_v4_fast_scout_cache` | `20260707154500` | `20260713124858` | normalized_equivalent | 1/1 |
| `csm_atomic_stage_packet_v1` | `20260801123000` | `20260801094353` | normalized_equivalent | 0/1 |
| `csm_empty_canonical_sql_null` | `20260801071048` | `20260801071129` | normalized_equivalent | 0/1 |
| `csm_marketplace_trace_object` | `20260801065859` | `20260801065941` | normalized_equivalent | 0/1 |
| `csm_stage_shadow_foundation_v1` | `20260728190000` | `20260801065544` | content_changed | 466/484 |
| `data_loop_workflow_sidecars_v0` | `20260702062734` | `20260702092135` | normalized_equivalent | 1/1 |
| `enforce_catalog_source_graph_consistency` | `20260724050000` | `20260723221636` | content_changed | 103/88 |
| `feedback_workflow_context_v0` | `20260703112438` | `20260710042537` | content_changed | 0/2 |
| `fix_catalog_snapshot_trigger_transition_tables` | `20260725150000` | `20260725143748` | content_changed | 104/78 |
| `fix_track_c_catalog_trigger_when_marker` | `20260717132242` | `20260717132617` | normalized_equivalent | 0/1 |
| `harden_public_function_security_and_queue_heartbeat` | `20260711194540` | `20260711195801` | content_changed | 31/26 |
| `hybrid_unified_catalog_and_indexes_v1` | `20260704070000` | `20260705151414` | content_changed | 242/230 |
| `isolate_marketplace_catalog_products` | `20260724033000` | `20260723215305` | content_changed | 93/73 |
| `listing_identity_cache_terminal_l2` | `20260724` | `20260724073657` | normalized_equivalent | 1/1 |
| `listing_identity_cache_version_contract` | `20260724` | `20260724071411` | normalized_equivalent | 1/1 |
| `listing_image_verified_crop_provenance_v1` | `20260717191000` | `20260717120604` | normalized_equivalent | 0/1 |
| `preingestion_evidence_bundle_v0` | `20260706060115` | `20260706062043` | normalized_equivalent | 1/1 |
| `sem_definition_canonical_v1` | `20260708084634` | `20260708092501` | normalized_equivalent | 1/1 |
| `supersede_stale_writer_learning_events` | `20260712040453` | `20260712040615` | content_changed | 15/12 |
| `track_c_fact_and_storage_boundary_convergence` | `20260717133700` | `20260717140201` | normalized_equivalent | 0/1 |
| `track_c_legacy_asset_parent_convergence_v1` | `20260717190000` | `20260717120526` | normalized_equivalent | 0/1 |
| `track_c_preingestion_ocr_durable_leases` | `20260715065820` | `20260717133218` | normalized_equivalent | 0/1 |
| `track_c_retry_state_machine_hardening` | `20260715065808` | `20260717133210` | normalized_equivalent | 0/1 |
| `track_c_runtime_schema_convergence_v1` | `20260717193000` | `20260717120716` | normalized_equivalent | 0/1 |
| `track_c_schema_attestation_and_tenant_convergence` | `20260717130819` | `20260717132042` | normalized_equivalent | 0/1 |
| `v4_enable_rls` | `20260706094322` | `20260706094456` | normalized_equivalent | 1/1 |
| `v4_queue_deployment_affinity` | `20260719205025` | `20260720020555` | normalized_equivalent | 1/1 |
| `v4_queue_reclaim_expired_running_jobs` | `20260708043000` | `20260708043008` | normalized_equivalent | 1/1 |
| `v4_recognition_spine` | `20260706093000` | `20260706093959` | normalized_equivalent | 1/1 |

## Full version ledger

| Version | Status | Local | Remote | Content summary |
|---|---|---|---|---|
| `20260622` | local_only | `20260622_listing_feedback_v2.sql`<br>`20260622_listing_feedback_v2_rollback.sql`<br>`20260622_listing_image_storage.sql`<br>`20260622_listing_image_storage_rollback.sql`<br>`20260622_listing_image_verifications.sql`<br>`20260622_listing_image_verifications_rollback.sql`<br>`20260622_listing_publish_jobs.sql`<br>`20260622_listing_publish_jobs_rollback.sql` | — | — |
| `20260623` | local_only | `20260623_listing_approved_memory_v3.sql`<br>`20260623_listing_approved_memory_v3_rollback.sql`<br>`20260623_listing_identity_result_cache.sql`<br>`20260623_listing_identity_result_cache_rollback.sql` | — | — |
| `20260625035856` | local_only | `20260625035856_card_visual_vector_retrieval.sql`<br>`20260625035856_card_visual_vector_retrieval_rollback.sql` | — | — |
| `20260625151516` | local_only | `20260625151516_vector_query_lifecycle.sql`<br>`20260625151516_vector_query_lifecycle_rollback.sql` | — | — |
| `20260625153857` | local_only | `20260625153857_advanced_retrieval_accuracy_pack.sql`<br>`20260625153857_advanced_retrieval_accuracy_pack_rollback.sql` | — | — |
| `20260626032350` | normalized_equivalent | `20260626032350_create_search_card_identities_hybrid_rpc.sql` | `20260626032350_create_search_card_identities_hybrid_rpc.sql` | normalized_equivalent |
| `20260626042902` | ambiguous_duplicate_version | `20260626042902_card_vector_match_status_columns.sql`<br>`20260626042902_card_vector_match_status_columns_rollback.sql` | `20260626042902_card_vector_match_status_columns.sql` | — |
| `20260626043200` | ambiguous_duplicate_version | `20260626043200_catalog_gap_reference_promotion.sql`<br>`20260626043200_catalog_gap_reference_promotion_rollback.sql` | `20260626043200_catalog_gap_reference_promotion.sql` | — |
| `20260626051832` | ambiguous_duplicate_version | `20260626051832_promote_card_reference_to_approved.sql`<br>`20260626051832_promote_card_reference_to_approved_rollback.sql` | `20260626051832_promote_card_reference_to_approved.sql` | — |
| `20260626083423` | local_only | `20260626083423_basketball_catalog_v0.sql` | — | — |
| `20260626115429` | local_only | `20260626115429_catalog_first_corrected_title_v0.sql` | — | — |
| `20260626121414` | remote_only | — | `20260626121414_basketball_catalog_v0.sql` | — |
| `20260626121534` | remote_only | — | `20260626121534_catalog_first_corrected_title_v0.sql` | — |
| `20260630125409` | local_only | `20260630125409_official_checklist_source_family.sql` | — | — |
| `20260701113917` | local_only | `20260701113917_catalog_gap_cold_start_fields.sql` | — | — |
| `20260701120834` | local_only | `20260701120834_catalog_cold_start_flywheel_v0.sql` | — | — |
| `20260701122804` | local_only | `20260701122804_official_catalog_importer_system_v0.sql` | — | — |
| `20260701124453` | local_only | `20260701124453_multi_source_catalog_importer_framework_v0.sql` | — | — |
| `20260701140635` | remote_only | — | `20260701140635_catalog_cold_start_flywheel_v0_cloud_sync.sql` | — |
| `20260701140730` | remote_only | — | `20260701140730_official_catalog_importer_system_v0_cloud_sync.sql` | — |
| `20260701140951` | remote_only | — | `20260701140951_multi_source_catalog_importer_framework_v0_cloud_sync.sql` | — |
| `20260702024009` | remote_only | — | `20260702024009_listing_feedback_v2_reconcile.sql` | — |
| `20260702024025` | remote_only | — | `20260702024025_listing_image_storage_reconcile.sql` | — |
| `20260702024035` | remote_only | — | `20260702024035_listing_image_verifications_reconcile.sql` | — |
| `20260702024050` | remote_only | — | `20260702024050_listing_publish_jobs_reconcile.sql` | — |
| `20260702024104` | remote_only | — | `20260702024104_listing_approved_memory_v3_reconcile.sql` | — |
| `20260702024119` | remote_only | — | `20260702024119_listing_identity_result_cache_reconcile.sql` | — |
| `20260702024238` | remote_only | — | `20260702024238_vector_query_lifecycle_reconcile.sql` | — |
| `20260702024337` | remote_only | — | `20260702024337_advanced_retrieval_accuracy_pack_reconcile.sql` | — |
| `20260702062734` | local_only | `20260702062734_data_loop_workflow_sidecars_v0.sql` | — | — |
| `20260702092135` | remote_only | — | `20260702092135_data_loop_workflow_sidecars_v0.sql` | — |
| `20260703034116` | local_only | `20260703034116_catalog_search_all_categories_v0.sql` | — | — |
| `20260703040500` | remote_only | — | `20260703040500_catalog_search_all_categories_v0.sql` | — |
| `20260703041438` | local_only | `20260703041438_catalog_clear_unknown_categories_v0.sql` | — | — |
| `20260703041702` | remote_only | — | `20260703041702_catalog_clear_unknown_categories_v0.sql` | — |
| `20260703044401` | local_only | `20260703044401_catalog_clean_writer_title_tcg_sales_terms_v0.sql` | — | — |
| `20260703044448` | remote_only | — | `20260703044448_catalog_clean_writer_title_tcg_sales_terms_v0.sql` | — |
| `20260703044509` | local_only | `20260703044509_catalog_clean_writer_title_tcg_lot_star_v0.sql` | — | — |
| `20260703044544` | remote_only | — | `20260703044544_catalog_clean_writer_title_tcg_lot_star_v0.sql` | — |
| `20260703112438` | local_only | `20260703112438_feedback_workflow_context_v0.sql` | — | — |
| `20260703120834` | local_only | `20260703120834_learning_flywheel_v0.sql` | — | — |
| `20260704032228` | remote_only | — | `20260704032228_catalog_anchor_filter_rpc_v1.sql` | — |
| `20260704032658` | remote_only | — | `20260704032658_catalog_years_compatible_strict_v1.sql` | — |
| `20260704060000` | local_only | `20260704060000_catalog_anchor_filter_rpc_v1.sql` | — | — |
| `20260704070000` | local_only | `20260704070000_hybrid_unified_catalog_and_indexes_v1.sql` | — | — |
| `20260705151414` | remote_only | — | `20260705151414_hybrid_unified_catalog_and_indexes_v1.sql` | — |
| `20260706060115` | local_only | `20260706060115_preingestion_evidence_bundle_v0.sql` | — | — |
| `20260706062043` | remote_only | — | `20260706062043_preingestion_evidence_bundle_v0.sql` | — |
| `20260706093000` | local_only | `20260706093000_v4_recognition_spine.sql` | — | — |
| `20260706093959` | remote_only | — | `20260706093959_v4_recognition_spine.sql` | — |
| `20260706094322` | local_only | `20260706094322_v4_enable_rls.sql` | — | — |
| `20260706094456` | remote_only | — | `20260706094456_v4_enable_rls.sql` | — |
| `20260706101304` | normalized_equivalent | `20260706101304_v4_learning_event_training_envelope.sql` | `20260706101304_v4_learning_event_training_envelope.sql` | normalized_equivalent |
| `20260706123735` | remote_only | — | `20260706123735_catalog_search_blob_materialized_v1.sql` | — |
| `20260706123826` | remote_only | — | `20260706123826_hybrid_rpc_materialized_blob_v1.sql` | — |
| `20260706130000` | local_only | `20260706130000_catalog_search_blob_materialized_v1.sql` | — | — |
| `20260707122154` | local_only | `20260707122154_v4_production_job_queue.sql` | — | — |
| `20260707130906` | local_only | `20260707130906_v4_writer_export_batches.sql` | — | — |
| `20260707133128` | local_only | `20260707133128_v4_queue_interactive_background_lanes.sql` | — | — |
| `20260707154500` | local_only | `20260707154500_create_v4_fast_scout_cache.sql` | — | — |
| `20260708043000` | local_only | `20260708043000_v4_queue_reclaim_expired_running_jobs.sql` | — | — |
| `20260708043008` | remote_only | — | `20260708043008_v4_queue_reclaim_expired_running_jobs.sql` | — |
| `20260708084634` | local_only | `20260708084634_sem_definition_canonical_v1.sql` | — | — |
| `20260708092501` | remote_only | — | `20260708092501_sem_definition_canonical_v1.sql` | — |
| `20260708100324` | normalized_equivalent | `20260708100324_sem_definition_canonical_v25.sql` | `20260708100324_sem_definition_canonical_v25.sql` | normalized_equivalent |
| `20260709123119` | remote_only | — | `20260709123119_cert_registry_v1.sql` | — |
| `20260709170000` | local_only | `20260709170000_cert_registry_v1.sql` | — | — |
| `20260710042537` | remote_only | — | `20260710042537_feedback_workflow_context_v0.sql` | — |
| `20260710055802` | local_only | `20260710055802_v4_execution_control_plane_v1.sql` | — | — |
| `20260711042449` | normalized_equivalent | `20260711042449_add_v4_node_observability.sql` | `20260711042449_add_v4_node_observability.sql` | normalized_equivalent |
| `20260711194540` | local_only | `20260711194540_harden_public_function_security_and_queue_heartbeat.sql` | — | — |
| `20260711195801` | remote_only | — | `20260711195801_harden_public_function_security_and_queue_heartbeat.sql` | — |
| `20260711200533` | local_only | `20260711200533_atomic_v4_writer_feedback_transaction.sql` | — | — |
| `20260712033532` | remote_only | — | `20260712033532_atomic_v4_writer_feedback_transaction.sql` | — |
| `20260712040453` | local_only | `20260712040453_supersede_stale_writer_learning_events.sql` | — | — |
| `20260712040615` | remote_only | — | `20260712040615_supersede_stale_writer_learning_events.sql` | — |
| `20260712063833` | normalized_equivalent | `20260712063833_cancel_consumerless_preingestion_jobs.sql` | `20260712063833_cancel_consumerless_preingestion_jobs.sql` | normalized_equivalent |
| `20260712072310` | local_only | `20260712072310_atomic_v4_noncritical_persistence.sql` | — | — |
| `20260712073353` | remote_only | — | `20260712073353_atomic_v4_noncritical_persistence.sql` | — |
| `20260712073552` | remote_only | — | `20260712073552_atomic_v4_noncritical_persistence.sql` | — |
| `20260712153000` | local_only | `20260712153000_atomic_v4_writer_ready_capacity_release.sql` | — | — |
| `20260712170000` | local_only | `20260712170000_v4_balanced_provider_key_slots.sql` | — | — |
| `20260712183000` | local_only | `20260712183000_refresh_v4_queue_rpc_schema.sql` | — | — |
| `20260713111833` | normalized_equivalent | `20260713111833_optimize_catalog_candidates_anchor_index_v2.sql` | `20260713111833_optimize_catalog_candidates_anchor_index_v2.sql` | normalized_equivalent |
| `20260713124858` | remote_only | — | `20260713124858_create_v4_fast_scout_cache.sql` | — |
| `20260713130000` | local_only | `20260713130000_v4_stage_capacity_control.sql` | — | — |
| `20260713224500` | local_only | `20260713224500_v4_tenant_fair_provider_queue.sql` | — | — |
| `20260714170910` | normalized_equivalent | `20260714170910_promote_internal_corrected_title_catalog.sql` | `20260714170910_promote_internal_corrected_title_catalog.sql` | normalized_equivalent |
| `20260714174210` | local_only | `20260714174210_expose_catalog_source_feedback_for_self_exclusion.sql` | — | — |
| `20260715064500` | local_only | `20260715064500_ensure_v4_learning_events_dataset_disposition_for_queue.sql` | — | — |
| `20260715065752` | local_only | `20260715065752_track_d_feedback_capture_v1.sql` | — | — |
| `20260715065803` | local_only | `20260715065803_track_c_tenant_foundation_expand.sql` | — | — |
| `20260715065808` | local_only | `20260715065808_track_c_retry_state_machine_hardening.sql` | — | — |
| `20260715065812` | local_only | `20260715065812_track_c_tenant_settings.sql` | — | — |
| `20260715065820` | local_only | `20260715065820_track_c_preingestion_ocr_durable_leases.sql` | — | — |
| `20260715065830` | local_only | `20260715065830_track_d_data_flywheel_convergence.sql` | — | — |
| `20260716172824` | remote_only | — | `20260716172824_auth_otp_invitations_v1.sql` | — |
| `20260717100000` | local_only | `20260717100000_fix_v4_queue_atomic_rpc_signature.sql` | — | — |
| `20260717120526` | remote_only | — | `20260717120526_track_c_legacy_asset_parent_convergence_v1.sql` | — |
| `20260717120604` | remote_only | — | `20260717120604_listing_image_verified_crop_provenance_v1.sql` | — |
| `20260717120641` | remote_only | — | `20260717120641_atomic_enqueue_verified_image_set_v2.sql` | — |
| `20260717120716` | remote_only | — | `20260717120716_track_c_runtime_schema_convergence_v1.sql` | — |
| `20260717130819` | local_only | `20260717130819_track_c_schema_attestation_and_tenant_convergence.sql` | — | — |
| `20260717132042` | remote_only | — | `20260717132042_track_c_schema_attestation_and_tenant_convergence.sql` | — |
| `20260717132242` | local_only | `20260717132242_fix_track_c_catalog_trigger_when_marker.sql` | — | — |
| `20260717132617` | remote_only | — | `20260717132617_fix_track_c_catalog_trigger_when_marker.sql` | — |
| `20260717133210` | remote_only | — | `20260717133210_track_c_retry_state_machine_hardening.sql` | — |
| `20260717133218` | remote_only | — | `20260717133218_track_c_preingestion_ocr_durable_leases.sql` | — |
| `20260717133700` | local_only | `20260717133700_track_c_fact_and_storage_boundary_convergence.sql` | — | — |
| `20260717140201` | remote_only | — | `20260717140201_track_c_fact_and_storage_boundary_convergence.sql` | — |
| `20260717143000` | local_only | `20260717143000_create_tenant_invitations.sql` | — | — |
| `20260717190000` | local_only | `20260717190000_track_c_legacy_asset_parent_convergence_v1.sql` | — | — |
| `20260717191000` | local_only | `20260717191000_listing_image_verified_crop_provenance_v1.sql` | — | — |
| `20260717192000` | local_only | `20260717192000_atomic_enqueue_verified_image_set_v2.sql` | — | — |
| `20260717193000` | local_only | `20260717193000_track_c_runtime_schema_convergence_v1.sql` | — | — |
| `20260718005049` | normalized_equivalent | `20260718005049_v4_queue_hot_slot_and_manual_recovery.sql` | `20260718005049_v4_queue_hot_slot_and_manual_recovery.sql` | normalized_equivalent |
| `20260719205025` | local_only | `20260719205025_v4_queue_deployment_affinity.sql` | — | — |
| `20260720020555` | remote_only | — | `20260720020555_v4_queue_deployment_affinity.sql` | — |
| `20260722224202` | remote_only | — | `20260722224202_postgrest_idle_transaction_guard.sql` | — |
| `20260722230129` | remote_only | — | `20260722230129_postgrest_schema_cache_timeout_guard.sql` | — |
| `20260722230544` | remote_only | — | `20260722230544_postgrest_schema_cache_timeout_headroom.sql` | — |
| `20260722230724` | remote_only | — | `20260722230724_postgrest_disable_timezone_preference.sql` | — |
| `20260722233618` | remote_only | — | `20260722233618_enable_pg_prewarm.sql` | — |
| `20260723004612` | remote_only | — | `20260723004612_atomic_listing_asset_idempotency.sql` | — |
| `20260723013540` | remote_only | — | `20260723013540_v4_queue_affinity_claim_indexes.sql` | — |
| `20260723020121` | remote_only | — | `20260723020121_prune_asset_scoped_capacity_leases.sql` | — |
| `20260723020437` | remote_only | — | `20260723020437_prune_stale_asset_capacity_leases.sql` | — |
| `20260723063133` | remote_only | — | `20260723063133_preingestion_job_lookup_long_tail_index.sql` | — |
| `20260723193552` | content_mismatch | `20260723193552_quarantine_marketplace_catalog_provenance.sql` | `20260723193552_quarantine_marketplace_catalog_provenance.sql` | content_changed |
| `20260723200346` | normalized_equivalent | `20260723200346_catalog_retrieval_preserve_structured_fields.sql` | `20260723200346_catalog_retrieval_preserve_structured_fields.sql` | normalized_equivalent |
| `20260723213927` | remote_only | — | `20260723213927_catalog_search_blob_normalization_v1.sql` | — |
| `20260723215305` | remote_only | — | `20260723215305_isolate_marketplace_catalog_products.sql` | — |
| `20260723221636` | remote_only | — | `20260723221636_enforce_catalog_source_graph_consistency.sql` | — |
| `20260724` | local_only | `20260724_listing_identity_cache_terminal_l2.sql`<br>`20260724_listing_identity_cache_terminal_l2_rollback.sql`<br>`20260724_listing_identity_cache_version_contract.sql`<br>`20260724_listing_identity_cache_version_contract_rollback.sql` | — | — |
| `20260724033000` | local_only | `20260724033000_isolate_marketplace_catalog_products.sql` | — | — |
| `20260724050000` | local_only | `20260724050000_enforce_catalog_source_graph_consistency.sql` | — | — |
| `20260724071411` | remote_only | — | `20260724071411_listing_identity_cache_version_contract.sql` | — |
| `20260724073657` | remote_only | — | `20260724073657_listing_identity_cache_terminal_l2.sql` | — |
| `20260724215000` | local_only | `20260724215000_catalog_search_blob_normalization_v1.sql` | — | — |
| `20260724224500` | content_mismatch | `20260724224500_listing_identity_cache_global_scope_v1.sql` | `20260724224500_listing_identity_cache_global_scope_v1.sql` | content_changed |
| `20260724231500` | local_only | `20260724231500_fix_writer_feedback_durable_asset_identity.sql` | — | — |
| `20260724235000` | content_mismatch | `20260724235000_recognition_pipeline_cache_guards_v1.sql` | `20260724235000_recognition_pipeline_cache_guards_v1.sql` | content_changed |
| `20260724235900` | content_mismatch | `20260724235900_v4_provider_release_visibility.sql` | `20260724235900_v4_provider_release_visibility.sql` | content_changed |
| `20260725000000` | content_mismatch | `20260725000000_revert_provider_release_visibility_v1.sql` | `20260725000000_revert_provider_release_visibility_v1.sql` | content_changed |
| `20260725143748` | remote_only | — | `20260725143748_fix_catalog_snapshot_trigger_transition_tables.sql` | — |
| `20260725150000` | local_only | `20260725150000_fix_catalog_snapshot_trigger_transition_tables.sql` | — | — |
| `20260726160000` | local_only | `20260726160000_bound_idle_transactions_on_unprotected_roles.sql` | — | — |
| `20260727054717` | remote_only | — | `20260727054717_v4_late_provider_capacity_canary.sql` | — |
| `20260728190000` | local_only | `20260728190000_csm_stage_shadow_foundation_v1.sql` | — | — |
| `20260730042725` | remote_only | — | `20260730042725_ocs_cognition_loop_health_view.sql` | — |
| `20260801065544` | remote_only | — | `20260801065544_csm_stage_shadow_foundation_v1.sql` | — |
| `20260801065859` | local_only | `20260801065859_csm_marketplace_trace_object.sql` | — | — |
| `20260801065941` | remote_only | — | `20260801065941_csm_marketplace_trace_object.sql` | — |
| `20260801071048` | local_only | `20260801071048_csm_empty_canonical_sql_null.sql` | — | — |
| `20260801071129` | remote_only | — | `20260801071129_csm_empty_canonical_sql_null.sql` | — |
| `20260801094353` | remote_only | — | `20260801094353_csm_atomic_stage_packet_v1.sql` | — |
| `20260801123000` | local_only | `20260801123000_csm_atomic_stage_packet_v1.sql` | — | — |

## Lossless convergence path

1. Keep this 107-file worktree immutable as historical application evidence; do not rename, move, delete, repair, or replay its divergent migrations.
2. For every database operation, rebuild an isolated remote-first workdir from `migration list/fetch --linked`. Its fetched 86-file history is the only deployable ledger baseline.
3. Convert same-name/different-version normalized matches into signed receipts. For mismatches, compare the live schema to the intended contract; never infer unapplied DDL from a filename.
4. Express only verified schema deltas as new additive migrations with versions later than the remote maximum. The controlled guard may authorize exactly one such file; the divergent worktree may never call `db push`.
5. After the new migration is applied through a reviewed single-migration runner, fetch again, pin its remote receipt, and require exact remote-first ledger status before enabling ordinary pushes.
