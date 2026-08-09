#!/usr/bin/env node
// COS-42 endpoint behaviour. No network: the persistence boundary is injected.
import assert from "node:assert/strict";
import {
  composeResolutionView, handleResolutionViewRequest, handleResolutionReviewRequest,
  publicExternalIdentitySupport
} from "../api/csm-resolution-view.js";
import { REVIEW_VERDICT, CORRECTION_REASON } from "../lib/listing/csm/resolution-review.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  buildCsmStageRows,
  THIN_COMPOSER_VERSION_V1
} from "../lib/listing/thin/csm-persistence.mjs";
import { readCsmResolutionRecord } from "../lib/listing/thin/csm-supabase-writer.mjs";
import {
  CSM_OWNER_EXECUTION_RECEIPT_KEYS,
  CSM_OWNER_EXECUTION_RECEIPT_VERSION,
  sealCsmOwnerExecutionReceipt
} from "../lib/listing/thin/csm-owner-execution-receipt.mjs";
import { EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID } from "../lib/listing/knowledge/csm-external-identity-support.mjs";

const OWNER_RECEIPT_SHA256 = "b".repeat(64);

const payload = JSON.stringify({
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor", parallel_exact: "",
  descriptive_rarity: "", subjects: ["Shohei Ohtani"], team: "Dodgers", card_number: "150",
  serial: "17/50", attributes: ["RC"], grading_info: null, grammar: "standard",
  lot_count: "", language: "", unreadable: [], low_confidence: []
});
const record = {
  asset_id: "asset-1", recognition_session_id: "sess-1", resolution_id: "res-1",
  output_id: "out-1", canonical_payload: payload,
  output_title: composeResolutionView({ canonical_payload: payload }).composed.title,
  resolver_version: "thin-path-observation-only-v1",
  owner_execution_receipt: {
    version: CSM_OWNER_EXECUTION_RECEIPT_VERSION,
    sha256: OWNER_RECEIPT_SHA256,
    provider_response_id: "must-not-leave-the-server"
  }
};
const deps = { readRecord: async () => record, appendReview: async ({ review }) => review };

const legacyPayload = {
  year: "2018", manufacturer: "Topps", product: "Topps Silver Pack", set: "",
  subjects: ["Shohei Ohtani"], team: "", card_name: "1983 Chrome Promo",
  release_variant: "", surface_color: "Blue", parallel_family: "Refractor",
  parallel_exact: "Blue Refractor", descriptive_rarity: "", card_number: "",
  serial: "018/150", attributes: ["RC"], grading_info: {
    company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY"
  }, grammar: "standard", lot_count: "", language: "", unreadable: [], low_confidence: []
};
const legacyFields = parseCanonicalFields(legacyPayload).fields;
const legacyComposed = composeFromCanonicalFields(legacyFields, {
  features: { exact_parallel_color_compaction: false }
});
const legacyRows = buildCsmStageRows({
  tenantId: "t1", recognitionSessionId: "legacy-session",
  fields: legacyFields, composed: legacyComposed, title: legacyComposed.title
});
legacyRows.output.composer_version = THIN_COMPOSER_VERSION_V1;
legacyRows.output.title = legacyComposed.title;
const legacyRecord = {
  asset_id: "legacy-asset", recognition_session_id: "legacy-session",
  resolution_id: legacyRows.resolution.id, output_id: legacyRows.output.id,
  output_title: legacyComposed.title, composer_version: THIN_COMPOSER_VERSION_V1,
  resolver_version: "thin-path-observation-only-v1", replay_rows: legacyRows
};

// --- the view is a pure read -------------------------------------------------
{
  const view = await handleResolutionViewRequest({ tenantId: "t1", assetId: "asset-1", dependencies: deps });
  assert.ok(view.brackets.length >= 13);
  assert.equal(view.composer.recomposed_matches_stored, true);
  assert.equal(view.composer.trace_reliable, true);
  assert.ok(view.composer.composer_version, "the version the trace was produced under travels with it");
  assert.deepEqual(view.owner_execution_receipt, {
    version: CSM_OWNER_EXECUTION_RECEIPT_VERSION,
    sha256: OWNER_RECEIPT_SHA256
  });
  assert.doesNotMatch(JSON.stringify(view.owner_execution_receipt), /must-not-leave-the-server/,
    "the resolution route exposes only the allow-listed receipt version and hash");
}

// --- the safe receipt is recomputed from the durable session JSON ------------
{
  const rawOwner = Object.fromEntries(
    CSM_OWNER_EXECUTION_RECEIPT_KEYS.map((key) => [key, null])
  );
  Object.assign(rawOwner, {
    provider: "openai",
    model: "gpt-5.6-luna",
    provider_response_id: "resp_private_readback",
    provider_request_id: "req_private_readback",
    composer: "thin-marketplace-composer-v2",
    resolver: "thin-path-observation-only-v1"
  });
  const storedOwner = sealCsmOwnerExecutionReceipt(rawOwner);
  const requested = [];
  const dbFetch = async (rawUrl) => {
    const url = new URL(rawUrl);
    requested.push(url);
    if (url.pathname.endsWith("/v4_recognition_sessions")) {
      return new Response(JSON.stringify([{
        id: "session-db", asset_id: "asset-db", created_at: "2026-08-09T00:00:00Z",
        csm_owner_versions: storedOwner
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/csm_marketplace_outputs")) {
      return new Response(JSON.stringify([{
        id: "output-db", tenant_id: "tenant-db", recognition_session_id: "session-db",
        resolution_id: "resolution-db", structured_output: {}, title: "stored-title",
        composer_version: "thin-marketplace-composer-v2",
        marketplace: "EBAY", marketplace_profile_version: "ebay-profile-v1",
        contract_version: "csm-stage-shadow-v2", created_at: "2026-08-09T00:00:00Z"
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/csm_identity_resolutions")) {
      return new Response(JSON.stringify([{
        id: "resolution-db", resolver_version: "thin-path-observation-only-v1",
        conflict_policy_version: "none-single-observation-v1",
        registry_release_id: "registry_thin_20260801_v1",
        grammar: "NON_TCG", contract_version: "csm-stage-shadow-v2", revision: 1
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/csm_resolved_brackets")) {
      return new Response("[]", { status: 200 });
    }
    return new Response("[]", { status: 404 });
  };
  const durable = await readCsmResolutionRecord({
    tenantId: "tenant-db",
    assetId: "asset-db",
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: dbFetch
  });
  assert.match(
    requested.find((url) => url.pathname.endsWith("/v4_recognition_sessions"))
      .searchParams.get("select"),
    /csm_owner_versions/,
    "the resolution read must fetch the receipt from the durable session row"
  );
  assert.deepEqual(durable.owner_execution_receipt, {
    version: CSM_OWNER_EXECUTION_RECEIPT_VERSION,
    sha256: storedOwner.owner_execution_receipt_sha256
  });
  assert.equal(durable.registry_release_id, "registry_thin_20260801_v1");
  assert.equal(durable.conflict_policy_version, "none-single-observation-v1");
  assert.equal(durable.marketplace_profile_version, "ebay-profile-v1");
  assert.ok(!requested.some((url) => url.pathname.endsWith("/csm_evidence_observations")),
    "a baseline read must not pay for an external-evidence query");
  assert.ok(!requested.some((url) => url.pathname.endsWith("/csm_registry_releases")),
    "a baseline read must not pay for an external Registry query");
  assert.doesNotMatch(JSON.stringify(durable.owner_execution_receipt),
    /resp_private_readback|req_private_readback|stored-title/,
    "raw provider ids and title must not enter the public receipt projection");

  const tamperedOwner = { ...storedOwner, output_tokens: 1 };
  await assert.rejects(
    () => readCsmResolutionRecord({
      tenantId: "tenant-db",
      assetId: "asset-db",
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role"
      },
      fetchImpl: async (rawUrl) => {
        const url = new URL(rawUrl);
        if (url.pathname.endsWith("/v4_recognition_sessions")) {
          return new Response(JSON.stringify([{
            id: "session-db", asset_id: "asset-db", csm_owner_versions: tamperedOwner
          }]), { status: 200 });
        }
        return dbFetch(rawUrl);
      }
    }),
    /csm_owner_execution_receipt_invalid/,
    "the GET path must fail closed when durable owner bytes no longer match the saved hash"
  );
}

// --- APPLIED external identity is visible only through a safe DB projection -
{
  const packSha256 = "1".repeat(64);
  const indexSha256 = "2".repeat(64);
  const contractSha256 = "3".repeat(64);
  const tcdbFact = "4".repeat(64);
  const psaFact = "5".repeat(64);
  const beckettFact = "6".repeat(64);
  const originalSetSha256 = "9".repeat(64);
  const storedExternal = {
    schema_version: "csm-external-identity-support-receipt.v1",
    pack_id: "lynca.csm.external-identity",
    pack_sha256: packSha256,
    index_id: "basketball.1996-97-topps-stadium-club-high-risers",
    index_version: "tcdb-2551.psa-25618.beckett-3117708.2026-08-10",
    index_sha256: indexSha256,
    record_id: "tcdb-2551-hr14",
    match_mode: "VERIFIED_ORIGINAL_SET",
    original_set_sha256: originalSetSha256,
    field_decisions: {
      card_number: {
        action: "CORROBORATE", observed_value: "HR14", canonical_value: "HR14",
        source_ids: ["tcdb.set.2551", "psa.set-registry.25618", "beckett.item.3117708", "evil.item.1"]
      },
      team: {
        action: "FILL", observed_value: "", canonical_value: "Chicago Bulls",
        source_ids: ["tcdb.set.2551", "beckett.item.3117708"]
      }
    }
  };
  const sources = {
    tcdb: {
      source_id: "tcdb.set.2551",
      url: "https://www.tcdb.com/Checklist.cfm/sid/2551/High-Risers?secret=drop-me#fragment",
      retrieved_at: "2026-08-10", fact_sha256: tcdbFact, raw_payload: "must-not-leave-db"
    },
    psa: {
      source_id: "psa.set-registry.25618",
      url: "https://www.psacard.com/psasetregistry/composition/25618",
      retrieved_at: "2026-08-10", fact_sha256: psaFact
    },
    beckett: {
      source_id: "beckett.item.3117708",
      url: "https://www.beckett.com/basketball/item/3117708",
      retrieved_at: "2026-08-10", fact_sha256: beckettFact
    },
    wrongHost: {
      source_id: "tcdb.set.evil", url: "https://attacker.example/steal",
      retrieved_at: "2026-08-10", fact_sha256: "7".repeat(64)
    },
    wrongScheme: {
      source_id: "psa.set-registry.http", url: "http://www.psacard.com/not-https",
      retrieved_at: "2026-08-10", fact_sha256: "8".repeat(64)
    }
  };
  const sourceRef = (field, supportedSources) => ({
    support_type: "EXACT_EXTERNAL_IDENTITY",
    field,
    decision: storedExternal.field_decisions[field].action,
    pack_id: storedExternal.pack_id,
    pack_sha256: packSha256,
    index_id: storedExternal.index_id,
    index_version: storedExternal.index_version,
    index_sha256: indexSha256,
    record_id: storedExternal.record_id,
    match_mode: storedExternal.match_mode,
    original_set_sha256: originalSetSha256,
    sources: supportedSources,
    raw_registry_payload: { api_key: "must-not-leave-db" }
  });
  const requested = [];
  const externalFetch = async (rawUrl) => {
    const url = new URL(rawUrl);
    requested.push(url);
    if (url.pathname.endsWith("/v4_recognition_sessions")) {
      return new Response(JSON.stringify([{
        id: "external-session", asset_id: "external-asset", created_at: "2026-08-10T00:00:00Z",
        csm_owner_versions: null
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/csm_marketplace_outputs")) {
      return new Response(JSON.stringify([{
        id: "external-output", tenant_id: "tenant-db", recognition_session_id: "external-session",
        resolution_id: "external-resolution", structured_output: { external_identity_support: storedExternal },
        title: "1996-97 Topps Stadium Club High Risers Michael Jordan #HR14 Chicago Bulls",
        composer_version: "thin-marketplace-composer-v3-verified-external-identity",
        marketplace: "EBAY", marketplace_profile_version: "ebay-verified-external-identity-v1",
        contract_version: "csm-stage-shadow-v2", created_at: "2026-08-10T00:00:00Z"
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/csm_identity_resolutions")) {
      return new Response(JSON.stringify([{
        id: "external-resolution", resolver_version: "thin-path-exact-external-identity-v1",
        conflict_policy_version: "exact-unique-visible-conflict-wins-v1",
        registry_release_id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
        grammar: "NON_TCG", contract_version: "csm-stage-shadow-v2", revision: 1
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/csm_resolved_brackets")) return new Response("[]", { status: 200 });
    if (url.pathname.endsWith("/csm_registry_releases")) {
      return new Response(JSON.stringify([{
        id: EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID,
        registry_version: "thin-path-external-identity-high-risers-v1",
        content_sha256: packSha256,
        sem_standard_version: "linear-cos-10-23-v25",
        registry_payload: {
          pack_id: storedExternal.pack_id, pack_version: "2026-08-10", pack_sha256: packSha256,
          index_id: storedExternal.index_id, index_sha256: indexSha256,
          resolution_contract_sha256: contractSha256,
          raw_payload: { secret: "must-not-leave-db" }
        }
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/csm_evidence_observations")) {
      return new Response(JSON.stringify([
        { source_ref: sourceRef("card_number", [sources.tcdb, sources.psa, sources.beckett, sources.wrongHost, sources.wrongScheme]) },
        { source_ref: sourceRef("team", [sources.tcdb, sources.beckett]) }
      ]), { status: 200 });
    }
    return new Response("[]", { status: 404 });
  };

  const durable = await readCsmResolutionRecord({
    tenantId: "tenant-db", assetId: "external-asset",
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: externalFetch
  });
  const support = durable.external_identity_support;
  assert.equal(durable.registry_release_id, EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID);
  assert.equal(support.status, "APPLIED");
  assert.equal(support.match_basis, "VERIFIED_ORIGINAL_SET");
  assert.equal(support.registry_release.id, EXTERNAL_IDENTITY_REGISTRY_RELEASE_ID);
  assert.equal(support.registry_release.content_sha256, packSha256);
  assert.equal(support.resolution_contract_sha256, contractSha256);
  assert.equal(support.index.version, storedExternal.index_version);
  assert.deepEqual(support.supported_fields, ["team", "card_number"].sort((a, b) => (
    ["year", "manufacturer", "product", "set", "subjects", "team", "card_number"].indexOf(a)
      - ["year", "manufacturer", "product", "set", "subjects", "team", "card_number"].indexOf(b)
  )));
  assert.deepEqual(support.sources.map((source) => source.provider).sort(), ["Beckett", "PSA", "TCDB"]);
  assert.equal(support.sources.find((source) => source.provider === "TCDB").url,
    "https://www.tcdb.com/Checklist.cfm/sid/2551/High-Risers",
    "query strings and fragments must not become public provenance");
  assert.deepEqual(support.sources.find((source) => source.provider === "TCDB").fields,
    ["card_number", "team"]);
  assert.deepEqual(support.field_decisions.team, {
    action: "FILL", source_ids: ["beckett.item.3117708", "tcdb.set.2551"]
  });
  assert.equal(Object.prototype.hasOwnProperty.call(support, "original_set_sha256"), false,
    "the public match basis must not expose the private original-set digest");
  assert.doesNotMatch(JSON.stringify(support),
    /must-not-leave|raw_payload|canonical_value|observed_value|attacker\.example|not-https|api_key/,
    "raw Registry/evidence payload and rejected URLs must stop at the DB projection");

  const evidenceRead = requested.find((url) => url.pathname.endsWith("/csm_evidence_observations"));
  assert.equal(evidenceRead.searchParams.get("select"), "source_ref");
  assert.equal(evidenceRead.searchParams.get("modality"), "eq.REGISTRY");
  assert.doesNotMatch(evidenceRead.searchParams.get("select"), /raw_value|normalized_value/);
  const resolutionRead = requested.find((url) => url.pathname.endsWith("/csm_identity_resolutions"));
  assert.match(resolutionRead.searchParams.get("select"), /registry_release_id/);
  assert.match(resolutionRead.searchParams.get("select"), /conflict_policy_version/);

  const view = await handleResolutionViewRequest({
    tenantId: "tenant-db", assetId: "asset-1",
    dependencies: { readRecord: async () => ({
      ...record,
      resolver_version: support.resolver_version,
      external_identity_support: {
        ...support,
        raw_registry_payload: { secret: "must-not-leave-view" }
      }
    }) }
  });
  assert.equal(view.external_identity_support.sources.length, 3);
  assert.equal(view.external_identity_support.match_basis, "VERIFIED_ORIGINAL_SET");
  assert.equal(view.summary.external_supported_fields, 2);
  for (const bracket of view.brackets.filter((entry) => ["team", "card_number"].includes(entry.canonical_field))) {
    assert.ok(bracket.rationale_codes.includes("EXACT_EXTERNAL_IDENTITY_SUPPORT"));
    assert.equal(bracket.semantic_confidence, "VERIFIED_EXTERNAL");
    assert.equal(bracket.alternates_unavailable_reason, "EXACT_EXTERNAL_IDENTITY_RESOLUTION");
  }
  assert.doesNotMatch(JSON.stringify(view), /must-not-leave-view|raw_registry_payload/);
  assert.deepEqual(publicExternalIdentitySupport({ ...support, sources: [sources.wrongHost] }), null,
    "an injected non-allowlisted source cannot create a public APPLIED receipt");
  assert.deepEqual(publicExternalIdentitySupport({ ...support, match_basis: "UNKNOWN" }), null,
    "an unknown match basis cannot cross the public receipt boundary");

  const mismatchedBasis = await readCsmResolutionRecord({
    tenantId: "tenant-db", assetId: "external-asset",
    env: {
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: async (rawUrl) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith("/csm_evidence_observations")) {
        return new Response(JSON.stringify([{
          source_ref: {
            ...sourceRef("card_number", [sources.tcdb]),
            original_set_sha256: "a".repeat(64)
          }
        }]), { status: 200 });
      }
      return externalFetch(rawUrl);
    }
  });
  assert.equal(mismatchedBasis.external_identity_support, undefined,
    "public match basis requires the durable Registry evidence to bind the same private set digest");
}

// --- a stored title the current composer no longer reproduces is flagged ------
{
  const drifted = { ...record, output_title: "2025 Topps Chrome Something Else" };
  const view = await handleResolutionViewRequest({
    tenantId: "t1", assetId: "asset-1",
    dependencies: { ...deps, readRecord: async () => drifted }
  });
  assert.equal(view.composer.recomposed_matches_stored, false);
  assert.equal(view.composer.trace_reliable, false,
    "an operator must not be told a bracket was dropped for budget when the shipped title came from other code");
}

// --- stored Composer versions remain executable, including in review --------
{
  const replayed = composeResolutionView(legacyRecord);
  assert.equal(replayed.composer_version, THIN_COMPOSER_VERSION_V1);
  assert.equal(replayed.composed.title, legacyComposed.title);
  assert.doesNotMatch(replayed.composed.title, /\bBlue\b/,
    "the Glass Box must not reinterpret a historical v1 title with v2 compaction");
  assert.doesNotMatch(replayed.compose_corrected_title({ ...legacyFields, team: "Dodgers" }), /\bBlue\b/,
    "review recomposition must execute the stored v1 contract as well");

  const view = await handleResolutionViewRequest({
    tenantId: "t1", assetId: legacyRecord.asset_id,
    dependencies: { readRecord: async () => legacyRecord }
  });
  assert.equal(view.composer.composer_version, THIN_COMPOSER_VERSION_V1);
  assert.equal(view.composer.recomposed_matches_stored, true);
  assert.equal(view.composer.trace_reliable, true);
  assert.equal(view.owner_execution_receipt, null,
    "pre-v1 persisted runs stay readable without inventing a durable owner receipt");

  const review = await handleResolutionReviewRequest({
    tenantId: "t1", reviewerId: "u1",
    payload: {
      asset_id: legacyRecord.asset_id,
      verdict: REVIEW_VERDICT.CORRECTED,
      corrections: [{
        bracket: "set", canonical_field: "set", reason: CORRECTION_REASON.MISSED_VALUE,
        original_value: "", corrected_value: "Sapphire Selections"
      }]
    },
    dependencies: { readRecord: async () => legacyRecord, appendReview: async ({ review: value }) => value }
  });
  assert.equal(review.composer_version, THIN_COMPOSER_VERSION_V1);
  assert.equal(review.original_title, legacyComposed.title);
}

// --- a missing run is 404, not an empty view ---------------------------------
{
  await assert.rejects(
    () => handleResolutionViewRequest({ tenantId: "t1", assetId: "nope", dependencies: { readRecord: async () => null } }),
    (error) => error.statusCode === 404);
}

// --- review: the corrected title comes from corrected fields only -------------
{
  let appended = null;
  const review = await handleResolutionReviewRequest({
    tenantId: "t1", reviewerId: "u1",
    payload: {
      asset_id: "asset-1",
      verdict: REVIEW_VERDICT.CORRECTED,
      corrections: [{ bracket: "set", canonical_field: "set", reason: CORRECTION_REASON.MISSED_VALUE, original_value: "", corrected_value: "Sapphire Selections" }],
      // A reviewer's own title, which must be ignored entirely.
      corrected_title: "WHATEVER THE REVIEWER TYPED"
    },
    dependencies: { ...deps, appendReview: async ({ review: r }) => { appended = r; return r; } }
  });
  assert.match(review.corrected_title, /Sapphire Selections/);
  assert.ok(!/WHATEVER/.test(review.corrected_title),
    "a title in the payload must never reach the record");
  assert.equal(review.original_title, record.output_title, "the shipped output is preserved");
  assert.ok(appended, "the review is persisted");
  assert.equal(appended.revision_sha256, review.revision_sha256);
  // Provenance is filled from the stored run, not from the client.
  assert.equal(review.resolution_id, "res-1");
  assert.equal(review.output_id, "out-1");
  assert.equal(review.reviewer_id, "u1");
}

// --- review: an approval cannot carry corrections ----------------------------
{
  await assert.rejects(() => handleResolutionReviewRequest({
    tenantId: "t1", reviewerId: "u1",
    payload: { asset_id: "asset-1", verdict: REVIEW_VERDICT.APPROVED, corrections: [{ bracket: "set", reason: CORRECTION_REASON.WRONG_VALUE, corrected_value: "x" }] },
    dependencies: deps
  }), /approved_with_corrections/);
}

console.log("csm-resolution-api.test.mjs OK");

// COS-42 (founder, 2026-08-04): "Field-level semantic approval/correction is a
// separate trusted reviewer/admin workflow; it is not the default writer
// workflow." A writer's title edit is cleaned commercial feedback, and the
// route from editing a title to rewriting canonical fields must not exist.
{
  const { TENANT_PERMISSIONS, permissionScopeFor } = await import("../lib/tenant/permissions.mjs");
  const REVIEW = TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS;
  assert.ok(REVIEW, "the review workflow needs its own permission, not a borrowed one");
  assert.equal(permissionScopeFor("WRITER", REVIEW), "NONE",
    "a writer must not be able to approve or correct canonical fields");
  assert.notEqual(permissionScopeFor("OWNER", REVIEW), "NONE");
  assert.notEqual(permissionScopeFor("MANAGER", REVIEW), "NONE");
  // The separation is the point: writers keep the title edit they had.
  assert.notEqual(permissionScopeFor("WRITER", TENANT_PERMISSIONS.EDIT_TITLE), "NONE",
    "writers still edit titles; that is commercial feedback, not semantic truth");

  // And the endpoint must ask for the reviewer permission, not the writer one.
  const source = await (await import("node:fs/promises")).readFile(
    new URL("../api/csm-resolution-view.js", import.meta.url), "utf8");
  assert.match(source, /TENANT_PERMISSIONS\.REVIEW_SEMANTIC_FIELDS/,
    "the POST path gates on the reviewer permission");
  // The USAGE, not any mention: the comment above that line names the two
  // non-existent constants it replaced, and a whole-file regex would fail on
  // the explanation rather than on the code.
  assert.ok(!/TENANT_PERMISSIONS\.(WRITE|READ)_LISTING/.test(source),
    "those constants never existed and read as undefined at the permission check");
}

console.log("csm-resolution-api reviewer-workflow assertions OK");
