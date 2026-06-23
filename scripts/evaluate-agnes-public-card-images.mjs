import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCardEvidenceWithAgnes } from "../lib/listing/providers/agnes-provider.mjs";
import { safeProviderErrorMessage } from "../lib/listing/providers/provider-errors.mjs";
import { resolveTrustedNameCandidate } from "../lib/listing/resolver/trusted-name-candidate-resolver.mjs";

const schemaVersion = "agnes-public-card-image-eval-v1";
const defaultDatasetPath = "data/public-card-candidates/public-card-image-candidates-latest.json";
const defaultOutPath = "data/eval/agnes-public-card-image-eval-latest.json";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function booleanFromEnv(env, key, fallback = false) {
  const value = env[key];
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalName(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalNumber(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/\s+/g, "");
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function referenceForItem(item = {}) {
  return {
    card_name: normalizeText(item.reference?.card_name),
    set_name: normalizeText(item.reference?.set_name),
    collector_number: normalizeText(item.reference?.collector_number)
  };
}

function predictionFromResult(result = {}) {
  const parsed = result.parsed || {};
  const fields = parsed.fields || {};
  return {
    card_name: normalizeText(fields.card_name || fields.name || fields.player || fields.character || parsed.title || parsed.model_title_suggestion),
    set_name: normalizeText(fields.set_name || fields.set || fields.product),
    collector_number: normalizeText(fields.collector_number || fields.card_number || fields.number),
    confidence: normalizeText(parsed.confidence),
    reason: normalizeText(parsed.reason),
    parse_source: normalizeText(result.parse_source),
    model_id: normalizeText(result.model_id),
    finish_reason: normalizeText(result.finish_reason)
  };
}

function checksForPrediction(reference, prediction) {
  const expectedName = canonicalName(reference.card_name);
  const predictedName = canonicalName(prediction.card_name);
  const expectedSet = canonicalName(reference.set_name);
  const predictedSet = canonicalName(prediction.set_name);
  const expectedNumber = canonicalNumber(reference.collector_number);
  const predictedNumber = canonicalNumber(prediction.collector_number);

  return {
    card_name_exact: Boolean(expectedName && predictedName && expectedName === predictedName),
    card_name_loose: Boolean(expectedName && predictedName && (expectedName === predictedName || expectedName.includes(predictedName) || predictedName.includes(expectedName))),
    set_name_exact: Boolean(expectedSet && predictedSet && expectedSet === predictedSet),
    collector_number_exact: Boolean(expectedNumber && predictedNumber && expectedNumber === predictedNumber)
  };
}

function trustedNameCandidatesFromDataset(dataset = {}) {
  return (Array.isArray(dataset.items) ? dataset.items : [])
    .filter((item) => item.category === "pokemon_card")
    .map((item) => ({
      candidate_id: item.candidate_id,
      source_card_id: item.source_card_id,
      name: item.reference?.card_name,
      source_type: item.source_type || "PUBLIC_STRUCTURED_CARD_DATABASE",
      trust_tier: item.trust_tier || "STRUCTURED_REFERENCE"
    }))
    .filter((item) => item.name);
}

function evaluationPrompt(item = {}) {
  return [
    "You are evaluating one collectible card image for Listing Copilot.",
    "Read the printed card image directly. Do not use outside knowledge.",
    "Return only valid JSON in this exact shape:",
    JSON.stringify({
      title: "Card Name",
      confidence: "LOW",
      reason: "short evidence note",
      fields: {
        card_name: "printed card name at the top of the card",
        set_name: "printed set or expansion name if visible, otherwise empty string",
        collector_number: "printed collector number if visible, otherwise empty string"
      },
      unresolved: []
    }),
    "Rules:",
    "- card_name must be the visible printed card name, not a product title.",
    "- If the set name or collector number is not visible, return an empty string for that field.",
    "- Do not include Markdown fences or prose outside the JSON.",
    `Reference source id for audit only: ${item.source_card_id || item.candidate_id || "unknown"}.`
  ].join("\n");
}

async function evaluateOneCard(item, {
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes
} = {}) {
  const reference = referenceForItem(item);
  const imageUrl = normalizeText(item.card_image_url || item.image_url || item.image_urls?.[0]);
  const base = {
    candidate_id: item.candidate_id,
    source_card_id: item.source_card_id,
    source_provider: item.source_provider,
    category: item.category,
    card_image_url: imageUrl,
    reference
  };

  if (!reference.card_name || !imageUrl) {
    return {
      ...base,
      status: "invalid_candidate",
      checks: {
        card_name_exact: false,
        card_name_loose: false,
        set_name_exact: false,
        collector_number_exact: false
      },
      error: "Candidate is missing card_name reference or image URL."
    };
  }

  try {
    const result = await analyzeImpl({
      images: [
        {
          name: item.candidate_id || item.source_card_id || "public-card-image",
          url: imageUrl
        }
      ],
      prompt: evaluationPrompt(item),
      env
    });
    const prediction = predictionFromResult(result);
    const checks = checksForPrediction(reference, prediction);
    return {
      ...base,
      status: "evaluated",
      prediction,
      checks,
      usage: result.usage || null
    };
  } catch (error) {
    return {
      ...base,
      status: "provider_error",
      checks: {
        card_name_exact: false,
        card_name_loose: false,
        set_name_exact: false,
        collector_number_exact: false
      },
      error_code: error.code || "error",
      error: safeProviderErrorMessage(error)
    };
  }
}

function summarizeResults(results = [], {
  threshold = 0.95
} = {}) {
  const attempted = results.length;
  const evaluated = results.filter((item) => item.status === "evaluated").length;
  const providerErrors = results.filter((item) => item.status === "provider_error").length;
  const invalidCandidates = results.filter((item) => item.status === "invalid_candidate").length;
  const nameExact = results.filter((item) => item.checks?.card_name_exact === true).length;
  const nameLoose = results.filter((item) => item.checks?.card_name_loose === true).length;
  const setExact = results.filter((item) => item.checks?.set_name_exact === true).length;
  const numberExact = results.filter((item) => item.checks?.collector_number_exact === true).length;
  const trustedNameCorrected = results.filter((item) => item.structured_reference_name_resolution?.status === "TRUSTED_CORRECTION").length;
  const trustedNameExactOrCorrected = results.filter((item) => {
    return item.checks?.card_name_exact === true
      || item.structured_reference_name_resolution?.status === "TRUSTED_CORRECTION";
  }).length;
  const trustedNameReviewSuggested = results.filter((item) => item.structured_reference_name_resolution?.status === "REVIEW_SUGGESTED").length;
  const nameExactRate = rate(nameExact, attempted);
  const trustedNameExactOrCorrectedRate = rate(trustedNameExactOrCorrected, attempted);

  return {
    attempted_count: attempted,
    evaluated_count: evaluated,
    provider_error_count: providerErrors,
    invalid_candidate_count: invalidCandidates,
    card_name_exact_count: nameExact,
    card_name_loose_count: nameLoose,
    set_name_exact_count: setExact,
    collector_number_exact_count: numberExact,
    structured_reference_name_corrected_count: trustedNameCorrected,
    structured_reference_name_exact_or_corrected_count: trustedNameExactOrCorrected,
    structured_reference_name_review_suggested_count: trustedNameReviewSuggested,
    card_name_exact_rate: nameExactRate,
    card_name_loose_rate: rate(nameLoose, attempted),
    set_name_exact_rate: rate(setExact, attempted),
    collector_number_exact_rate: rate(numberExact, attempted),
    structured_reference_name_exact_or_corrected_rate: trustedNameExactOrCorrectedRate,
    parsed_success_rate: rate(evaluated, attempted),
    name_threshold: threshold,
    name_threshold_met: nameExactRate !== null && nameExactRate >= threshold,
    structured_reference_name_threshold_met: trustedNameExactOrCorrectedRate !== null && trustedNameExactOrCorrectedRate >= threshold
  };
}

function buildReport({
  dataset,
  selectedItems,
  results,
  startedAt,
  now,
  threshold
}) {
  const summary = summarizeResults(results, { threshold });
  return {
    schema_version: schemaVersion,
    status: results.length === selectedItems.length ? "completed" : "partial",
    generated_at: now().toISOString(),
    started_at: startedAt.toISOString(),
    provider: "agnes",
    source_dataset_schema_version: dataset.schema_version || null,
    source_provider: dataset.source_provider || null,
    source_policy: dataset.source_policy || "card_images_only",
    reference_scope: "public_structured_card_name_reference",
    commercial_accuracy_claim_allowed: false,
    commercial_accuracy_eval_eligible: false,
    name_reference_eval_only: true,
    target_count: selectedItems.length,
    ...summary,
    results
  };
}

export async function evaluateAgnesPublicCardImages({
  dataset,
  limit = 300,
  threshold = 0.95,
  concurrency = 3,
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  previousResults = [],
  onProgress = null,
  now = () => new Date()
} = {}) {
  const startedAt = now();
  const trustedNameCandidates = trustedNameCandidatesFromDataset(dataset);

  if (!env.AGNES_API_KEY) {
    return {
      schema_version: schemaVersion,
      status: "skipped",
      generated_at: now().toISOString(),
      started_at: startedAt.toISOString(),
      provider: "agnes",
      target_count: 0,
      attempted_count: 0,
      commercial_accuracy_claim_allowed: false,
      commercial_accuracy_eval_eligible: false,
      name_reference_eval_only: true,
      blocked_reason: "AGNES_API_KEY is not configured.",
      results: []
    };
  }

  const items = (Array.isArray(dataset?.items) ? dataset.items : [])
    .filter((item) => item.category === "pokemon_card" && item.name_reference_eval_eligible !== false)
    .slice(0, limit);
  const reusableById = new Map(
    previousResults
      .filter((item) => item?.status === "evaluated")
      .map((item) => [item.candidate_id, item])
  );
  const resultsById = new Map();
  const pending = [];

  for (const item of items) {
    const previous = reusableById.get(item.candidate_id);
    if (previous) {
      if (previous.status === "evaluated") {
        previous.structured_reference_name_resolution = resolveTrustedNameCandidate({
          observedName: previous.prediction?.card_name,
          candidates: trustedNameCandidates
        });
      }
      resultsById.set(item.candidate_id, previous);
    } else {
      pending.push(item);
    }
  }

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, 10, pending.length || 1));

  async function worker() {
    while (cursor < pending.length) {
      const item = pending[cursor];
      cursor += 1;
      const result = await evaluateOneCard(item, { env, analyzeImpl });
      if (result.status === "evaluated") {
        result.structured_reference_name_resolution = resolveTrustedNameCandidate({
          observedName: result.prediction?.card_name,
          candidates: trustedNameCandidates
        });
      }
      resultsById.set(item.candidate_id, result);
      if (onProgress) {
        const orderedResults = items.map((selected) => resultsById.get(selected.candidate_id)).filter(Boolean);
        await onProgress(buildReport({
          dataset,
          selectedItems: items,
          results: orderedResults,
          startedAt,
          now,
          threshold
        }));
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const results = items.map((item) => resultsById.get(item.candidate_id)).filter(Boolean);
  return buildReport({
    dataset,
    selectedItems: items,
    results,
    startedAt,
    now,
    threshold
  });
}

export function formatAgnesPublicCardEvalSummary(report = {}) {
  return [
    `Agnes public card image eval ${report.status || "unknown"}`,
    `target_count: ${report.target_count ?? "n/a"}`,
    `attempted_count: ${report.attempted_count ?? "n/a"}`,
    `evaluated_count: ${report.evaluated_count ?? "n/a"}`,
    `provider_error_count: ${report.provider_error_count ?? "n/a"}`,
    `card_name_exact: ${report.card_name_exact_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.card_name_exact_rate ?? "n/a"})`,
    `card_name_loose: ${report.card_name_loose_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.card_name_loose_rate ?? "n/a"})`,
    `structured_reference_name_exact_or_corrected: ${report.structured_reference_name_exact_or_corrected_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.structured_reference_name_exact_or_corrected_rate ?? "n/a"})`,
    `parsed_success_rate: ${report.parsed_success_rate ?? "n/a"}`,
    `name_threshold_met: ${report.name_threshold_met === true}`,
    `structured_reference_name_threshold_met: ${report.structured_reference_name_threshold_met === true}`,
    `commercial_accuracy_claim_allowed: false`,
    `scope: public structured card-name reference only`
  ].join("\n");
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv, env = process.env) {
  const datasetPath = argValue(argv, "--dataset", env.PUBLIC_CARD_IMAGE_CANDIDATES_PATH || defaultDatasetPath);
  const outPath = argValue(argv, "--out", env.AGNES_PUBLIC_CARD_EVAL_OUT || defaultOutPath);
  const limit = numberArg(argv, "--limit", Number(env.AGNES_PUBLIC_CARD_EVAL_LIMIT || 300));
  const concurrency = numberArg(argv, "--concurrency", Number(env.AGNES_PUBLIC_CARD_EVAL_CONCURRENCY || 3));
  const threshold = Number(argValue(argv, "--name-threshold", env.AGNES_PUBLIC_CARD_NAME_THRESHOLD || "0.95"));
  const flushEvery = numberArg(argv, "--flush-every", Number(env.AGNES_PUBLIC_CARD_EVAL_FLUSH_EVERY || 10));
  const resume = !hasFlag(argv, "--no-resume") && booleanFromEnv(env, "AGNES_PUBLIC_CARD_EVAL_RESUME", true);
  const dataset = await readJson(datasetPath);
  let previousResults = [];
  if (resume && outPath && existsSync(resolve(outPath))) {
    try {
      const previous = await readJson(outPath);
      previousResults = Array.isArray(previous.results) ? previous.results : [];
    } catch {
      previousResults = [];
    }
  }

  let completedSinceFlush = 0;
  let writeChain = Promise.resolve();
  const report = await evaluateAgnesPublicCardImages({
    dataset,
    limit,
    threshold: Number.isFinite(threshold) ? threshold : 0.95,
    concurrency,
    env: {
      ...env,
      AGNES_MAX_RETRIES: env.AGNES_MAX_RETRIES || "1"
    },
    previousResults,
    onProgress: outPath
      ? async (partialReport) => {
        completedSinceFlush += 1;
        if (completedSinceFlush < flushEvery && partialReport.status !== "completed") return;
        completedSinceFlush = 0;
        writeChain = writeChain.then(() => writeJson(outPath, partialReport));
        await writeChain;
      }
      : null
  });

  if (outPath) await writeJson(outPath, report);
  process.stdout.write(`${formatAgnesPublicCardEvalSummary(report)}\n`);
  return report.status === "skipped" ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Agnes public card image eval failed: ${error.message}`);
    process.exit(1);
  }
}
