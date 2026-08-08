-- Retire rebuildable data produced only by the superseded thick recognition
-- path. The internal writer-reviewed library and the active CSM thin path are
-- hard protection boundaries. Run through `supabase db query --linked --file`.

begin;

do $guard$
declare
  feedback_rows bigint;
  identity_rows bigint;
  reference_rows bigint;
  feedback_objects bigint;
  thin_sessions bigint;
begin
  select count(*) into feedback_rows from public.listing_title_feedback;
  select count(*) into identity_rows from public.card_identities;
  select count(*) into reference_rows from public.card_reference_images;
  select count(*) into feedback_objects
    from storage.objects where bucket_id = 'listing-feedback-images';
  select count(*) into thin_sessions
    from public.v4_recognition_sessions where route = 'CSM_THIN_DIRECT';

  if feedback_rows < 358
     or identity_rows < 255
     or reference_rows < 509
     or feedback_objects < 3449
     or thin_sessions < 312 then
    raise exception
      'protected asset guard failed: feedback %, identities %, references %, feedback objects %, thin sessions %',
      feedback_rows, identity_rows, reference_rows, feedback_objects, thin_sessions;
  end if;
end
$guard$;

-- No CASCADE: an unreviewed dependency must abort the transaction.
truncate table
  public.card_reference_promotion_events,
  public.catalog_entity_clusters,
  public.catalog_flywheel_hard_negatives,
  public.catalog_gap_queue,
  public.catalog_import_staging,
  public.catalog_parallels,
  public.catalog_cards,
  public.catalog_sets,
  public.catalog_products,
  public.catalog_sources,
  public.listing_active_catalog_snapshot,
  public.v4_catalog_gap_queue,

  public.vector_ann_recall_audits,
  public.vector_fingerprints,
  public.vector_hard_negatives,
  public.vector_index_snapshots,
  public.vector_retrieval_ablation_runs,
  public.vector_retrieval_candidates,
  public.vector_retrieval_runs,
  public.vector_query_logs,
  public.card_image_embeddings,

  public.preingestion_evidence_patches,
  public.preingestion_jobs,
  public.preingestion_bundles,

  public.job_attempt_events,
  public.v4_provider_capacity_leases,
  public.v4_queue_kick_leases,
  public.v4_recognition_jobs,
  public.v4_recognition_batches,
  public.recognition_workflow_events,
  public.v4_candidate_traces,
  public.v4_field_evidence,
  public.v4_production_quality_ledger,
  public.listing_identity_resolution_cache
restart identity;

commit;
