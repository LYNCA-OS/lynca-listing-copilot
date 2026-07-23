import assert from "node:assert/strict";
import {
  catalogImportStatuses,
  catalogSourceTypes
} from "../lib/listing/catalog/catalog-contract.mjs";
import {
  createOfficialCatalogSourceAdapter,
  ExternalCatalogAdapter
} from "../lib/listing/catalog/official-catalog-source-adapter.mjs";
import { catalogProvider } from "../lib/listing/retrieval/catalog-provider.mjs";
import {
  buildVectorCandidateAssistPacket,
  buildVectorCandidatePacket,
  vectorCandidatePacketAssistEligibility
} from "../lib/listing/retrieval/vector-candidate-packet.mjs";
import { retrievalTrustTiers } from "../lib/listing/retrieval/retrieval-contract.mjs";

function rpcRowFromStagingRow(row = {}, {
  identityId = "11111111-1111-4111-8111-111111111111",
  retrievalStatus = "registry",
  normalizedScore = 0.84
} = {}) {
  const staging = row.staging || row;
  return {
    identity_id: identityId,
    canonical_title: staging.canonical_title,
    identity_key: staging.source_row_key,
    fields: staging.identity_fields || {},
    retrieval_status: retrievalStatus,
    category: staging.identity_fields?.category || staging.identity_fields?.sport || "",
    source_type: staging.source_type,
    source_status: staging.import_status,
    supporting_fields: ["checklist_code", "collector_number", "players", "product"],
    raw_score: normalizedScore,
    normalized_score: normalizedScore,
    expected_serial_denominator: staging.identity_fields?.serial_denominator || ""
  };
}

async function catalogSearchFromRows(rows = []) {
  let body = null;
  const provider = catalogProvider({
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      ENABLE_CATALOG_RETRIEVAL: "true"
    },
    fetchImpl: async (url, options = {}) => {
      if (/supabase\.test\/rest\/v1\/rpc\/search_catalog_candidates/i.test(String(url)) && options.method === "POST") {
        body = JSON.parse(String(options.body || "{}"));
      }
      return new Response(JSON.stringify(rows), { status: 200 });
    }
  });
  const result = await provider.search({
    query: {
      exact_card_number: "OP01-001",
      exact_subject: "Monkey D. Luffy",
      exact_product: "Romance Dawn"
    },
    resolved: {
      category: "tcg",
      product: "Romance Dawn",
      players: ["Monkey D. Luffy"],
      collector_number: "OP01-001"
    }
  });
  return { body, result };
}

{
  const adapter = createOfficialCatalogSourceAdapter({
    provider: "one_piece",
    fetchImpl: async () => new Response('<dl class="modalCol" id="OP01-001"><dt><div class="infoCol"><span>OP01-001</span> | <span>L</span> | <span>LEADER</span></div><div class="cardName">Monkey D. Luffy</div></dt><dd><img data-src="../images/cardlist/card/OP01-001.png"><div class="getInfo"><h3>Card Set(s)</h3>-ROMANCE DAWN- [OP01]</div></dd></dl>', {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });
  const report = await adapter.buildImportReport({
    sourceUrls: [{
      href: "https://en.onepiece-cardgame.com/cardlist/?series=556101",
      text: "One Piece Romance Dawn"
    }]
  });
  assert.equal(report.staging_only, true);
  assert.equal(report.reviewed_internal_auto_promotion, false);
  assert.equal(report.external_title_final_title_allowed, false);
  assert.equal(report.paid_recognition_eval_ran, false);
  assert.equal(report.metrics.source_count, 1);
  assert.equal(report.metrics.fetched_count, 1);
  assert.equal(report.metrics.parse_success_count, 1);
  assert.equal(report.metrics.card_count, 1);
  assert.equal(report.metrics.review_required_count, 0);

  const staging = report.raw.staging[0].staging;
  assert.equal(staging.source_type, catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST);
  assert.equal(staging.import_status, catalogImportStatuses.OFFICIAL_CHECKLIST_CANDIDATE);
  assert.deepEqual(staging.physical_instance_fields, {});
  assert.equal(staging.identity_fields.serial_number, undefined);
  assert.equal(staging.identity_fields.serial_numerator, undefined);
  assert.equal(staging.identity_fields.card_grade, undefined);
  assert.equal(staging.identity_fields.cert_number, undefined);

  const { body, result } = await catalogSearchFromRows([rpcRowFromStagingRow(report.raw.staging[0])]);
  assert.equal(body.exact_card_number, "OP01-001");
  assert.equal(result.candidates.length >= 1, true);
  const officialCandidate = result.candidates.find((candidate) => (
    candidate.reference_metadata.source_type === catalogSourceTypes.BANDAI_ONE_PIECE_OFFICIAL_CARDLIST
    && candidate.fields?.collector_number === "OP01-001"
  ));
  assert.ok(officialCandidate);
  assert.equal(officialCandidate.source_type, "OFFICIAL_CHECKLIST");
  assert.equal(officialCandidate.trust_tier, retrievalTrustTiers.OFFICIAL);
  assert.equal(officialCandidate.field_derivation.reviewed_ground_truth_used, false);
  assert.equal(officialCandidate.field_derivation.title_derived_fields_are_ground_truth, false);

  const packet = buildVectorCandidatePacket({ sources: [officialCandidate] }, {
    queryFields: {
      category: "tcg",
      product: "Romance Dawn",
      players: ["Monkey D. Luffy"],
      collector_number: "OP01-001"
    }
  });
  const eligibility = vectorCandidatePacketAssistEligibility(packet);
  assert.equal(eligibility.prompt_candidate_count, 1);
  assert.deepEqual(eligibility.prompt_candidate_ids, ["11111111-1111-4111-8111-111111111111"]);
  const assistPacket = buildVectorCandidateAssistPacket(packet);
  assert.equal(assistPacket.vector_retrieval.candidates.length, 1);
  assert.equal(assistPacket.vector_retrieval.candidates[0].fields.serial_number, undefined);
  assert.equal(assistPacket.vector_retrieval.candidates[0].fields.grade_company, undefined);
  assert.equal(assistPacket.vector_retrieval.candidates[0].fields.card_grade, undefined);
  assert.equal(/\b\d+\s*\/\s*\d+\b/.test(assistPacket.vector_retrieval.candidates[0].reference_title), false);
}

{
  const adapter = new ExternalCatalogAdapter({
    provider: "pokemon_tcg_api",
    fetchImpl: async () => new Response(JSON.stringify({
      data: [{
        id: "sv1-001",
        name: "Sprigatito",
        number: "001",
        rarity: "Common",
        supertype: "Pokemon",
        set: { name: "Scarlet & Violet", series: "Scarlet & Violet" }
      }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const report = await adapter.buildImportReport({
    sourceUrls: [{
      href: "https://api.pokemontcg.io/v2/cards?q=set.id:sv1",
      text: "Pokemon TCG API Scarlet & Violet"
    }]
  });
  const staging = report.raw.staging[0].staging;
  assert.equal(staging.source_type, catalogSourceTypes.POKEMON_TCG_COMMUNITY_API);
  assert.equal(staging.import_status, catalogImportStatuses.COMMUNITY_API_CANDIDATE);
  assert.equal(staging.source_trust, catalogSourceTypes.EXTERNAL_DIRECTORY_WEAK);

  const { result } = await catalogSearchFromRows([rpcRowFromStagingRow(report.raw.staging[0], {
    identityId: "22222222-2222-4222-8222-222222222222",
    retrievalStatus: "candidate"
  })]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source_type, "STRUCTURED_DATABASE");
  assert.equal(result.candidates[0].trust_tier, retrievalTrustTiers.STRUCTURED);

  const packet = buildVectorCandidatePacket({ sources: result.candidates }, {
    queryFields: {
      category: "tcg",
      product: "Scarlet & Violet",
      players: ["Sprigatito"],
      collector_number: "001"
    }
  });
  const eligibility = vectorCandidatePacketAssistEligibility(packet);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "no_approved_identity_candidate");
  assert.equal(eligibility.prompt_candidate_count, 0);
  assert.equal(buildVectorCandidateAssistPacket(packet).vector_retrieval.candidates.length, 0);
}

console.log("catalog system compatibility tests passed");
