import assert from "node:assert/strict";
import {
  anchorClasses,
  classifyAnchorText,
  collectAnchors,
  normalizeGrader,
  strongestIdentityAnchor,
  strongestInstanceAnchor
} from "../lib/listing/v4/anchors/anchor-classifier.mjs";
import { lookupCertIdentity, upsertCertRegistryEntry } from "../lib/listing/v4/anchors/cert-lookup.mjs";
import { certVisualVerification, maybeFinalizeL1FromExactAnchor } from "../lib/listing/v4/fast-scout/exact-anchor-finalize.mjs";

// --- classifier: the four anchor classes ---
assert.equal(classifyAnchorText("31/50").anchor_type, "numerical_rarity");
assert.equal(classifyAnchorText("31/50").anchor_class, anchorClasses.COMMERCIAL);
assert.equal(classifyAnchorText("31/50").lookup_key, false);

const cert = classifyAnchorText("87654321", { graderHint: "PSA 10" });
assert.equal(cert.anchor_type, "cert_number");
assert.equal(cert.anchor_class, anchorClasses.INSTANCE);
assert.equal(cert.grader, "PSA");
assert.equal(cert.lookup_target, "cert_registry");

assert.equal(classifyAnchorText("OP01-120").anchor_type, "tcg_card_code");
assert.equal(classifyAnchorText("OP01-120").anchor_class, anchorClasses.IDENTITY);
assert.equal(classifyAnchorText("CORI-JP028").anchor_type, "tcg_card_code");
assert.equal(classifyAnchorText("NB-TYG").anchor_type, "checklist_code");
assert.equal(classifyAnchorText("NB-TYG").anchor_class, anchorClasses.CATALOG);
assert.equal(classifyAnchorText("#136").anchor_type, "collector_number");
assert.equal(normalizeGrader("bgs 9.5"), "BGS");
assert.equal(classifyAnchorText("87654321").anchor_type, "barcode_candidate", "a bare long number must not become a cert");
assert.equal(classifyAnchorText("012345678901", { fieldHint: "barcode" }).anchor_type, "product_code");

// collectAnchors dedupes and keeps serial as commercial only
const anchors = collectAnchors({
  resolved: {
    cert_number: "87654321",
    grade_company: "PSA",
    checklist_code: "NB-TYG",
    serial_number: "04/10"
  }
});
assert.equal(strongestIdentityAnchor(anchors), null, "cert is an instance anchor, not a card identity anchor");
assert.equal(strongestInstanceAnchor(anchors).anchor_type, "cert_number");
assert.ok(anchors.every((a) => a.anchor_type !== "numerical_rarity" || a.lookup_key === false));

const mixedAnchors = collectAnchors({
  resolved: { cert_number: "87654321", grade_company: "PSA", tcg_card_number: "OP01-120" }
});
assert.equal(strongestIdentityAnchor(mixedAnchors).anchor_type, "tcg_card_code");
assert.equal(strongestInstanceAnchor(mixedAnchors).anchor_type, "cert_number");

// --- cert visual verification: verify what is visible, conflict fails ---
assert.equal(certVisualVerification(
  { players: ["Victor Wembanyama"], year: "2023-24", product: "Panini Prizm" },
  { players: ["Victor Wembanyama"], year: "2023", product: "Prizm" }
).pass, true);
const conflict = certVisualVerification(
  { players: ["LeBron James"], year: "2023" },
  { players: ["Michael Jordan"], year: "2023" }
);
assert.equal(conflict.pass, false);
assert.deepEqual(conflict.conflicts, ["subject"]);
// nothing checked on either side -> cannot pass (fail closed)
assert.equal(certVisualVerification({}, {}).pass, false);

const env = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test"
};

const registryRow = {
  grader: "PSA",
  cert_number: "87654321",
  identity: {
    year: "2023-24",
    manufacturer: "Panini",
    product: "Panini Prizm",
    players: ["Victor Wembanyama"],
    collector_number: "136"
  },
  grade: "PSA 10",
  canonical_title: "2023-24 Panini Prizm Victor Wembanyama #136",
  source: "writer_feedback",
  review_status: "REVIEWED_INTERNAL"
};

function registryFetch(rows) {
  return async (url) => {
    assert.match(String(url), /cert_registry/);
    return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) };
  };
}

// --- lookup: single hit resolves, multi-grader ambiguity fails closed ---
{
  const hit = await lookupCertIdentity({ grader: "PSA", certNumber: "87654321", env, fetchImpl: registryFetch([registryRow]) });
  assert.equal(hit.found, true);
  assert.equal(hit.source, "INTERNAL_CERT_REGISTRY");
  assert.equal(hit.identity.players[0], "Victor Wembanyama");

  const ambiguous = await lookupCertIdentity({ certNumber: "87654321", env, fetchImpl: registryFetch([registryRow, { ...registryRow, grader: "SGC" }]) });
  assert.equal(ambiguous.found, false);
  assert.equal(ambiguous.reason, "cert_ambiguous_across_graders");
}

// --- upsert guards ---
{
  const missing = await upsertCertRegistryEntry({ grader: "", certNumber: "123", env, fetchImpl: async () => ({ ok: true }) });
  assert.equal(missing.saved, false);
}

// --- end-to-end cert lane inside the L1 finalize entry ---
{
  const scoutResult = {
    resolved_fields: {
      players: ["Victor Wembanyama"],
      year: "2023-24",
      product: "Panini Prizm",
      cert_number: "87654321",
      grade_company: "PSA",
      card_grade: "10",
      serial_number: "04/10",
      print_run_denominator: "10"
    },
    evidence: {}
  };
  const result = await maybeFinalizeL1FromExactAnchor({
    scoutResult,
    env,
    fetchImpl: registryFetch([registryRow]),
    timeoutMs: 1500
  });
  assert.equal(result.finalized, true, JSON.stringify(result).slice(0, 300));
  assert.equal(result.reason, "cert_registry_finalized");
  assert.equal(result.anchor_lookup_candidate.source, "INTERNAL_CERT_REGISTRY");
  assert.equal(result.identity_resolution.status, "CONFIRMED");
  // identity from registry, instance from current image
  assert.equal(result.resolved_fields.collector_number, "136");
  assert.equal(result.resolved_fields.serial_number, "04/10");
  assert.match(result.title, /Wembanyama/);
}

// --- cert conflict: REVIEW_REQUIRED, no finalize through any lane ---
{
  const scoutResult = {
    resolved_fields: {
      players: ["LeBron James"],
      year: "2023-24",
      cert_number: "87654321",
      grade_company: "PSA"
    },
    evidence: {}
  };
  const result = await maybeFinalizeL1FromExactAnchor({
    scoutResult,
    env,
    fetchImpl: registryFetch([registryRow]),
    timeoutMs: 1500
  });
  assert.equal(result.finalized, false);
  assert.equal(result.reason, "cert_conflict_review_required");
  assert.equal(result.review_required, true);
  assert.equal(result.identity_resolution.status, "REVIEW_REQUIRED");
  assert.deepEqual(result.visual_verification.conflicts, ["subject"]);
}

// --- kill switch ---
{
  const result = await maybeFinalizeL1FromExactAnchor({
    scoutResult: { resolved_fields: { cert_number: "87654321", grade_company: "PSA", players: ["X"], year: "2023" } },
    env: { ...env, ENABLE_V4_CERT_LOOKUP_LANE: "false" },
    fetchImpl: async () => {
      throw new Error("must not query registry when lane disabled");
    },
    timeoutMs: 300
  });
  assert.equal(result.finalized, false);
}

console.log("anchor-first-path.test.mjs OK");
