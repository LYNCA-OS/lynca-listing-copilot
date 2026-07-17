-- Queue migration preflight: ensure Track D contract column exists for
-- enqueue_v4_recognition_batch_atomic execution.
--
-- The production queue migration bundle may run 20260715065830_track_d_data_flywheel_convergence
-- before Track D feedback baseline migration in some environments. Without this column,
-- that migration fails at runtime with:
--   column "dataset_disposition" of relation "v4_learning_events" does not exist.

alter table if exists public.v4_learning_events
  add column if not exists dataset_disposition text not null default 'LEGACY_CAPTURE';

update public.v4_learning_events
set dataset_disposition = coalesce(dataset_disposition, 'LEGACY_CAPTURE')
where dataset_disposition is null;

comment on column public.v4_learning_events.dataset_disposition is
  'Controls V4 learning-event routing and feedback data disposition defaults for queue/worker control.';
