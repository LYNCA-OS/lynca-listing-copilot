#!/usr/bin/env node

import { runDirectCsmAsset } from "../api/csm-listing-title.js";

const value = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const tenantId = value("--tenant", "tenant_legacy");
const assets = value("--assets").split(",").map((item) => item.trim()).filter(Boolean);
const sessions = value("--sessions").split(",").map((item) => item.trim()).filter(Boolean);
const expected = value("--expect", "TCG,NON_TCG").split(",").map((item) => item.trim()).filter(Boolean);
if (!assets.length || assets.length !== sessions.length || assets.length !== expected.length) {
  throw new Error("pass matching --assets, --sessions, and --expect comma-separated lists");
}

const results = await Promise.all(assets.map(async (assetId, index) => {
  const recognitionSessionId = sessions[index];
  const result = await runDirectCsmAsset({
    tenantId, userId: "", assetId,
    dependencies: {
      createSessionId: () => recognitionSessionId,
      createSession: async () => ({
        sessionId: recognitionSessionId,
        persistence: { recognition_session: { saved: true, reused: true } }
      })
    }
  });
  const grammar = result.csm_rows.resolution.grammar;
  if (grammar !== expected[index]) {
    throw new Error(`${assetId}: expected ${expected[index]}, received ${grammar}`);
  }
  if (!result.csm_persistence.ok || result.title.length > 80) {
    throw new Error(`${assetId}: ${JSON.stringify({
      title_length: result.title.length,
      persistence: result.csm_persistence
    })}`);
  }
  return {
    asset_id: assetId,
    recognition_session_id: result.csm_rows.resolution.recognition_session_id,
    grammar,
    title: result.title,
    title_length: result.title.length,
    persisted_tables: result.csm_persistence.written,
    resolution_id: result.csm_rows.resolution.id,
    canonical_bracket_count: result.csm_rows.resolved.length,
    cloud_run_calls: 0,
    vector_calls: 0,
    ocr_calls: 0
  };
}));

process.stdout.write(`${JSON.stringify({ ok: true, results }, null, 2)}\n`);
