import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeCloudTiming } from "./analyze-cloud-timing.mjs";
import { compareVectorLazyGuardrail } from "./compare-vector-lazy-guardrail.mjs";

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

const dir = await mkdtemp(join(tmpdir(), "lynca-cloud-timing-"));

try {
  const noLazyPath = join(dir, "no-lazy.json");
  const lazyPath = join(dir, "lazy.json");
  const noLazy = {
    provider: "openai_vector",
    catalog_recovery_count: 1,
    catalog_regression_count: 0,
    per_card_latency_ms: { p50: 2000, p95: 2600 },
    results: [
      {
        candidate_id: "card-1",
        provider: "openai_vector",
        title: "2025 Topps Chrome Test Player",
        corrected_title_reference: "2025 Topps Chrome Test Player",
        corrected_title_comparison: { token_recall: 1 },
        catalog_cache_hit: false,
        vector_lazy_skip: false,
        retrieval_title_assist_used: true,
        catalog_prompt_candidate_count: 1,
        vector_prompt_candidate_count: 1,
        timing: {
          total_ms: 2000,
          catalog_retrieval_ms: 90,
          vector_embedding_ms: 500,
          vector_retrieval_ms: 300,
          provider_total_ms: 1000,
          evidence_completion_ms: 50,
          resolver_ms: 10,
          renderer_ms: 8
        }
      }
    ]
  };
  const lazy = {
    provider: "openai_vector",
    catalog_recovery_count: 1,
    catalog_regression_count: 0,
    per_card_latency_ms: { p50: 1200, p95: 1400 },
    results: [
      {
        candidate_id: "card-1",
        provider: "openai_vector",
        title: "2025 Topps Chrome Test Player",
        corrected_title_reference: "2025 Topps Chrome Test Player",
        corrected_title_comparison: { token_recall: 1 },
        catalog_cache_hit: true,
        vector_lazy_skip: true,
        vector_lazy_skip_reason: "vector_lazy_strong_catalog_anchor",
        retrieval_title_assist_used: true,
        catalog_prompt_candidate_count: 1,
        vector_prompt_candidate_count: 0,
        timing: {
          total_ms: 1200,
          catalog_retrieval_ms: 20,
          catalog_cache_ms: 1,
          vector_embedding_ms: 0,
          vector_retrieval_ms: 0,
          provider_total_ms: 1000,
          evidence_completion_ms: 40,
          resolver_ms: 9,
          renderer_ms: 8
        }
      }
    ]
  };
  await writeJson(noLazyPath, noLazy);
  await writeJson(lazyPath, lazy);

  const timing = await analyzeCloudTiming({ inputPaths: [lazyPath] });
  assert.equal(timing.result_count, 1);
  assert.equal(timing.summary.vector_lazy_skip_count, 1);
  assert.equal(timing.summary.catalog_cache_hit_rate, 1);
  assert.equal(timing.summary.timing.total_ms.p50, 1200);
  assert.equal(timing.groups.vector_lazy_skip.true.count, 1);
  assert.equal(timing.groups.retrieval_title_assist_used.true.timing.provider_total_ms.p95, 1000);

  const guardrail = await compareVectorLazyGuardrail({ noLazyPath, lazyPath });
  assert.equal(guardrail.status, "passed");
  assert.equal(guardrail.summary.vector_lazy_skip_count, 1);
  assert.equal(guardrail.summary.vector_lazy_skip_regression_count, 0);
  assert.equal(guardrail.summary.p50_delta_ms, -800);
  assert.equal(guardrail.summary.timing_improved, true);
  assert.equal(guardrail.summary.card_type_default_base_count.lazy, 0);

  const regressedPath = join(dir, "lazy-regressed.json");
  await writeJson(regressedPath, {
    ...lazy,
    per_card_latency_ms: { p50: 1100, p95: 1300 },
    results: [{
      ...lazy.results[0],
      title: "2025 Topps Chrome Wrong Player",
      corrected_title_comparison: { token_recall: 0.6 }
    }]
  });
  const failed = await compareVectorLazyGuardrail({ noLazyPath, lazyPath: regressedPath });
  assert.equal(failed.status, "failed");
  assert.equal(failed.summary.vector_lazy_skip_regression_count, 1);

  const slowPath = join(dir, "lazy-slow.json");
  await writeJson(slowPath, {
    ...lazy,
    per_card_latency_ms: { p50: 2100, p95: 2700 }
  });
  const slow = await compareVectorLazyGuardrail({ noLazyPath, lazyPath: slowPath });
  assert.equal(slow.status, "failed");
  assert.equal(slow.summary.timing_improved, false);
  assert.ok(slow.summary.fail_reasons.includes("TIMING_NOT_IMPROVED"));

  const noSkipPath = join(dir, "lazy-no-skip.json");
  await writeJson(noSkipPath, {
    ...lazy,
    results: [{
      ...lazy.results[0],
      vector_lazy_skip: false,
      vector_lazy_skip_reason: null
    }]
  });
  const noSkip = await compareVectorLazyGuardrail({ noLazyPath, lazyPath: noSkipPath });
  assert.equal(noSkip.status, "failed");
  assert.equal(noSkip.summary.vector_lazy_skip_sample_requirement_met, false);
  assert.ok(noSkip.summary.fail_reasons.includes("NO_VECTOR_LAZY_SKIP_SAMPLES"));

  console.log("cloud timing guardrail tests passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
