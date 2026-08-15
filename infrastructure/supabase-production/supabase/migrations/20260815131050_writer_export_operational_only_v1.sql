-- A workbook export is an operational delivery action, not evidence that a
-- writer reviewed its titles. Only an independently persisted review event may
-- admit a title to a training dataset.
set lock_timeout = '5s';
set statement_timeout = '60s';

update public.v4_writer_export_items
set training_use = 'operational_only_never_training'
where training_use is distinct from 'operational_only_never_training';

alter table public.v4_writer_export_items
  alter column training_use set default 'operational_only_never_training';

alter table public.v4_writer_export_items
  add constraint v4_writer_export_items_operational_only_training_use check (
    training_use = 'operational_only_never_training'
  ) not valid;

alter table public.v4_writer_export_items
  validate constraint v4_writer_export_items_operational_only_training_use;

update public.v4_writer_export_batches
set manifest = manifest || pg_catalog.jsonb_build_object(
  'training_use', 'operational_only_never_training',
  'training_eligible', false,
  'training_admission', 'requires_independent_persisted_review_event'
)
where manifest ->> 'training_use' is distinct from 'operational_only_never_training'
   or manifest -> 'training_eligible' is distinct from 'false'::jsonb
   or manifest ->> 'training_admission' is distinct from
      'requires_independent_persisted_review_event';

alter table public.v4_writer_export_batches
  add constraint v4_writer_export_batches_operational_only_manifest check (
    (manifest ->> 'training_use') is not distinct from
      'operational_only_never_training'
    and (manifest -> 'training_eligible') is not distinct from 'false'::jsonb
    and (manifest ->> 'training_admission') is not distinct from
      'requires_independent_persisted_review_event'
  ) not valid;

alter table public.v4_writer_export_batches
  validate constraint v4_writer_export_batches_operational_only_manifest;

comment on column public.v4_writer_export_items.training_use is
  'Operational export only; never a review or training-admission event.';
