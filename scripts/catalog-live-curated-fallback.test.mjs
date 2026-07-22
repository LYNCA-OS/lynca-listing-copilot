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

{
  const startedUrls = [];
  let releaseProviders;
  const allProvidersStarted = new Promise((resolve) => {
    releaseProviders = resolve;
  });
  const concurrentFetch = async (url) => {
    startedUrls.push(String(url));
    if (startedUrls.length === 3) releaseProviders();
    await allProvidersStarted;
    return new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const provider = catalogProvider({
    env: {
      ENABLE_CATALOG_RETRIEVAL: "true",
      ENABLE_LIVE_CURATED_CATALOG_FALLBACK: "true",
      CATALOG_LIVE_CURATED_MAX_PROVIDERS: "3",
      CATALOG_LIVE_CURATED_TIMEOUT_MS: "500"
    },
    fetchImpl: concurrentFetch
  });
  const result = await provider.search({
    query: { search_text: "Pokemon Magic Yugioh", exact_product: "TCG" },
    resolved: { category: "tcg", product: "Pokemon Magic Yugioh" }
  });
  assert.equal(result.unavailable, true);
  assert.equal(startedUrls.length, 3, "live catalog providers must fan out concurrently instead of forming a serial latency chain");
}

{
  const neverFetch = (_url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  const provider = catalogProvider({
    env: {
      ENABLE_CATALOG_RETRIEVAL: "true",
      ENABLE_LIVE_CURATED_CATALOG_FALLBACK: "true",
      CATALOG_LIVE_CURATED_TIMEOUT_MS: "50"
    },
    fetchImpl: neverFetch
  });
  const startedAt = Date.now();
  const result = await provider.search({
    query: { exact_product: "Pokemon", exact_subject: "Pikachu" },
    resolved: { category: "tcg", product: "Pokemon", players: ["Pikachu"] }
  });
  assert.equal(result.unavailable, true);
  assert.equal(Date.now() - startedAt < 500, true, "a stalled live catalog must fail closed inside its bounded deadline");
}

{
  const isolatedFetch = (url, options = {}) => {
    if (/api\.pokemontcg\.io/i.test(String(url))) {
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
    if (/api\.scryfall\.com/i.test(String(url))) {
      return Promise.resolve(new Response(JSON.stringify({
        data: [{
          id: "mtg-black-lotus",
          oracle_id: "oracle-black-lotus",
          name: "Black Lotus",
          set_name: "Limited Edition Alpha",
          collector_number: "232",
          rarity: "rare",
          type_line: "Artifact"
        }]
      }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
  };
  const provider = catalogProvider({
    env: {
      ENABLE_CATALOG_RETRIEVAL: "true",
      ENABLE_LIVE_CURATED_CATALOG_FALLBACK: "true",
      CATALOG_LIVE_CURATED_TIMEOUT_MS: "50"
    },
    fetchImpl: isolatedFetch
  });
  const startedAt = Date.now();
  const result = await provider.search({
    query: {
      search_text: "Pokemon Magic Black Lotus",
      exact_subject: "Black Lotus",
      exact_product: "Magic"
    },
    resolved: { category: "tcg", product: "Magic", players: ["Black Lotus"] }
  });
  assert.equal(result.candidates.some((candidate) => candidate.fields?.card_name === "Black Lotus"), true,
    "a healthy catalog must survive an adjacent provider timeout");
  assert.equal(Date.now() - startedAt < 500, true, "provider isolation must preserve the shared catalog deadline");
}

console.log("catalog live curated fallback tests passed");
