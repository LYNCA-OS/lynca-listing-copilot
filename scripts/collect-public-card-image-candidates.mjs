import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "public-card-image-candidates-v1";
const defaultOutPath = "data/public-card-candidates/public-card-image-candidates-latest.json";
const defaultApiBaseUrl = "https://api.pokemontcg.io/v2";
const defaultQuery = "supertype:Pokémon";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeId(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9._:-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}

function apiUrlForCard(baseUrl, cardId) {
  const trimmedBase = String(baseUrl || defaultApiBaseUrl).replace(/\/+$/, "");
  return `${trimmedBase}/cards/${encodeURIComponent(cardId)}`;
}

function searchUrl({
  baseUrl,
  query,
  page,
  pageSize,
  orderBy
}) {
  const url = new URL(`${String(baseUrl || defaultApiBaseUrl).replace(/\/+$/, "")}/cards`);
  url.searchParams.set("q", query || defaultQuery);
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("select", "id,name,supertype,subtypes,number,set,rarity,images");
  if (orderBy) url.searchParams.set("orderBy", orderBy);
  return url;
}

function imageUrlsFromCard(card = {}) {
  return [card.images?.large, card.images?.small]
    .map(normalizeText)
    .filter(isHttpsUrl)
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function normalizeCardCandidate(card, {
  apiBaseUrl = defaultApiBaseUrl
} = {}) {
  const id = normalizeText(card.id);
  const cardName = normalizeText(card.name);
  const supertype = normalizeText(card.supertype);
  const images = imageUrlsFromCard(card);

  if (!id || !cardName || supertype !== "Pokémon" || !images.length) return null;

  return {
    candidate_id: normalizeId(`pokemon-${id}`),
    category: "pokemon_card",
    source_provider: "pokemon_tcg_api",
    source_type: "PUBLIC_STRUCTURED_CARD_DATABASE",
    trust_tier: "STRUCTURED_REFERENCE",
    commercial_accuracy_eval_eligible: false,
    name_reference_eval_eligible: true,
    ground_truth_status: "structured_reference_label",
    source_card_id: id,
    source_card_url: apiUrlForCard(apiBaseUrl, id),
    card_image_url: images[0],
    image_urls: images,
    reference: {
      card_name: cardName,
      set_name: normalizeText(card.set?.name),
      set_id: normalizeText(card.set?.id),
      set_series: normalizeText(card.set?.series),
      release_date: normalizeText(card.set?.releaseDate),
      collector_number: normalizeText(card.number),
      rarity: normalizeText(card.rarity),
      supertype,
      subtypes: Array.isArray(card.subtypes) ? card.subtypes.map(normalizeText).filter(Boolean) : []
    },
    note: "Card image and name are collected from a public structured card API. This supports reference-name testing only and is not commercial held-out acceptance evidence."
  };
}

async function fetchJson(fetchImpl, url, headers) {
  const response = await fetchImpl(url, { headers });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Public card API returned non-JSON response with status ${response.status}.`);
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
    throw new Error(`Public card API request failed: ${message}`);
  }
  return payload;
}

export async function collectPublicCardImageCandidates({
  targetCount = 300,
  apiBaseUrl = defaultApiBaseUrl,
  query = defaultQuery,
  orderBy = "-set.releaseDate,number",
  pageSize = 250,
  maxPages = 10,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date()
} = {}) {
  if (typeof fetchImpl !== "function") {
    return {
      schema_version: schemaVersion,
      status: "skipped",
      created_at: now().toISOString(),
      source_provider: "pokemon_tcg_api",
      target_count: targetCount,
      collected_count: 0,
      blocked_reason: "fetch is not available.",
      pages: [],
      items: []
    };
  }

  const headers = {};
  if (env.POKEMON_TCG_API_KEY) headers["x-api-key"] = env.POKEMON_TCG_API_KEY;

  const items = [];
  const seen = new Set();
  const pages = [];

  for (let page = 1; page <= maxPages && items.length < targetCount; page += 1) {
    const url = searchUrl({
      baseUrl: apiBaseUrl,
      query,
      page,
      pageSize: Math.min(250, pageSize),
      orderBy
    });
    const payload = await fetchJson(fetchImpl, url, headers);
    const cards = Array.isArray(payload?.data) ? payload.data : [];
    let imported = 0;
    let rejected = 0;

    for (const card of cards) {
      if (items.length >= targetCount) break;
      const candidate = normalizeCardCandidate(card, { apiBaseUrl });
      if (!candidate) {
        rejected += 1;
        continue;
      }
      if (seen.has(candidate.source_card_id)) continue;
      seen.add(candidate.source_card_id);
      imported += 1;
      items.push(candidate);
    }

    pages.push({
      page,
      status: "fetched",
      returned_count: cards.length,
      imported_count: imported,
      rejected_count: rejected,
      api_count: payload?.count ?? cards.length,
      api_total_count: payload?.totalCount ?? null
    });

    if (cards.length === 0 || cards.length < Math.min(250, pageSize)) break;
  }

  return {
    schema_version: schemaVersion,
    status: items.length >= targetCount ? "collected" : (items.length ? "partial" : "empty"),
    created_at: now().toISOString(),
    source_provider: "pokemon_tcg_api",
    source_endpoint: `${String(apiBaseUrl || defaultApiBaseUrl).replace(/\/+$/, "")}/cards`,
    source_query: query,
    source_policy: "card_images_only",
    target_count: targetCount,
    collected_count: items.length,
    commercial_accuracy_eval_eligible: false,
    name_reference_eval_eligible: items.length > 0,
    blocked_reason: items.length >= targetCount ? "" : "Collected fewer public card image candidates than requested.",
    pages,
    items
  };
}

export function formatPublicCardCandidateSummary(report = {}) {
  const pageCount = Array.isArray(report.pages) ? report.pages.length : 0;
  return [
    `public card image candidate collection ${report.status || "unknown"}`,
    `source_provider: ${report.source_provider || "unknown"}`,
    `target_count: ${report.target_count ?? "n/a"}`,
    `collected_count: ${report.collected_count ?? "n/a"}`,
    `page_runs: ${pageCount}`,
    `card_images_only: true`,
    `name_reference_eval_eligible: ${report.name_reference_eval_eligible === true}`,
    `commercial_accuracy_eval_eligible: false`,
    `blocked_reason: ${report.blocked_reason || "none"}`
  ].join("\n");
}

export async function main(argv = process.argv, env = process.env) {
  const outPath = argValue(argv, "--out", env.PUBLIC_CARD_IMAGE_CANDIDATES_OUT || defaultOutPath);
  const targetCount = numberArg(argv, "--target", Number(env.PUBLIC_CARD_IMAGE_CANDIDATE_TARGET || 300));
  const pageSize = Math.min(250, numberArg(argv, "--page-size", Number(env.PUBLIC_CARD_IMAGE_CANDIDATE_PAGE_SIZE || 250)));
  const maxPages = Math.min(100, numberArg(argv, "--max-pages", Number(env.PUBLIC_CARD_IMAGE_CANDIDATE_MAX_PAGES || 10)));
  const query = argValue(argv, "--query", env.PUBLIC_CARD_IMAGE_CANDIDATE_QUERY || defaultQuery);
  const orderBy = argValue(argv, "--order-by", env.PUBLIC_CARD_IMAGE_CANDIDATE_ORDER_BY || "-set.releaseDate,number");
  const apiBaseUrl = argValue(argv, "--api-base-url", env.POKEMON_TCG_API_BASE_URL || defaultApiBaseUrl);
  const report = await collectPublicCardImageCandidates({
    targetCount,
    apiBaseUrl,
    query,
    orderBy,
    pageSize,
    maxPages,
    env
  });

  if (outPath) {
    const resolvedOut = resolve(outPath);
    if (!existsSync(dirname(resolvedOut))) await mkdir(dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, `${JSON.stringify(report, null, 2)}\n`);
  }

  process.stdout.write(`${formatPublicCardCandidateSummary(report)}\n`);
  return report.status === "collected" ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`public card image candidate collection failed: ${error.message}`);
    process.exit(1);
  }
}
