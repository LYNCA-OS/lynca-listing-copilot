-- Read-only export for Recognition Dataset candidate generation.
--
-- Simple mode:
-- Run this through Supabase MCP execute_sql or Supabase SQL editor, save the
-- JSON result to a local file, then pass it to:
-- npm run recognition:supabase:rows -- --input <rows.json>
--
-- Chunked MCP session mode:
-- For large results, use the chunked query below, changing chunk_id and offset
-- for each page. Then extract all chunks from the Codex session JSONL with:
-- npm run recognition:supabase:mcp-session -- --session <session.jsonl> \
--   --chunk-prefix LYNCA_SUPABASE_FEEDBACK_EXPORT_20260623_ \
--   --expected-rows 248 \
--   --output data/recognition/reports/supabase-feedback-rows-mcp.json

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

-- Chunked query template. Repeat with offsets 0, 50, 100, ...
-- Keep chunk_id unique per page.
/*
with export_args as (
  select
    'LYNCA_SUPABASE_FEEDBACK_EXPORT_20260623_0000'::text as chunk_id,
    50::int as limit_rows,
    0::int as offset_rows
),
page as (
  select
    id::text as id,
    generated_title,
    corrected_title,
    case when nullif(front_image_url, '') is not null then 'listing-feedback-images' end as front_bucket,
    nullif(split_part(front_image_url, '/listing-feedback-images/', 2), '') as front_object_path,
    case when nullif(back_image_url, '') is not null then 'listing-feedback-images' end as back_bucket,
    nullif(split_part(back_image_url, '/listing-feedback-images/', 2), '') as back_object_path,
    operator_id,
    created_at
  from public.listing_title_feedback
  where nullif(front_image_url, '') is not null
     or nullif(back_image_url, '') is not null
  order by created_at desc, id asc
  limit (select limit_rows from export_args)
  offset (select offset_rows from export_args)
),
encoded as (
  select
    (select chunk_id from export_args) as chunk_id,
    count(*)::int as row_count,
    replace(
      replace(
        encode(convert_to(coalesce(json_agg(page order by created_at desc, id asc), '[]'::json)::text, 'UTF8'), 'base64'),
        chr(10),
        ''
      ),
      chr(13),
      ''
    ) as rows_b64
  from page
)
select * from encoded;
*/
