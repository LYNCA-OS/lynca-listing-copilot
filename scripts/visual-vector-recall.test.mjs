import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evaluateVisualVectorRecall } from "./evaluate-visual-vector-recall.mjs";

const tmpDir = await mkdtemp(path.join(os.tmpdir(), "visual-vector-recall-"));
try {
  const indexReportPath = path.join(tmpDir, "index.json");
  await writeFile(indexReportPath, JSON.stringify({
    items: [
      { ok: true, identity_key: "supabase_feedback:a" },
      { ok: true, identity_key: "supabase_feedback:b" },
      { ok: false, identity_key: "supabase_feedback:c" }
    ]
  }), "utf8");

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const requestUrl = new URL(String(url));
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), body });

    if (requestUrl.pathname.endsWith("/card_identities")) {
      assert.match(requestUrl.searchParams.get("identity_key") || "", /supabase_feedback:a/);
      assert.doesNotMatch(requestUrl.searchParams.get("identity_key") || "", /supabase_feedback:c/);
      return new Response(JSON.stringify([
        { identity_id: "identity-a", identity_key: "supabase_feedback:a" },
        { identity_id: "identity-b", identity_key: "supabase_feedback:b" }
      ]), { status: 200 });
    }

    if (requestUrl.pathname.endsWith("/card_image_embeddings")) {
      return new Response(JSON.stringify([
        {
          embedding_id: "embedding-a",
          identity_id: "identity-a",
          reference_image_id: "reference-a",
          embedding_role: "front_global",
          model_id: "google/siglip2-base-patch16-384",
          model_revision: "main",
          preprocessing_version: "card-rectification-v1",
          embedding: `[${[1, ...Array.from({ length: 767 }, () => 0)].join(",")}]`
        },
        {
          embedding_id: "embedding-b",
          identity_id: "identity-b",
          reference_image_id: "reference-b",
          embedding_role: "front_global",
          model_id: "google/siglip2-base-patch16-384",
          model_revision: "main",
          preprocessing_version: "card-rectification-v1",
          embedding: [0, 1, ...Array.from({ length: 766 }, () => 0)]
        }
      ]), { status: 200 });
    }

    if (requestUrl.pathname.endsWith("/rpc/match_card_image_embeddings")) {
      assert.equal(body.include_candidate_identities, true);
      assert.equal(body.query_embedding.length, 768);
      assert.equal(body.match_embedding_role, "front_global");
      const self = body.query_embedding[0] === 1 ? "a" : "b";
      const other = self === "a" ? "b" : "a";
      return new Response(JSON.stringify([
        {
          identity_id: `identity-${self}`,
          identity_key: `supabase_feedback:${self}`,
          embedding_id: `embedding-${self}`,
          similarity: 1
        },
        {
          identity_id: `identity-${other}`,
          identity_key: `supabase_feedback:${other}`,
          embedding_id: `embedding-${other}`,
          similarity: 0.61
        }
      ]), { status: 200 });
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const report = await evaluateVisualVectorRecall({
    indexReportPath,
    outPath: "",
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
    },
    fetchImpl,
    now: new Date("2026-06-25T00:00:00.000Z")
  });

  assert.equal(report.schema_version, "visual-vector-recall-eval-v1");
  assert.equal(report.summary.identities, 2);
  assert.equal(report.summary.embeddings_evaluated, 2);
  assert.equal(report.summary.self_top1_count, 2);
  assert.equal(report.summary.self_top1_rate, 1);
  assert.equal(report.summary.average_margin_to_first_non_self, 0.39);
  assert.equal(report.scope.paid_provider_calls, false);
  assert.equal(calls.filter((call) => call.url.includes("/rpc/match_card_image_embeddings")).length, 2);
} finally {
  await rm(tmpDir, { recursive: true, force: true });
}

console.log("visual vector recall tests passed");
