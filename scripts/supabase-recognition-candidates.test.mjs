import assert from "node:assert/strict";
import { parseSupabaseStorageUrl, recognitionCandidatesFromSupabaseFeedbackRows } from "../lib/listing/recognition/supabase-recognition-source.mjs";
import { validateRecognitionDataset } from "../lib/listing/recognition/recognition-dataset.mjs";
import { runExportSupabaseRecognitionCandidates } from "./export-supabase-recognition-candidates.mjs";
import {
  feedbackRowsFromSqlExportPayload,
  runExportSupabaseRecognitionCandidatesFromRows
} from "./export-supabase-recognition-candidates-from-rows.mjs";

const url = "https://example.supabase.co/storage/v1/object/authenticated/listing-feedback-images/feedback/2026-06/card/front.jpg";
const parsed = parseSupabaseStorageUrl(url);
assert.equal(parsed.bucket, "listing-feedback-images");
assert.equal(parsed.object_path, "feedback/2026-06/card/front.jpg");
assert.equal(parsed.access, "authenticated");

const candidates = recognitionCandidatesFromSupabaseFeedbackRows([
  {
    id: "fb1",
    generated_title: "generated",
    corrected_title: "corrected",
    front_image_url: url,
    back_image_url: url.replace("front.jpg", "back.jpg"),
    created_at: "2026-06-22T00:00:00Z"
  }
]);
assert.equal(candidates.length, 1);
assert.equal(candidates[0].review_status, "NEEDS_REVIEW");
assert.equal(candidates[0].images[0].bucket, "listing-feedback-images");
assert.equal(candidates[0].images[0].object_path, "feedback/2026-06/card/front.jpg");
assert.equal(candidates[0].ground_truth.year, null);
assert.equal(candidates[0].source_titles.corrected_title, "corrected");
assert.match(candidates[0].notes, /Corrected title is not field-level ground truth/);
assert.deepEqual(validateRecognitionDataset(candidates), []);

const fetchedPayloads = [];
const exportPayload = await runExportSupabaseRecognitionCandidates({
  argv: ["--dry-run"],
  env: {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
  },
  fetchImpl: async (endpoint, init) => {
    fetchedPayloads.push({ endpoint: String(endpoint), init });
    return {
      ok: true,
      async json() {
        return [
          {
            id: "fb2",
            generated_title: "g",
            corrected_title: "c",
            front_image_url: url,
            created_at: "2026-06-22T00:00:00Z"
          }
        ];
      }
    };
  }
});
assert.equal(exportPayload.summary.item_count, 1);
assert.equal(exportPayload.summary.corrected_title_used_as_ground_truth, false);
assert.match(fetchedPayloads[0].endpoint, /listing_title_feedback/);
assert.equal(fetchedPayloads[0].init.headers.authorization, "Bearer test-service-role");

const mcpWrappedRows = {
  result: `Below is the result of the SQL query.
<untrusted-data-example>
[
  {
    "id": "fb3",
    "generated_title": "generated sql",
    "corrected_title": "corrected sql",
    "front_image_url": "${url}",
    "back_image_url": "${url.replace("front.jpg", "back.jpg")}",
    "created_at": "2026-06-22T00:00:00Z"
  },
  {
    "id": "fb4",
    "generated_title": "text only",
    "corrected_title": "text only corrected",
    "front_image_url": null,
    "back_image_url": null,
    "created_at": "2026-06-22T00:00:01Z"
  }
]
</untrusted-data-example>`
};
assert.equal(feedbackRowsFromSqlExportPayload(mcpWrappedRows).length, 2);

const writtenFiles = new Map();
const rowsPayload = await runExportSupabaseRecognitionCandidatesFromRows({
  argv: [
    "--input",
    "rows.json",
    "--output",
    "manifest.json",
    "--report-output",
    "report.json",
    "--project-url",
    "https://example.supabase.co"
  ],
  readFileImpl: async () => JSON.stringify(mcpWrappedRows),
  writeFileImpl: async (filePath, text) => {
    writtenFiles.set(filePath, JSON.parse(text));
  },
  now: () => new Date("2026-06-23T00:00:00Z")
});
assert.equal(rowsPayload.source.source_row_count, 2);
assert.equal(rowsPayload.summary.item_count, 1);
assert.equal(rowsPayload.source.filtered_out_no_image_count, 1);
assert.equal(rowsPayload.summary.corrected_title_used_as_ground_truth, false);
assert.equal(writtenFiles.get("manifest.json").items[0].source_feedback_id, "fb3");
assert.equal(writtenFiles.get("report.json").validation.ok, true);

console.log("supabase recognition candidate tests passed");
