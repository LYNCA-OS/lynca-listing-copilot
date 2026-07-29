import assert from "node:assert/strict";
import test from "node:test";

import {
  persistWriterReadySession,
  resolveExactAnchorCandidate
} from "../api/v4/listing-copilot-title.js";
import { createEvidenceField, createVisionSource } from "../lib/listing/evidence/evidence-schema.mjs";
import { adaptRecognitionResultToV4 } from "../lib/listing/v4/result-adapter.mjs";
import { maybeFinalizeL1FromExactAnchor } from "../lib/listing/v4/fast-scout/exact-anchor-finalize.mjs";

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role"
};

function directEvidence(value, side = "back") {
  const observedText = Array.isArray(value) ? value.join(" / ") : String(value);
  const source = createVisionSource({
    sourceType: side === "back" ? "CARD_BACK" : "CARD_FRONT",
    imageId: side,
    side,
    observedText,
    rawText: observedText,
    trustTier: 1
  });
  return createEvidenceField({
    value,
    normalizedValue: value,
    status: "CONFIRMED",
    confidence: 0.97,
    candidates: [{ value, confidence: 0.97, sources: [source] }],
    sources: [source],
    conflicts: []
  });
}

const officialRow = {
  identity_id: "tcg-identity-1",
  canonical_title: "2022 One Piece Romance Dawn Shanks OP01-120 SEC",
  retrieval_status: "registry",
  source_type: "BANDAI_ONE_PIECE_OFFICIAL_CARDLIST",
  normalized_score: 1,
  supporting_fields: ["collector_number"],
  fields: {
    year: "2022",
    product: "Romance Dawn",
    players: ["Shanks"],
    collector_number: "OP01-120",
    rarity: "SEC"
  }
};

test("API exposes an Exact Anchor title only after Resolver accepts the candidate", async () => {
  const scoutResult = {
    resolved_fields: {
      year: "2022",
      product: "Romance Dawn",
      players: ["Shanks"],
      tcg_card_number: "OP01-120"
    },
    evidence: {
      year: directEvidence("2022"),
      product: directEvidence("Romance Dawn"),
      players: directEvidence(["Shanks"], "front"),
      tcg_card_number: directEvidence("OP01-120")
    }
  };
  const finalize = await maybeFinalizeL1FromExactAnchor({
    scoutResult,
    env,
    fetchImpl: async () => ({ ok: true, json: async () => [officialRow] }),
    policy: { allow_tcg_code_only: true, allow_catalog_finalize: true, allow_cert_lane: false }
  });
  const resolution = resolveExactAnchorCandidate(finalize, scoutResult);

  assert.equal(finalize.title, undefined);
  assert.equal(resolution.writer_ready, true);
  assert.equal(resolution.result.identity_resolution_status, "CONFIRMED");
  assert.equal(resolution.result.title_render_source, "identity_resolution_deterministic_renderer");
  assert.ok(resolution.result.final_title.length > 0);
  assert.ok(resolution.result.final_title.length <= 80);
  assert.equal(resolution.result.retrieval_application.resolver_consumed, true);
});

test("a forged legacy title without resolver_input cannot cross the writer barrier", () => {
  const resolution = resolveExactAnchorCandidate({
    finalized: true,
    title: "Catalog says this is final"
  });
  assert.equal(resolution.writer_ready, false);
  assert.equal(resolution.result, null);
});

test("V4 terminal rendering cannot widen the server title limit above 80", () => {
  const adapted = adaptRecognitionResultToV4({
    sessionId: "session-title-limit",
    payload: { maxTitleLength: 200 },
    result: {
      identity_resolution_status: "CONFIRMED",
      confidence: "HIGH",
      resolved_fields: {
        year: "2024-25",
        manufacturer: "Panini",
        product: "National Treasures Basketball First Off The Line Premium Edition",
        players: ["A Very Long Player Name With Additional Identity Context"],
        card_name: "Rookie Patch Autographs Brand Logo Anniversary Super Short Print",
        collector_number: "RPA-123456789",
        parallel: "Gold Vinyl Holofoil Refractor",
        grade_company: "PSA",
        card_grade: "10"
      }
    }
  });

  assert.ok(adapted.final_title.length > 0);
  assert.ok(adapted.final_title.length <= 80);
  assert.equal(adapted.provider_result.effective_terminal_renderer_inputs.max_title_length, 80);
});

test("writer-ready persistence fails closed before writing an overlong terminal title", async () => {
  let writeAttempts = 0;
  await assert.rejects(
    persistWriterReadySession({
      sessionId: "session-overlong-title",
      patch: {
        final_title: "X".repeat(81),
        l2_title: "X".repeat(81)
      },
      updateSession: async () => {
        writeAttempts += 1;
        return { saved: true };
      }
    }),
    (error) => error?.code === "V4_TERMINAL_TITLE_LENGTH_EXCEEDED"
  );
  assert.equal(writeAttempts, 0);
});
