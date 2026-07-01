import assert from "node:assert/strict";
import { parseSupabaseStorageUrl, recognitionCandidatesFromSupabaseFeedbackRows } from "../lib/listing/recognition/supabase-recognition-source.mjs";
import { validateRecognitionDataset } from "../lib/listing/recognition/recognition-dataset.mjs";
import { runExportSupabaseRecognitionCandidates } from "./export-supabase-recognition-candidates.mjs";
import {
  feedbackRowsFromSqlExportPayload,
  runExportSupabaseRecognitionCandidatesFromRows
} from "./export-supabase-recognition-candidates-from-rows.mjs";
import {
  extractSupabaseMcpExportChunksFromSessionText,
  extractSupabaseMcpRowsJsonArraysFromSessionText,
  mergeRowsFromSupabaseMcpChunks,
  runExtractSupabaseMcpRowsFromSession
} from "./extract-supabase-mcp-rows-from-session.mjs";

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
assert.equal(candidates[0].source_titles.corrected_title_is_reviewed_title_ground_truth, true);
assert.match(candidates[0].notes, /writer-reviewed title ground truth/);
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
assert.equal(exportPayload.summary.corrected_title_is_reviewed_title_ground_truth, true);
assert.equal(exportPayload.summary.corrected_title_used_as_ground_truth, false);
assert.equal(exportPayload.summary.corrected_title_used_as_field_ground_truth, false);
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
assert.equal(rowsPayload.summary.corrected_title_is_reviewed_title_ground_truth, true);
assert.equal(rowsPayload.summary.corrected_title_used_as_ground_truth, false);
assert.equal(rowsPayload.summary.corrected_title_used_as_field_ground_truth, false);
assert.equal(writtenFiles.get("manifest.json").items[0].source_feedback_id, "fb3");
assert.equal(writtenFiles.get("report.json").validation.ok, true);

const chunkPrefix = "LYNCA_SUPABASE_FEEDBACK_EXPORT_TEST_";
const chunkRowsA = [
  {
    id: "fb5",
    generated_title: "generated mcp a",
    corrected_title: "corrected mcp a",
    front_bucket: "listing-feedback-images",
    front_object_path: "feedback/2026-06/a/front.jpg",
    back_bucket: "listing-feedback-images",
    back_object_path: "feedback/2026-06/a/back.jpg",
    created_at: "2026-06-22T00:00:00Z"
  }
];
const chunkRowsB = [
  {
    id: "fb6",
    generated_title: "generated mcp b",
    corrected_title: "corrected mcp b",
    front_bucket: "listing-feedback-images",
    front_object_path: "feedback/2026-06/b/front.jpg",
    created_at: "2026-06-22T00:00:01Z"
  }
];
const chunkA = {
  chunk_id: `${chunkPrefix}0000`,
  row_count: 1,
  rows_b64: Buffer.from(JSON.stringify(chunkRowsA), "utf8").toString("base64")
};
const chunkB = {
  chunk_id: `${chunkPrefix}0001`,
  row_count: 1,
  rows_b64: Buffer.from(JSON.stringify(chunkRowsB), "utf8").toString("base64")
};
const mcpSessionLines = [
  JSON.stringify({
    type: "event_msg",
    payload: {
      result: {
        Ok: {
          structuredContent: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  result: `Below is the result.
<untrusted-data-example>
${JSON.stringify([chunkA])}
</untrusted-data-example>`
                })
              }
            ]
          }
        }
      }
    }
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      output: `Wall time: 1s
Output:
${JSON.stringify({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        result: `Below is the result.
<untrusted-data-example>
${JSON.stringify([chunkB])}
</untrusted-data-example>`
      })
    }
  ]
})}`
    }
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      output: `duplicate ${chunkPrefix}0000 ${JSON.stringify([chunkA])}`
    }
  })
].join("\n");
const chunks = extractSupabaseMcpExportChunksFromSessionText(mcpSessionLines, { chunkPrefix });
assert.equal(chunks.length, 2);
const merged = mergeRowsFromSupabaseMcpChunks(chunks);
assert.equal(merged.rows.length, 2);
assert.equal(merged.rows[0].id, "fb6");
assert.equal(merged.chunk_summaries[0].decoded_row_count, 1);

const extractedFiles = new Map();
const extractSummary = await runExtractSupabaseMcpRowsFromSession({
  argv: [
    "--session",
    "session.jsonl",
    "--output",
    "rows.json",
    "--report-output",
    "extract-report.json",
    "--chunk-prefix",
    chunkPrefix,
    "--expected-rows",
    "2",
    "--expected-chunks",
    "2"
  ],
  readFileImpl: async () => mcpSessionLines,
  writeFileImpl: async (filePath, text) => {
    extractedFiles.set(filePath, JSON.parse(text));
  }
});
assert.equal(extractSummary.row_count, 2);
assert.equal(extractedFiles.get("rows.json").length, 2);
assert.equal(extractedFiles.get("extract-report.json").chunk_count, 2);

const rowsJsonSession = JSON.stringify({
  type: "event_msg",
  payload: {
    result: {
      Ok: {
        structuredContent: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                result: `Below is the result. Note the boundary below.
<untrusted-data-example>
${JSON.stringify([{ rows_json: JSON.stringify(chunkRowsA) }])}
</untrusted-data-example>`
              })
            }
          ]
        }
      }
    }
  }
});
const rowsJsonArrays = extractSupabaseMcpRowsJsonArraysFromSessionText(rowsJsonSession);
assert.equal(rowsJsonArrays.length, 1);
assert.equal(rowsJsonArrays[0][0].id, "fb5");

const rowsJsonFiles = new Map();
const rowsJsonSummary = await runExtractSupabaseMcpRowsFromSession({
  argv: [
    "--session",
    "session.jsonl",
    "--output",
    "rows-json.json",
    "--report-output",
    "rows-json-report.json",
    "--expected-rows",
    "1"
  ],
  readFileImpl: async () => rowsJsonSession,
  writeFileImpl: async (filePath, text) => {
    rowsJsonFiles.set(filePath, JSON.parse(text));
  }
});
assert.equal(rowsJsonSummary.source_mode, "rows_json_payload");
assert.equal(rowsJsonFiles.get("rows-json.json").length, 1);

console.log("supabase recognition candidate tests passed");
