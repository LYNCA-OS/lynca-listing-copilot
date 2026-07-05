import assert from "node:assert/strict";
import { catalogProvider } from "../lib/listing/retrieval/catalog-provider.mjs";
import { runRetrieval } from "../lib/listing/retrieval/retrieval-engine.mjs";
import {
  retrievalModes,
  retrievalProviderIds,
  retrievalQueryFamilies,
  retrievalSourceTypes,
  retrievalTrustTiers
} from "../lib/listing/retrieval/retrieval-contract.mjs";
import { createRetrievalProviderRegistry } from "../lib/listing/retrieval/retrieval-provider-registry.mjs";

const swuResponse = {
  total_cards: 1,
  data: [{
    Set: "SOR",
    Number: "188",
    Name: "Chopper",
    Subtitle: "Metal Menace",
    Type: "Unit",
    Aspects: ["Aggression"],
    Traits: ["DROID", "SPECTRE"],
    Rarity: "Rare",
    VariantType: "Normal",
    FrontArt: "https://cdn.swu-db.com/images/cards/SOR/188.png"
  }]
};

function liveFetch(url) {
  if (/api\.swu-db\.com\/cards\/search/i.test(String(url))) {
    return Promise.resolve(new Response(JSON.stringify(swuResponse), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
  }
  return Promise.resolve(new Response("[]", {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
}

const wrongSupabaseRows = [{
  identity_id: "wrong-local-row",
  identity_key: "wrong-local-row",
  canonical_title: "Wrong Local Similar Card #999",
  fields: {
    category: "tcg",
    product: "Wrong Local Product",
    players: ["Wrong Local Subject"],
    collector_number: "999"
  },
  retrieval_status: "reviewed",
  source_type: "INTERNAL_CORRECTED_TITLE",
  source_status: "AUTO_PARSED_FROM_VERIFIED_TITLE",
  supporting_fields: ["product", "players", "collector_number"],
  raw_score: 0.91,
  normalized_score: 0.91
}];

function supabaseAndLiveFetch(url, options = {}) {
  if (/supabase\.test\/rest\/v1\/rpc\/search_catalog_candidates/i.test(String(url)) && options.method === "POST") {
    return Promise.resolve(new Response(JSON.stringify(wrongSupabaseRows), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
  }
  return liveFetch(url, options);
}

{
  const provider = catalogProvider({
    env: {
      ENABLE_CATALOG_RETRIEVAL: "true",
      ENABLE_LIVE_CURATED_CATALOG_FALLBACK: "true"
    },
    fetchImpl: liveFetch
  });
  const result = await provider.search({
    query: {
      exact_subject: "Chopper",
      exact_product: "Star Wars Unlimited",
      exact_card_number: "188"
    },
    resolved: {
      category: "tcg",
      product: "Star Wars Unlimited",
      players: ["Chopper"],
      collector_number: "188"
    }
  });
  assert.equal(result.provider_id, retrievalProviderIds.CATALOG);
  assert.equal(result.unavailable, undefined);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source_type, retrievalSourceTypes.STRUCTURED_DATABASE);
  assert.equal(result.candidates[0].trust_tier, retrievalTrustTiers.STRUCTURED);
  assert.equal(result.candidates[0].reference_metadata.source_type, "EXTERNAL_DIRECTORY_WEAK");
  assert.equal(result.candidates[0].fields.card_name, "Chopper - Metal Menace");
  assert.equal(result.candidates[0].fields.collector_number, "188");
  assert.equal(result.candidates[0].fields.serial_number == null, true);
  assert.equal(result.candidates[0].fields.card_grade == null, true);
  assert.equal(result.candidates[0].fields.cert_number == null, true);
}

{
  const provider = catalogProvider({
    env: {
      ENABLE_CATALOG_RETRIEVAL: "true",
      ENABLE_LIVE_CURATED_CATALOG_FALLBACK: "true",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role"
    },
    fetchImpl: supabaseAndLiveFetch
  });
  const result = await provider.search({
    query: {
      exact_subject: "Chopper",
      exact_product: "Star Wars Unlimited",
      exact_card_number: "188"
    },
    resolved: {
      category: "tcg",
      product: "Star Wars Unlimited",
      players: ["Chopper"],
      collector_number: "188"
    }
  });
  assert.equal(result.provider_id, retrievalProviderIds.CATALOG);
  assert.equal(result.unavailable, undefined);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates.some((candidate) => candidate.candidate_identity_id === "wrong-local-row"), true);
  const liveCandidate = result.candidates.find((candidate) => candidate.fields?.card_name === "Chopper - Metal Menace");
  assert.ok(liveCandidate, "live curated catalog fallback must append even when Supabase returns wrong local rows");
  assert.equal(liveCandidate.reference_metadata.source_type, "EXTERNAL_DIRECTORY_WEAK");
  assert.equal(liveCandidate.source_trust, "");
  assert.equal(liveCandidate.fields.collector_number, "188");
}

{
  const registry = createRetrievalProviderRegistry({
    env: {
      ENABLE_CATALOG_RETRIEVAL: "true",
      ENABLE_LIVE_CURATED_CATALOG_FALLBACK: "true"
    },
    fetchImpl: liveFetch
  });
  const retrieval = await runRetrieval({
    resolved: {
      category: "tcg",
      product: "Star Wars Unlimited",
      players: ["Chopper"],
      collector_number: "188"
    },
    mode: retrievalModes.INTERNAL_ONLY,
    allowedFamilies: [
      retrievalQueryFamilies.CATALOG_EXACT_CODE,
      retrievalQueryFamilies.CATALOG_YEAR_PRODUCT_SUBJECT
    ],
    providerRegistry: registry,
    env: {
      ENABLE_CATALOG_RETRIEVAL: "true",
      ENABLE_LIVE_CURATED_CATALOG_FALLBACK: "true"
    }
  });
  assert.equal(retrieval.providers_used.includes(retrievalProviderIds.CATALOG), true);
  assert.equal(retrieval.sources.length >= 1, true);
  assert.equal(retrieval.sources.some((candidate) => candidate.fields?.card_name === "Chopper - Metal Menace"), true);
}

console.log("catalog live curated fallback tests passed");
