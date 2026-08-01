# Supabase production migration ledger audit — 2026-08-01

This is a secret-free, read-only audit of project `osrrujmpxxiefppjfgpd`. Remote SQL was fetched into an isolated temporary directory and discarded after hashing; no SQL body, connection string, token, or password is persisted here.

## Decision

**DB push is ALLOWED.** The ledger is exact; receipt `osrrujmpxxiefppjfgpd:csm_atomic_stage_packet_v1:20260801094353` is valid.

| Metric | Value |
|---|---:|
| `local_file_count` | 87 |
| `remote_file_count` | 87 |
| `local_version_count` | 87 |
| `remote_version_count` | 87 |
| `shared_version_count` | 87 |
| `local_only_version_count` | 0 |
| `remote_only_version_count` | 0 |
| `duplicate_local_version_count` | 0 |
| `duplicate_remote_version_count` | 0 |
| `same_name_different_version_mapping_count` | 2 |
| `ledger_exact` | true |
| `db_push_allowed` | true |

Normalization profile: `sql-line-endings-trailing-space-empty-tail-v1`. It only removes representation noise listed in the JSON audit and is not a general SQL semantic-equivalence claim.

## Pinned CSM receipt

The already-applied `csm_atomic_stage_packet_v1` migration is pinned as remote `20260801094353` ↔ local `20260801094353`. A controlled-path request for the local file must fail as already applied; neither DDL replay nor migration-history repair is permitted.

## Guard commands

`node scripts/supabase-migration-ledger.mjs guard-db-push --linked` succeeds only after a fresh linked list/fetch proves an exact ledger. On a divergent ledger, use `guard-single --linked --migration <file> --ack single-migration-only-no-db-push`; success authorizes only that reviewed file and never executes or authorizes `db push`.

## Same-name, different-version mappings

Changed lines are reported as local/remote counts; SQL text is intentionally omitted.

| Name | Local version | Remote version | Content summary | Changed lines |
|---|---:|---:|---|---:|
| `atomic_v4_noncritical_persistence` | `20260712073353` | `20260712073552` | content_changed | 147/212 |
| `atomic_v4_noncritical_persistence` | `20260712073552` | `20260712073353` | content_changed | 212/147 |

## Full version ledger

| Version | Status | Local | Remote | Content summary |
|---|---|---|---|---|
| `20260626032350` | exact | `20260626032350_create_search_card_identities_hybrid_rpc.sql` | `20260626032350_create_search_card_identities_hybrid_rpc.sql` | byte_identical |
| `20260626042902` | exact | `20260626042902_card_vector_match_status_columns.sql` | `20260626042902_card_vector_match_status_columns.sql` | byte_identical |
| `20260626043200` | exact | `20260626043200_catalog_gap_reference_promotion.sql` | `20260626043200_catalog_gap_reference_promotion.sql` | byte_identical |
| `20260626051832` | exact | `20260626051832_promote_card_reference_to_approved.sql` | `20260626051832_promote_card_reference_to_approved.sql` | byte_identical |
| `20260626121414` | exact | `20260626121414_basketball_catalog_v0.sql` | `20260626121414_basketball_catalog_v0.sql` | byte_identical |
| `20260626121534` | exact | `20260626121534_catalog_first_corrected_title_v0.sql` | `20260626121534_catalog_first_corrected_title_v0.sql` | byte_identical |
| `20260701140635` | exact | `20260701140635_catalog_cold_start_flywheel_v0_cloud_sync.sql` | `20260701140635_catalog_cold_start_flywheel_v0_cloud_sync.sql` | byte_identical |
| `20260701140730` | exact | `20260701140730_official_catalog_importer_system_v0_cloud_sync.sql` | `20260701140730_official_catalog_importer_system_v0_cloud_sync.sql` | byte_identical |
| `20260701140951` | exact | `20260701140951_multi_source_catalog_importer_framework_v0_cloud_sync.sql` | `20260701140951_multi_source_catalog_importer_framework_v0_cloud_sync.sql` | byte_identical |
| `20260702024009` | exact | `20260702024009_listing_feedback_v2_reconcile.sql` | `20260702024009_listing_feedback_v2_reconcile.sql` | byte_identical |
| `20260702024025` | exact | `20260702024025_listing_image_storage_reconcile.sql` | `20260702024025_listing_image_storage_reconcile.sql` | byte_identical |
| `20260702024035` | exact | `20260702024035_listing_image_verifications_reconcile.sql` | `20260702024035_listing_image_verifications_reconcile.sql` | byte_identical |
| `20260702024050` | exact | `20260702024050_listing_publish_jobs_reconcile.sql` | `20260702024050_listing_publish_jobs_reconcile.sql` | byte_identical |
| `20260702024104` | exact | `20260702024104_listing_approved_memory_v3_reconcile.sql` | `20260702024104_listing_approved_memory_v3_reconcile.sql` | byte_identical |
| `20260702024119` | exact | `20260702024119_listing_identity_result_cache_reconcile.sql` | `20260702024119_listing_identity_result_cache_reconcile.sql` | byte_identical |
| `20260702024238` | exact | `20260702024238_vector_query_lifecycle_reconcile.sql` | `20260702024238_vector_query_lifecycle_reconcile.sql` | byte_identical |
| `20260702024337` | exact | `20260702024337_advanced_retrieval_accuracy_pack_reconcile.sql` | `20260702024337_advanced_retrieval_accuracy_pack_reconcile.sql` | byte_identical |
| `20260702092135` | exact | `20260702092135_data_loop_workflow_sidecars_v0.sql` | `20260702092135_data_loop_workflow_sidecars_v0.sql` | byte_identical |
| `20260703040500` | exact | `20260703040500_catalog_search_all_categories_v0.sql` | `20260703040500_catalog_search_all_categories_v0.sql` | byte_identical |
| `20260703041702` | exact | `20260703041702_catalog_clear_unknown_categories_v0.sql` | `20260703041702_catalog_clear_unknown_categories_v0.sql` | byte_identical |
| `20260703044448` | exact | `20260703044448_catalog_clean_writer_title_tcg_sales_terms_v0.sql` | `20260703044448_catalog_clean_writer_title_tcg_sales_terms_v0.sql` | byte_identical |
| `20260703044544` | exact | `20260703044544_catalog_clean_writer_title_tcg_lot_star_v0.sql` | `20260703044544_catalog_clean_writer_title_tcg_lot_star_v0.sql` | byte_identical |
| `20260704032228` | exact | `20260704032228_catalog_anchor_filter_rpc_v1.sql` | `20260704032228_catalog_anchor_filter_rpc_v1.sql` | byte_identical |
| `20260704032658` | exact | `20260704032658_catalog_years_compatible_strict_v1.sql` | `20260704032658_catalog_years_compatible_strict_v1.sql` | byte_identical |
| `20260705151414` | exact | `20260705151414_hybrid_unified_catalog_and_indexes_v1.sql` | `20260705151414_hybrid_unified_catalog_and_indexes_v1.sql` | byte_identical |
| `20260706062043` | exact | `20260706062043_preingestion_evidence_bundle_v0.sql` | `20260706062043_preingestion_evidence_bundle_v0.sql` | byte_identical |
| `20260706093959` | exact | `20260706093959_v4_recognition_spine.sql` | `20260706093959_v4_recognition_spine.sql` | byte_identical |
| `20260706094456` | exact | `20260706094456_v4_enable_rls.sql` | `20260706094456_v4_enable_rls.sql` | byte_identical |
| `20260706101304` | exact | `20260706101304_v4_learning_event_training_envelope.sql` | `20260706101304_v4_learning_event_training_envelope.sql` | byte_identical |
| `20260706123735` | exact | `20260706123735_catalog_search_blob_materialized_v1.sql` | `20260706123735_catalog_search_blob_materialized_v1.sql` | byte_identical |
| `20260706123826` | exact | `20260706123826_hybrid_rpc_materialized_blob_v1.sql` | `20260706123826_hybrid_rpc_materialized_blob_v1.sql` | byte_identical |
| `20260708043008` | exact | `20260708043008_v4_queue_reclaim_expired_running_jobs.sql` | `20260708043008_v4_queue_reclaim_expired_running_jobs.sql` | byte_identical |
| `20260708092501` | exact | `20260708092501_sem_definition_canonical_v1.sql` | `20260708092501_sem_definition_canonical_v1.sql` | byte_identical |
| `20260708100324` | exact | `20260708100324_sem_definition_canonical_v25.sql` | `20260708100324_sem_definition_canonical_v25.sql` | byte_identical |
| `20260709123119` | exact | `20260709123119_cert_registry_v1.sql` | `20260709123119_cert_registry_v1.sql` | byte_identical |
| `20260710042537` | exact | `20260710042537_feedback_workflow_context_v0.sql` | `20260710042537_feedback_workflow_context_v0.sql` | byte_identical |
| `20260711042449` | exact | `20260711042449_add_v4_node_observability.sql` | `20260711042449_add_v4_node_observability.sql` | byte_identical |
| `20260711195801` | exact | `20260711195801_harden_public_function_security_and_queue_heartbeat.sql` | `20260711195801_harden_public_function_security_and_queue_heartbeat.sql` | byte_identical |
| `20260712033532` | exact | `20260712033532_atomic_v4_writer_feedback_transaction.sql` | `20260712033532_atomic_v4_writer_feedback_transaction.sql` | byte_identical |
| `20260712040615` | exact | `20260712040615_supersede_stale_writer_learning_events.sql` | `20260712040615_supersede_stale_writer_learning_events.sql` | byte_identical |
| `20260712063833` | exact | `20260712063833_cancel_consumerless_preingestion_jobs.sql` | `20260712063833_cancel_consumerless_preingestion_jobs.sql` | byte_identical |
| `20260712073353` | exact | `20260712073353_atomic_v4_noncritical_persistence.sql` | `20260712073353_atomic_v4_noncritical_persistence.sql` | byte_identical |
| `20260712073552` | exact | `20260712073552_atomic_v4_noncritical_persistence.sql` | `20260712073552_atomic_v4_noncritical_persistence.sql` | byte_identical |
| `20260713111833` | exact | `20260713111833_optimize_catalog_candidates_anchor_index_v2.sql` | `20260713111833_optimize_catalog_candidates_anchor_index_v2.sql` | byte_identical |
| `20260713124858` | exact | `20260713124858_create_v4_fast_scout_cache.sql` | `20260713124858_create_v4_fast_scout_cache.sql` | byte_identical |
| `20260714170910` | exact | `20260714170910_promote_internal_corrected_title_catalog.sql` | `20260714170910_promote_internal_corrected_title_catalog.sql` | byte_identical |
| `20260716172824` | exact | `20260716172824_auth_otp_invitations_v1.sql` | `20260716172824_auth_otp_invitations_v1.sql` | byte_identical |
| `20260717120526` | exact | `20260717120526_track_c_legacy_asset_parent_convergence_v1.sql` | `20260717120526_track_c_legacy_asset_parent_convergence_v1.sql` | byte_identical |
| `20260717120604` | exact | `20260717120604_listing_image_verified_crop_provenance_v1.sql` | `20260717120604_listing_image_verified_crop_provenance_v1.sql` | byte_identical |
| `20260717120641` | exact | `20260717120641_atomic_enqueue_verified_image_set_v2.sql` | `20260717120641_atomic_enqueue_verified_image_set_v2.sql` | byte_identical |
| `20260717120716` | exact | `20260717120716_track_c_runtime_schema_convergence_v1.sql` | `20260717120716_track_c_runtime_schema_convergence_v1.sql` | byte_identical |
| `20260717132042` | exact | `20260717132042_track_c_schema_attestation_and_tenant_convergence.sql` | `20260717132042_track_c_schema_attestation_and_tenant_convergence.sql` | byte_identical |
| `20260717132617` | exact | `20260717132617_fix_track_c_catalog_trigger_when_marker.sql` | `20260717132617_fix_track_c_catalog_trigger_when_marker.sql` | byte_identical |
| `20260717133210` | exact | `20260717133210_track_c_retry_state_machine_hardening.sql` | `20260717133210_track_c_retry_state_machine_hardening.sql` | byte_identical |
| `20260717133218` | exact | `20260717133218_track_c_preingestion_ocr_durable_leases.sql` | `20260717133218_track_c_preingestion_ocr_durable_leases.sql` | byte_identical |
| `20260717140201` | exact | `20260717140201_track_c_fact_and_storage_boundary_convergence.sql` | `20260717140201_track_c_fact_and_storage_boundary_convergence.sql` | byte_identical |
| `20260718005049` | exact | `20260718005049_v4_queue_hot_slot_and_manual_recovery.sql` | `20260718005049_v4_queue_hot_slot_and_manual_recovery.sql` | byte_identical |
| `20260720020555` | exact | `20260720020555_v4_queue_deployment_affinity.sql` | `20260720020555_v4_queue_deployment_affinity.sql` | byte_identical |
| `20260722224202` | exact | `20260722224202_postgrest_idle_transaction_guard.sql` | `20260722224202_postgrest_idle_transaction_guard.sql` | byte_identical |
| `20260722230129` | exact | `20260722230129_postgrest_schema_cache_timeout_guard.sql` | `20260722230129_postgrest_schema_cache_timeout_guard.sql` | byte_identical |
| `20260722230544` | exact | `20260722230544_postgrest_schema_cache_timeout_headroom.sql` | `20260722230544_postgrest_schema_cache_timeout_headroom.sql` | byte_identical |
| `20260722230724` | exact | `20260722230724_postgrest_disable_timezone_preference.sql` | `20260722230724_postgrest_disable_timezone_preference.sql` | byte_identical |
| `20260722233618` | exact | `20260722233618_enable_pg_prewarm.sql` | `20260722233618_enable_pg_prewarm.sql` | byte_identical |
| `20260723004612` | exact | `20260723004612_atomic_listing_asset_idempotency.sql` | `20260723004612_atomic_listing_asset_idempotency.sql` | byte_identical |
| `20260723013540` | exact | `20260723013540_v4_queue_affinity_claim_indexes.sql` | `20260723013540_v4_queue_affinity_claim_indexes.sql` | byte_identical |
| `20260723020121` | exact | `20260723020121_prune_asset_scoped_capacity_leases.sql` | `20260723020121_prune_asset_scoped_capacity_leases.sql` | byte_identical |
| `20260723020437` | exact | `20260723020437_prune_stale_asset_capacity_leases.sql` | `20260723020437_prune_stale_asset_capacity_leases.sql` | byte_identical |
| `20260723063133` | exact | `20260723063133_preingestion_job_lookup_long_tail_index.sql` | `20260723063133_preingestion_job_lookup_long_tail_index.sql` | byte_identical |
| `20260723193552` | exact | `20260723193552_quarantine_marketplace_catalog_provenance.sql` | `20260723193552_quarantine_marketplace_catalog_provenance.sql` | byte_identical |
| `20260723200346` | exact | `20260723200346_catalog_retrieval_preserve_structured_fields.sql` | `20260723200346_catalog_retrieval_preserve_structured_fields.sql` | byte_identical |
| `20260723213927` | exact | `20260723213927_catalog_search_blob_normalization_v1.sql` | `20260723213927_catalog_search_blob_normalization_v1.sql` | byte_identical |
| `20260723215305` | exact | `20260723215305_isolate_marketplace_catalog_products.sql` | `20260723215305_isolate_marketplace_catalog_products.sql` | byte_identical |
| `20260723221636` | exact | `20260723221636_enforce_catalog_source_graph_consistency.sql` | `20260723221636_enforce_catalog_source_graph_consistency.sql` | byte_identical |
| `20260724071411` | exact | `20260724071411_listing_identity_cache_version_contract.sql` | `20260724071411_listing_identity_cache_version_contract.sql` | byte_identical |
| `20260724073657` | exact | `20260724073657_listing_identity_cache_terminal_l2.sql` | `20260724073657_listing_identity_cache_terminal_l2.sql` | byte_identical |
| `20260724224500` | exact | `20260724224500_listing_identity_cache_global_scope_v1.sql` | `20260724224500_listing_identity_cache_global_scope_v1.sql` | byte_identical |
| `20260724235000` | exact | `20260724235000_recognition_pipeline_cache_guards_v1.sql` | `20260724235000_recognition_pipeline_cache_guards_v1.sql` | byte_identical |
| `20260724235900` | exact | `20260724235900_v4_provider_release_visibility.sql` | `20260724235900_v4_provider_release_visibility.sql` | byte_identical |
| `20260725000000` | exact | `20260725000000_revert_provider_release_visibility_v1.sql` | `20260725000000_revert_provider_release_visibility_v1.sql` | byte_identical |
| `20260725143748` | exact | `20260725143748_fix_catalog_snapshot_trigger_transition_tables.sql` | `20260725143748_fix_catalog_snapshot_trigger_transition_tables.sql` | byte_identical |
| `20260727054717` | exact | `20260727054717_v4_late_provider_capacity_canary.sql` | `20260727054717_v4_late_provider_capacity_canary.sql` | byte_identical |
| `20260730042725` | exact | `20260730042725_ocs_cognition_loop_health_view.sql` | `20260730042725_ocs_cognition_loop_health_view.sql` | byte_identical |
| `20260801065544` | exact | `20260801065544_csm_stage_shadow_foundation_v1.sql` | `20260801065544_csm_stage_shadow_foundation_v1.sql` | byte_identical |
| `20260801065941` | exact | `20260801065941_csm_marketplace_trace_object.sql` | `20260801065941_csm_marketplace_trace_object.sql` | byte_identical |
| `20260801071129` | exact | `20260801071129_csm_empty_canonical_sql_null.sql` | `20260801071129_csm_empty_canonical_sql_null.sql` | byte_identical |
| `20260801094353` | exact | `20260801094353_csm_atomic_stage_packet_v1.sql` | `20260801094353_csm_atomic_stage_packet_v1.sql` | byte_identical |
| `20260801101152` | exact | `20260801101152_csm_thin_provider_admission_v1.sql` | `20260801101152_csm_thin_provider_admission_v1.sql` | byte_identical |

## Canonical deployment boundary

`infrastructure/supabase-production` is the only linked Supabase deployment workdir. The repository-level `supabase/migrations` directory is frozen historical/application-contract material and must never be used with `db push`.

For a new schema delta, add exactly one reviewed, additive migration to the canonical deployment ledger, run the controlled single-migration guard, apply only that file, fetch the remote ledger again, and restore exact status before any ordinary push is allowed.
