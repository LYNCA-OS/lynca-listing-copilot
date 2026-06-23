-- Read-only export for Recognition Dataset candidate generation.
-- Run through Supabase MCP execute_sql or Supabase SQL editor, then save the
-- JSON result to a local file and pass it to:
-- npm run recognition:supabase:rows -- --input <rows.json>

select
  id::text as id,
  generated_title,
  corrected_title,
  front_image_url,
  back_image_url,
  operator_id,
  created_at
from public.listing_title_feedback
where nullif(front_image_url, '') is not null
   or nullif(back_image_url, '') is not null
order by created_at desc, id asc;
