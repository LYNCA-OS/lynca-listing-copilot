import assert from "node:assert/strict";
import {
  buildRetrievalApplicationReplay,
  retrievalApplicationReplaySchemaVersion
} from "../lib/listing/evaluation/retrieval-application-replay.mjs";

function packet(candidates = [], promptCandidateIds = []) {
  return {
    vector_retrieval: {
      status: "ok",
      candidates,
      assist_filter: {
        raw_candidate_count: candidates.length,
        approved_candidate_count: candidates.length,
        prompt_candidate_count: promptCandidateIds.length,
        prompt_candidate_ids: promptCandidateIds
      },
      latency_ms: 17
    }
  };
}

function candidate() {
  return {
    candidate_id: "catalog-exact",
    candidate_identity_id: "identity-exact",
    source_type: "OFFICIAL_CHECKLIST",
    source_trust: "REVIEWED_INTERNAL",
    match_score: 0.96,
    anchor_agreement: {
      exact_code_match: true,
      prompt_hard_filter_pass: true,
      agreed: ["collector_number", "subjects", "product_hierarchy", "year"],
      contradicted: []
    },
    fields: {
      year: "2025",
      manufacturer: "Topps",
      product: "Topps Chrome Sapphire",
      players: ["Shohei Ohtani"],
      card_name: "Autograph",
      collector_number: "CSA-SO",
      grade_company: "PSA",
      card_grade: "10",
      cert_number: "12345678"
    }
  };
}

function directResult() {
  const selected = candidate();
  const directSource = {
    source_type: "SLAB_LABEL",
    observed_text: "2025 TOPPS SAPPHIRE",
    raw_text: "2025 TOPPS SAPPHIRE",
    evidence_kind: "PRODUCT_TEXT",
    direct_observation: true,
    trust_tier: 1,
    created_at: "2026-07-15T01:02:03.000Z"
  };
  const rawCandidateSource = {
    source_type: "STRUCTURED_DATABASE",
    source_url: "supabase://catalog-cards/raw-bypass",
    domain: "supabase-catalog",
    title: "Wrong Product",
    evidence_kind: "catalog_identity_field_lock",
    trust_tier: 4,
    created_at: "2026-07-15T01:02:04.000Z"
  };
  const resolved = {
    year: "2025",
    manufacturer: "Topps",
    product: "Topps Sapphire",
    players: ["Shohei Ohtani"],
    collector_number: "CSA-SO"
  };

  return {
    provider: "fixture-direct-observation",
    created_at: "2026-07-15T01:02:00.000Z",
    timing: {
      provider_ms: 210,
      retrieval_ms: 33
    },
    resolved_fields: resolved,
    raw_provider_fields: resolved,
    evidence: {
      product: {
        value: "Topps Sapphire",
        status: "CONFLICT",
        confidence: 0.5,
        candidates: [
          { value: "Topps Sapphire", confidence: 0.95, sources: [directSource] },
          { value: "Wrong Product", confidence: 0.86 },
          { value: "Wrong Product", confidence: 0.86 }
        ],
        sources: [directSource, rawCandidateSource, rawCandidateSource],
        conflicts: [{
          field: "product",
          existing_value: "Topps Sapphire",
          candidate_value: "Wrong Product",
          reason: "raw retrieval candidates disagree with direct observation"
        }]
      }
    },
    catalog_candidate_packet: packet([selected], [selected.candidate_id]),
    retrievalCandidates: [{
      candidate_id: "raw-option-bypass",
      source_type: "OFFICIAL_CHECKLIST",
      fields: {
        product: "Wrong Product",
        players: ["Wrong Player"]
      }
    }]
  };
}

function normalizedKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function volatilePaths(value, path = "result") {
  if (!value || typeof value !== "object") return [];
  const paths = [];
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    const childPath = `${path}.${key}`;
    if (normalized === "time"
      || normalized === "timestamp"
      || normalized === "timestamps"
      || normalized === "timing"
      || normalized === "timings"
      || normalized.endsWith("_at")
      || normalized.endsWith("_ms")
      || /(^|_)(latency|duration|elapsed|wall_time)(_|$)/.test(normalized)) {
      paths.push(childPath);
    }
    paths.push(...volatilePaths(child, childPath));
  }
  return paths;
}

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("replay must not call provider or retrieval network paths");
};

let replay;
const replaySource = directResult();
const replaySourceSnapshot = structuredClone(replaySource);
try {
  replay = await buildRetrievalApplicationReplay({ result: replaySource });
} finally {
  globalThis.fetch = originalFetch;
}

assert.equal(networkCalls, 0);
assert.deepEqual(replaySource, replaySourceSnapshot);
assert.equal(replay.schema_version, retrievalApplicationReplaySchemaVersion);
assert.equal(replay.shared.projection.resolver_options.retrieval_candidates.length, 0);
assert.equal(replay.shared.projection.resolver_options.retrieve_evidence, null);
assert.equal(replay.shared.projection.resolver_options.convergence.maxIterations, 1);
assert.equal(replay.arms.off.input_fingerprint, replay.shared.fingerprints.replay_input);
assert.equal(replay.arms.on.input_fingerprint, replay.shared.fingerprints.replay_input);
assert.deepEqual(
  replay.shared.projection.direct_observation.candidate_observation_snapshot,
  replay.shared.projection.candidate_selection.observation_snapshot
);

const off = replay.arms.off.semantic_projection;
const on = replay.arms.on.semantic_projection;
assert.equal(off.retrieval_application.enabled, false);
assert.equal(off.retrieval_application.identity_evidence_count, 0);
assert.deepEqual(off.retrieval_application.identity_evidence_fields, []);
assert.deepEqual(off.retrieval_application.identity_evidence_items, []);
assert.equal(off.retrieval_evidence_isolation.application_evidence_item_count, 0);

assert.equal(on.retrieval_application.enabled, true);
assert.equal(on.retrieval_application.resolver_consumed, true);
assert.ok(on.retrieval_application.identity_evidence_count > 0);
assert.equal(
  on.retrieval_evidence_isolation.application_evidence_item_count,
  on.retrieval_application.identity_evidence_count
);
assert.ok(on.retrieval_application.identity_evidence_fields.includes("product"));
assert.ok(on.retrieval_application.identity_evidence_fields.includes("card_name"));

const inventory = replay.shared.projection.candidate_selection.field_inventory;
for (const evidence of on.retrieval_application.identity_evidence_items) {
  const row = inventory.find((item) => (
    item.candidate_id === evidence.candidate_id && item.field === evidence.field
  ));
  assert.ok(row, `missing field inventory for ${evidence.candidate_id}.${evidence.field}`);
  assert.ok(["can_apply", "support_only"].includes(row.permission));
  assert.equal(evidence.permission, row.permission);
  assert.ok(["APPLY", "SUPPORT"].includes(evidence.decision));
}
for (const forbiddenField of ["grade_company", "card_grade", "cert_number"]) {
  assert.equal(on.retrieval_application.identity_evidence_fields.includes(forbiddenField), false);
}

assert.ok(off.retrieval_evidence_isolation.blocked_raw_candidate_evidence_count >= 1);
assert.ok(on.retrieval_evidence_isolation.blocked_raw_candidate_evidence_count >= 1);
assert.notEqual(off.resolved_fields.product, "Wrong Product");
assert.notEqual(on.resolved_fields.product, "Wrong Product");
assert.notDeepEqual(off.resolved_fields.players, ["Wrong Player"]);
assert.notDeepEqual(on.resolved_fields.players, ["Wrong Player"]);
assert.equal(on.resolved_fields.product, "Topps Chrome Sapphire");

for (const value of Object.values(replay.shared.fingerprints)) {
  assert.match(value, /^sha256:[a-f0-9]{64}$/);
}
assert.match(replay.arms.off.semantic_fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.match(replay.arms.on.semantic_fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.notEqual(replay.arms.off.semantic_fingerprint, replay.arms.on.semantic_fingerprint);
assert.deepEqual(volatilePaths(replay), []);

const timingVariant = directResult();
timingVariant.created_at = "2030-01-01T00:00:00.000Z";
timingVariant.timing = { provider_ms: 9999, retrieval_ms: 8888 };
timingVariant.catalog_candidate_packet.vector_retrieval.latency_ms = 7777;
const repeated = await buildRetrievalApplicationReplay({ result: timingVariant });
assert.deepEqual(repeated, replay);
assert.equal(repeated.arms.off.semantic_fingerprint, replay.arms.off.semantic_fingerprint);
assert.equal(repeated.arms.on.semantic_fingerprint, replay.arms.on.semantic_fingerprint);

console.log("retrieval application replay tests passed");
