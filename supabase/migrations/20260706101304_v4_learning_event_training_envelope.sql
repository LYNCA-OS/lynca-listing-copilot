alter table if exists public.v4_learning_events
  add column if not exists feedback_training_event jsonb not null default '{}'::jsonb,
  add column if not exists field_level_diff jsonb not null default '[]'::jsonb,
  add column if not exists candidate_changes jsonb not null default '{}'::jsonb;

create index if not exists v4_learning_events_feedback_training_event_gin_idx
  on public.v4_learning_events
  using gin (feedback_training_event);
