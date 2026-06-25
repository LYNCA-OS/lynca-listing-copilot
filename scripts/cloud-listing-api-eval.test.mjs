import assert from "node:assert/strict";
import { evaluateCloudListingApi, validateProtectionBypassSecret } from "./evaluate-cloud-listing-api.mjs";

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] || "";
      }
    },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

const dataset = {
  items: [
    {
      candidate_id: "card-1",
      source_feedback_id: "fb1",
      category: "sports_card",
      source_titles: {
        corrected_title: "2025 Topps Chrome Test Player"
      },
      images: [
        {
          image_id: "front",
          bucket: "listing-feedback-images",
          object_path: "feedback/front.jpg",
          role: "front_original"
        },
        {
          image_id: "back",
          bucket: "listing-feedback-images",
          object_path: "feedback/back.jpg",
          role: "back_original"
        }
      ]
    }
  ]
};

async function runProvider(provider) {
  const titlePayloads = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/login") {
      return jsonResponse(200, { ok: true }, {
        "set-cookie": "lynca_metaverse_session=test-cookie; Path=/"
      });
    }

    if (path === "/api/listing-provider-status") {
      return jsonResponse(200, {
        providers: [
          { id: "gemini", role: "primary" },
          { id: "openai_legacy", role: "failure_fallback" }
        ],
        default_provider: "gemini"
      });
    }

    if (path === "/api/listing-image-verify-existing") {
      const body = JSON.parse(init.body);
      return jsonResponse(200, {
        ok: true,
        verification: {
          bucket: body.bucket,
          object_path: body.object_path,
          verification_token: `verified-${body.image_id}`,
          content_type: "image/jpeg",
          size: 1000,
          width: 100,
          height: 100,
          content_sha256: "sha"
        }
      });
    }

    if (path === "/api/listing-copilot-title") {
      const body = JSON.parse(init.body);
      titlePayloads.push(body);
      const vectorEnabled = body.provider_options?.enable_evidence_completion === true
        && body.provider_options?.enable_stored_visual_features === true;
      return jsonResponse(200, {
        final_title: "2025 Topps Chrome Test Player",
        confidence: "HIGH",
        provider: body.provider,
        model_id: body.provider === "openai_legacy"
          ? "gpt-4.1-mini-2025-04-14"
          : "gemini-3.1-flash-lite",
        fields: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"]
        },
        evidence: {
          year: { value: "2025", status: "CONFIRMED" },
          product: { value: "Topps Chrome", status: "CONFIRMED" },
          players: { value: ["Test Player"], status: "CONFIRMED" }
        },
        resolved: {
          year: "2025",
          product: "Topps Chrome",
          players: ["Test Player"]
        },
        retrieval: vectorEnabled
          ? {
            providers_used: ["visual_vector"],
            queries: [{ family: "visual_vector", provider_id: "visual_vector" }],
            sources: [{
              source_type: "VISUAL_VECTOR",
              matched_fields: ["visual_vector"],
              title: "2025 Topps Chrome Test Player"
            }]
          }
          : null,
        visual_features: vectorEnabled
          ? { features: [{ embedding: [0.1, 0.2], embedding_role: "front_global" }] }
          : null,
        timing: {
          total_ms: 1234
        }
      });
    }

    throw new Error(`unexpected fetch path: ${path}`);
  };

  const report = await evaluateCloudListingApi({
    dataset,
    baseUrl: "https://lynca.example",
    provider,
    limit: 1,
    concurrency: 1,
    username: "listing",
    password: "password",
    fetchImpl
  });

  return { report, titlePayload: titlePayloads[0] };
}

const gemini = await runProvider("gemini");
assert.equal(gemini.report.status, "completed");
assert.equal(gemini.report.provider, "gemini");
assert.equal(gemini.report.provider_success_rate, 1);
assert.equal(gemini.report.per_card_latency_ms.p50, 1234);
assert.equal(gemini.report.cloud_preflight.ok, true);
assert.equal(gemini.report.cloud_preflight.default_provider, "gemini");
assert.equal(gemini.report.breakpoint_completeness_avg.raw_provider_fields, 0.375);
assert.equal(gemini.report.results[0].breakpoints.raw_provider_fields.year, "2025");
assert.equal(gemini.report.results[0].breakpoints.normalized_evidence.product.value, "Topps Chrome");
assert.equal(gemini.report.results[0].breakpoints.resolved_fields.players[0], "Test Player");
assert.equal(gemini.titlePayload.provider, "gemini");
assert.equal(gemini.titlePayload.explicitEmergency, false);
assert.equal(gemini.titlePayload.provider_options.single_model_fast, true);
assert.equal(gemini.titlePayload.provider_options.enable_evidence_completion, false);
assert.equal(gemini.titlePayload.provider_options.enable_gemini_core_field_retry, true);
assert.equal(gemini.titlePayload.provider_options.enable_gpt_failure_fallback, false);
assert.equal(gemini.titlePayload.provider_options.enable_gpt_critical_verifier, false);

const openai = await runProvider("openai");
assert.equal(openai.report.provider, "openai_legacy");
assert.equal(openai.titlePayload.provider, "openai_legacy");
assert.equal(openai.titlePayload.explicitEmergency, true);
assert.equal(openai.titlePayload.provider_options.single_model_fast, true);
assert.equal(openai.titlePayload.provider_options.enable_evidence_completion, false);
assert.equal(openai.titlePayload.provider_options.enable_gpt_failure_fallback, false);

const geminiVector = await runProvider("b");
assert.equal(geminiVector.report.provider, "gemini_vector");
assert.equal(geminiVector.titlePayload.provider, "gemini");
assert.equal(geminiVector.titlePayload.provider_options.single_model_fast, false);
assert.equal(geminiVector.titlePayload.provider_options.enable_evidence_completion, true);
assert.equal(geminiVector.titlePayload.provider_options.enable_stored_visual_features, true);
assert.equal(geminiVector.report.visual_vector_used_count, 1);
assert.equal(geminiVector.report.visual_vector_candidate_count, 1);

const openaiVector = await runProvider("d");
assert.equal(openaiVector.report.provider, "openai_vector");
assert.equal(openaiVector.titlePayload.provider, "openai_legacy");
assert.equal(openaiVector.titlePayload.explicitEmergency, true);
assert.equal(openaiVector.titlePayload.provider_options.single_model_fast, false);
assert.equal(openaiVector.titlePayload.provider_options.enable_evidence_completion, true);
assert.equal(openaiVector.titlePayload.provider_options.enable_stored_visual_features, true);

{
  let titleCalled = false;
  const report = await evaluateCloudListingApi({
    dataset,
    baseUrl: "https://lynca.example",
    provider: "gemini",
    limit: 0,
    concurrency: 1,
    username: "listing",
    password: "password",
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/login") {
        return jsonResponse(200, { ok: true }, {
          "set-cookie": "lynca_metaverse_session=test-cookie; Path=/"
        });
      }
      if (path === "/api/listing-provider-status") {
        return jsonResponse(200, { providers: [], default_provider: "gemini" });
      }
      if (path === "/api/listing-copilot-title") titleCalled = true;
      throw new Error(`unexpected fetch path for limit=0: ${path}`);
    }
  });
  assert.equal(report.target_count, 0);
  assert.equal(report.attempted_count, 0);
  assert.equal(titleCalled, false);
}

await assert.rejects(
  () => runProvider("agnes"),
  /Unsupported cloud eval provider/i
);

await assert.rejects(
  () => runProvider("gemini_gpt_failure_fallback"),
  /Unsupported cloud eval provider/i
);

assert.doesNotThrow(() => validateProtectionBypassSecret({
  bypassSecret: "valid-vercel-bypass-token",
  env: {
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test"
  }
}));

assert.throws(
  () => validateProtectionBypassSecret({
    bypassSecret: "sb_secret_test",
    env: {}
  }),
  /looks like a Supabase secret key/i
);

assert.throws(
  () => validateProtectionBypassSecret({
    bypassSecret: "same-secret",
    env: {
      SUPABASE_SERVICE_ROLE_KEY: "same-secret"
    }
  }),
  /matches a Supabase service\/secret key/i
);

console.log("cloud listing API eval tests passed");
