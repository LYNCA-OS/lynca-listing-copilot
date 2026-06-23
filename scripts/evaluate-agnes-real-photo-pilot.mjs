import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateTitleAcceptance } from "../lib/listing/evaluation/title-acceptance-policy.mjs";
import { analyzeCardEvidenceWithAgnes } from "../lib/listing/providers/agnes-provider.mjs";
import { safeProviderErrorMessage } from "../lib/listing/providers/provider-errors.mjs";
import { createListingImageSignedReadUrl } from "../lib/listing/storage/supabase-image-storage.mjs";

const schemaVersion = "agnes-real-photo-card-pilot-eval-v1";
const defaultDatasetPath = "data/real-photo-card-pilot/marketplace-real-photo-pilot.json";
const defaultOutPath = "data/eval/agnes-real-photo-card-pilot-latest.json";

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

function canonicalText(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldsFromParsed(parsed = {}) {
  const fields = parsed.fields || {};
  const players = Array.isArray(fields.players)
    ? fields.players.map(normalizeText).filter(Boolean)
    : [fields.players, fields.player, parsed.player].map(normalizeText).filter(Boolean);

  return {
    year: normalizeText(fields.year || fields.season),
    brand: normalizeText(fields.brand || fields.manufacturer),
    manufacturer: normalizeText(fields.manufacturer || fields.brand),
    product: normalizeText(fields.product || fields.set),
    set: normalizeText(fields.set || fields.product),
    subset: normalizeText(fields.subset),
    players,
    player: normalizeText(fields.player || players[0]),
    character: normalizeText(fields.character),
    parallel: normalizeText(fields.parallel),
    variation: normalizeText(fields.variation),
    collector_number: normalizeText(fields.collector_number || fields.card_number || fields.number),
    serial_number: normalizeText(fields.serial_number),
    grade_company: normalizeText(fields.grade_company || fields.grading_company),
    card_grade: normalizeText(fields.card_grade || fields.grade),
    auto_grade: normalizeText(fields.auto_grade),
    grade_type: normalizeText(fields.grade_type),
    rc: fields.rc === true || /\b(rc|rookie)\b/i.test(normalizeText(fields.rc)),
    auto: fields.auto === true || /\b(auto|autograph|signed)\b/i.test(normalizeText(fields.auto)),
    patch: fields.patch === true || /\bpatch\b/i.test(normalizeText(fields.patch))
  };
}

function predictedTitleFromParsed(parsed = {}) {
  return normalizeText(parsed.final_title || parsed.title || parsed.rendered_title || parsed.model_title_suggestion);
}

function fieldMatches(referenceFields = {}, predictedFields = {}, criticalFields = []) {
  return criticalFields
    .filter((field) => !["final_title_required_fields", "final_title_unsubstantiated_fields"].includes(field))
    .map((field) => {
      const expectedRaw = referenceFields[field];
      const actualRaw = predictedFields[field];
      const expected = canonicalText(Array.isArray(expectedRaw) ? expectedRaw.join(" ") : expectedRaw);
      const actual = canonicalText(Array.isArray(actualRaw) ? actualRaw.join(" ") : actualRaw);
      const matched = field === "rc"
        ? referenceFields.rc !== true || predictedFields.rc === true
        : Boolean(expected && actual && (expected === actual || expected.includes(actual) || actual.includes(expected)));
      return {
        field,
        expected: expectedRaw,
        actual: actualRaw,
        matched
      };
    });
}

function evaluationPrompt(item = {}) {
  return [
    "You are Listing Copilot evaluating a real marketplace photo of a collectible card.",
    "Read the visible card or slab directly. Do not use outside knowledge and do not copy seller-style hype.",
    "Write one concise English eBay-ready title and return only valid JSON in this exact shape:",
    JSON.stringify({
      title: "Year Brand Product Player Name #Number Parallel Grade",
      confidence: "LOW",
      reason: "short visual evidence note",
      fields: {
        year: "visible year or season",
        brand: "card manufacturer if visible",
        product: "product or set family if visible",
        set: "set name if visible",
        players: ["player or subject names visible"],
        parallel: "parallel/color/variation if visible",
        collector_number: "card number if visible",
        serial_number: "serial number if visible",
        grade_company: "PSA/BGS/SGC/etc if slabbed",
        card_grade: "card grade if slabbed",
        rc: false,
        auto: false,
        patch: false
      },
      unresolved: []
    }),
    "Rules:",
    "- If a field is not visible, use an empty string or false rather than guessing.",
    "- Do not invent grade, serial, autograph, patch, color, or parallel.",
    "- Do not include Markdown fences or prose outside the JSON.",
    `Audit candidate id: ${item.candidate_id || "unknown"}.`
  ].join("\n");
}

async function agnesImageInputForItem(item = {}, {
  env = process.env,
  createSignedReadUrlImpl = createListingImageSignedReadUrl
} = {}) {
  const objectPath = normalizeText(item.storage_object_path || item.object_path || item.verified_object_path);
  const externalUrl = normalizeText(item.card_image_url || item.image_url);

  if (objectPath) {
    return {
      name: item.candidate_id || "real-photo-card",
      url: await createSignedReadUrlImpl({
        objectPath,
        env
      }),
      image_input_mode: "controlled_storage_signed_url",
      external_image_url: externalUrl,
      storage_object_path: objectPath,
      persisted_url_safe: false
    };
  }

  return {
    name: item.candidate_id || "real-photo-card",
    url: externalUrl,
    image_input_mode: "external_url_pilot",
    external_image_url: externalUrl,
    storage_object_path: "",
    persisted_url_safe: true
  };
}

async function evaluateOne(item, {
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  createSignedReadUrlImpl = createListingImageSignedReadUrl
} = {}) {
  const externalImageUrl = normalizeText(item.card_image_url || item.image_url);
  const storageObjectPath = normalizeText(item.storage_object_path || item.object_path || item.verified_object_path);
  const referenceFields = item.reference_fields || {};
  const criticalFields = Array.isArray(item.critical_fields) ? item.critical_fields : [];
  const base = {
    candidate_id: item.candidate_id,
    source_provider: item.source_provider,
    source_type: item.source_type,
    trust_tier: item.trust_tier,
    source_page_url: item.source_page_url,
    card_image_url: externalImageUrl,
    storage_object_path: storageObjectPath,
    image_input_mode: storageObjectPath ? "controlled_storage_signed_url" : "external_url_pilot",
    reference_title: item.reference_title,
    reference_fields: referenceFields,
    critical_fields: criticalFields
  };

  if ((!externalImageUrl && !storageObjectPath) || !referenceFields || !criticalFields.length) {
    return {
      ...base,
      status: "invalid_candidate",
      error: "Candidate is missing image URL, reference fields, or critical fields."
    };
  }

  try {
    const imageInput = await agnesImageInputForItem(item, {
      env,
      createSignedReadUrlImpl
    });
    const result = await analyzeImpl({
      images: [
        {
          name: imageInput.name,
          url: imageInput.url
        }
      ],
      prompt: evaluationPrompt(item),
      env
    });
    const parsed = result.parsed || {};
    const predictedFields = fieldsFromParsed(parsed);
    const title = predictedTitleFromParsed(parsed);
    const title_acceptance = evaluateTitleAcceptance({
      title,
      groundTruthFields: referenceFields,
      predictedFields,
      criticalFields
    });
    const critical_field_matches = fieldMatches(referenceFields, predictedFields, criticalFields);

    return {
      ...base,
      status: "evaluated",
      prediction: {
        title,
        fields: predictedFields,
        confidence: normalizeText(parsed.confidence),
        reason: normalizeText(parsed.reason),
        parse_source: normalizeText(result.parse_source),
        model_id: normalizeText(result.model_id),
        finish_reason: normalizeText(result.finish_reason)
      },
      image_input: {
        mode: imageInput.image_input_mode,
        storage_object_path: imageInput.storage_object_path,
        external_image_url: imageInput.external_image_url,
        persisted_url_safe: imageInput.persisted_url_safe
      },
      title_acceptance,
      critical_field_matches,
      usage: result.usage || null
    };
  } catch (error) {
    return {
      ...base,
      status: "provider_error",
      error_code: error.code || "error",
      error: safeProviderErrorMessage(error)
    };
  }
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(6));
}

function summarize(results = []) {
  const attempted = results.length;
  const evaluated = results.filter((item) => item.status === "evaluated").length;
  const invalid = results.filter((item) => item.status === "invalid_candidate").length;
  const providerErrors = results.filter((item) => item.status === "provider_error").length;
  const accepted = results.filter((item) => item.title_acceptance?.accepted === true).length;
  const requiredPresent = results.filter((item) => item.title_acceptance?.required_fields_present === true).length;
  const criticalErrorFree = results.filter((item) => item.title_acceptance?.unsubstantiated_critical_errors === false).length;
  const fieldChecks = results.flatMap((item) => item.critical_field_matches || []);
  const matchedFields = fieldChecks.filter((item) => item.matched === true).length;
  const controlledStorageInputs = results.filter((item) => item.image_input?.mode === "controlled_storage_signed_url" || item.image_input_mode === "controlled_storage_signed_url").length;
  const externalUrlInputs = results.filter((item) => item.image_input?.mode === "external_url_pilot" || item.image_input_mode === "external_url_pilot").length;

  return {
    attempted_count: attempted,
    evaluated_count: evaluated,
    invalid_candidate_count: invalid,
    provider_error_count: providerErrors,
    title_accepted_count: accepted,
    title_required_fields_present_count: requiredPresent,
    title_critical_error_free_count: criticalErrorFree,
    critical_field_match_count: matchedFields,
    critical_field_check_count: fieldChecks.length,
    controlled_storage_input_count: controlledStorageInputs,
    external_url_input_count: externalUrlInputs,
    commercial_input_stability_ready: controlledStorageInputs > 0 && externalUrlInputs === 0,
    title_acceptance_rate: rate(accepted, attempted),
    title_acceptance_evaluated_rate: rate(accepted, evaluated),
    parsed_success_rate: rate(evaluated, attempted),
    critical_field_match_rate: rate(matchedFields, fieldChecks.length)
  };
}

export async function evaluateAgnesRealPhotoPilot({
  dataset,
  limit = 20,
  concurrency = 2,
  env = process.env,
  analyzeImpl = analyzeCardEvidenceWithAgnes,
  createSignedReadUrlImpl = createListingImageSignedReadUrl,
  onProgress = null,
  now = () => new Date()
} = {}) {
  const startedAt = now();
  if (!env.AGNES_API_KEY) {
    return {
      schema_version: schemaVersion,
      status: "skipped",
      generated_at: now().toISOString(),
      started_at: startedAt.toISOString(),
      provider: "agnes",
      commercial_accuracy_claim_allowed: false,
      commercial_accuracy_eval_eligible: false,
      marketplace_reference_only: true,
      controlled_storage_required_for_commercial: true,
      target_count: 0,
      attempted_count: 0,
      blocked_reason: "AGNES_API_KEY is not configured.",
      results: []
    };
  }

  const items = (Array.isArray(dataset?.items) ? dataset.items : [])
    .filter((item) => item.marketplace_reference_only !== false)
    .slice(0, limit);
  const resultsById = new Map();
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, 5, items.length || 1));

  const buildCurrentReport = (status = "partial") => {
    const results = items.map((item) => resultsById.get(item.candidate_id)).filter(Boolean);
    return {
      schema_version: schemaVersion,
      status: results.length === items.length ? "completed" : status,
      generated_at: now().toISOString(),
      started_at: startedAt.toISOString(),
      provider: "agnes",
      source_dataset_schema_version: dataset.schema_version || null,
      source_policy: dataset.source_policy || "real_marketplace_photos_reference_only",
      commercial_accuracy_claim_allowed: false,
      commercial_accuracy_eval_eligible: false,
      marketplace_reference_only: true,
      controlled_storage_required_for_commercial: true,
      target_count: items.length,
      ...summarize(results),
      results
    };
  };

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      const result = await evaluateOne(item, {
        env,
        analyzeImpl,
        createSignedReadUrlImpl
      });
      resultsById.set(item.candidate_id, result);
      if (onProgress) await onProgress(buildCurrentReport("partial"));
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return buildCurrentReport("completed");
}

export function formatAgnesRealPhotoPilotSummary(report = {}) {
  return [
    `Agnes real-photo card pilot ${report.status || "unknown"}`,
    `target_count: ${report.target_count ?? "n/a"}`,
    `attempted_count: ${report.attempted_count ?? "n/a"}`,
    `evaluated_count: ${report.evaluated_count ?? "n/a"}`,
    `provider_error_count: ${report.provider_error_count ?? "n/a"}`,
    `title_accepted_evaluated: ${report.title_accepted_count ?? "n/a"}/${report.evaluated_count ?? "n/a"} (${report.title_acceptance_evaluated_rate ?? "n/a"})`,
    `title_accepted_overall: ${report.title_accepted_count ?? "n/a"}/${report.attempted_count ?? "n/a"} (${report.title_acceptance_rate ?? "n/a"})`,
    `critical_field_matches: ${report.critical_field_match_count ?? "n/a"}/${report.critical_field_check_count ?? "n/a"} (${report.critical_field_match_rate ?? "n/a"})`,
    `image_inputs: controlled_storage=${report.controlled_storage_input_count ?? "n/a"}, external_url=${report.external_url_input_count ?? "n/a"}`,
    `commercial_input_stability_ready: ${report.commercial_input_stability_ready === true}`,
    `commercial_accuracy_claim_allowed: false`,
    `scope: marketplace real-photo pilot only`
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
  const datasetPath = argValue(argv, "--dataset", env.REAL_PHOTO_CARD_PILOT_DATASET || defaultDatasetPath);
  const outPath = argValue(argv, "--out", env.AGNES_REAL_PHOTO_PILOT_OUT || defaultOutPath);
  const limit = numberArg(argv, "--limit", Number(env.AGNES_REAL_PHOTO_PILOT_LIMIT || 20));
  const concurrency = numberArg(argv, "--concurrency", Number(env.AGNES_REAL_PHOTO_PILOT_CONCURRENCY || 2));
  const dataset = await readJson(datasetPath);
  const report = await evaluateAgnesRealPhotoPilot({
    dataset,
    limit,
    concurrency,
    env,
    onProgress: outPath ? async (partialReport) => writeJson(outPath, partialReport) : null
  });

  if (outPath) await writeJson(outPath, report);
  process.stdout.write(`${formatAgnesRealPhotoPilotSummary(report)}\n`);
  return report.status === "completed" ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Agnes real-photo card pilot failed: ${error.message}`);
    process.exit(1);
  }
}
