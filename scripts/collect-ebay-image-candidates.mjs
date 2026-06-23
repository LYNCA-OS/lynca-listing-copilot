import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ebayBrowseProvider } from "../lib/listing/retrieval/ebay-browse-provider.mjs";

const schemaVersion = "ebay-image-candidates-v1";
const defaultOutPath = "data/ebay-candidates/ebay-image-candidates-latest.json";
const defaultQueries = Object.freeze([
  "sports trading card PSA",
  "basketball card rookie PSA",
  "baseball card autograph numbered",
  "football card patch auto",
  "pokemon card graded"
]);

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function argValues(argv, name) {
  const values = [];
  argv.forEach((value, index) => {
    if (value === name && argv[index + 1]) values.push(argv[index + 1]);
  });
  return values;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stableId(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9._:-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
}

function imageUrlsFromCandidate(candidate = {}) {
  const fields = candidate.fields || {};
  const urls = [
    fields.marketplace_image_url,
    ...(Array.isArray(fields.marketplace_image_urls) ? fields.marketplace_image_urls : [])
  ]
    .map((url) => normalizeText(url))
    .filter((url) => /^https:\/\//i.test(url));

  return [...new Set(urls)];
}

function candidateKey(candidate = {}) {
  return normalizeText(candidate.fields?.marketplace_item_id)
    || normalizeText(candidate.source_url)
    || normalizeText(candidate.title);
}

function reportStatus({ configured, collectedCount, targetCount }) {
  if (!configured) return "skipped";
  if (collectedCount >= targetCount) return "collected";
  if (collectedCount > 0) return "partial";
  return "empty";
}

function blockedReason(provider) {
  if (provider.configured) return "";
  return "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are not configured.";
}

export async function collectEbayImageCandidates({
  targetCount = 300,
  queries = defaultQueries,
  perQueryLimit = 50,
  maxPagesPerQuery = 3,
  providerImpl = null,
  env = process.env,
  now = () => new Date()
} = {}) {
  const provider = providerImpl || ebayBrowseProvider({ env });
  const configured = provider.configured === true;
  const items = [];
  const seen = new Set();
  const queryReports = [];

  if (!configured) {
    return {
      schema_version: schemaVersion,
      status: "skipped",
      created_at: now().toISOString(),
      source: "ebay_browse",
      target_count: targetCount,
      collected_count: 0,
      blocked_reason: blockedReason(provider),
      queries: [],
      items: []
    };
  }

  for (const query of queries.map(normalizeText).filter(Boolean)) {
    for (let page = 0; page < maxPagesPerQuery && items.length < targetCount; page += 1) {
      const offset = page * perQueryLimit;
      const result = await provider.search({
        query: {
          query_id: `ebay_candidates_${queryReports.length + 1}`,
          query,
          limit: perQueryLimit,
          offset
        }
      });
      const candidates = Array.isArray(result.candidates) ? result.candidates : [];
      let withImages = 0;
      let imported = 0;

      if (result.unavailable) {
        queryReports.push({
          query,
          offset,
          status: "unavailable",
          reason: result.reason || "provider unavailable",
          returned_candidates: 0,
          candidates_with_images: 0,
          imported_candidates: 0
        });
        break;
      }

      candidates.forEach((candidate) => {
        if (items.length >= targetCount) return;
        const images = imageUrlsFromCandidate(candidate);
        if (!images.length) return;
        withImages += 1;

        const key = candidateKey(candidate);
        if (!key || seen.has(key)) return;
        seen.add(key);
        imported += 1;

        items.push({
          candidate_id: stableId(`ebay-${candidate.fields?.marketplace_item_id || items.length + 1}`),
          source_provider: "ebay_browse",
          source_type: "MARKETPLACE",
          trust_tier: "MARKET_REFERENCE",
          marketplace_item_id: normalizeText(candidate.fields?.marketplace_item_id),
          marketplace_id: normalizeText(candidate.fields?.marketplace_id || result.marketplace_id),
          item_url: normalizeText(candidate.source_url),
          title: normalizeText(candidate.title),
          image_url: images[0],
          image_urls: images,
          seller_title_is_ground_truth: false,
          ground_truth_status: "unlabeled",
          accuracy_eval_eligible: false,
          required_next_step: "operator_or_official_ground_truth_labeling",
          note: "Collected from eBay Browse as a market-reference image candidate only. Seller title must not be used as ground truth."
        });
      });

      queryReports.push({
        query,
        offset,
        status: "searched",
        returned_candidates: candidates.length,
        candidates_with_images: withImages,
        imported_candidates: imported,
        more_results_available: result.more_results_available === true
      });

      if (!result.more_results_available || candidates.length === 0) break;
    }
  }

  return {
    schema_version: schemaVersion,
    status: reportStatus({ configured, collectedCount: items.length, targetCount }),
    created_at: now().toISOString(),
    source: "ebay_browse",
    target_count: targetCount,
    collected_count: items.length,
    blocked_reason: items.length >= targetCount ? "" : "Collected fewer image candidates than requested.",
    queries: queryReports,
    items
  };
}

export function formatCollectionSummary(report = {}) {
  const queryCount = Array.isArray(report.queries) ? report.queries.length : 0;
  return [
    `eBay image candidate collection ${report.status || "unknown"}`,
    `target_count: ${report.target_count ?? "n/a"}`,
    `collected_count: ${report.collected_count ?? "n/a"}`,
    `query_runs: ${queryCount}`,
    `accuracy_eval_eligible: false`,
    `blocked_reason: ${report.blocked_reason || "none"}`,
    "ground_truth_policy: seller titles are market reference only and must not be used as ground truth"
  ].join("\n");
}

export async function main(argv = process.argv, env = process.env) {
  const outPath = argValue(argv, "--out", env.EBAY_IMAGE_CANDIDATES_OUT || defaultOutPath);
  const targetCount = numberArg(argv, "--target", Number(env.EBAY_IMAGE_CANDIDATE_TARGET || 300));
  const perQueryLimit = Math.min(200, numberArg(argv, "--limit", Number(env.EBAY_IMAGE_CANDIDATE_QUERY_LIMIT || 50)));
  const maxPagesPerQuery = Math.min(20, numberArg(argv, "--max-pages", Number(env.EBAY_IMAGE_CANDIDATE_MAX_PAGES || 3)));
  const queries = [
    ...argValues(argv, "--query"),
    ...normalizeText(env.EBAY_IMAGE_CANDIDATE_QUERIES).split("|").map(normalizeText).filter(Boolean)
  ];
  const report = await collectEbayImageCandidates({
    targetCount,
    queries: queries.length ? queries : defaultQueries,
    perQueryLimit,
    maxPagesPerQuery,
    env
  });

  if (outPath) {
    const resolvedOut = resolve(outPath);
    if (!existsSync(dirname(resolvedOut))) await mkdir(dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, `${JSON.stringify(report, null, 2)}\n`);
  }

  process.stdout.write(`${formatCollectionSummary(report)}\n`);
  return report.status === "collected" ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`eBay image candidate collection failed: ${error.message}`);
    process.exit(1);
  }
}
