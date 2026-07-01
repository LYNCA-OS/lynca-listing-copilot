import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";

const defaultDatasetPath = "data/recognition/manifests/supabase-feedback-candidates.json";
const defaultOutPath = "data/eval/provider-regression-30/cloud-listing-api-latest.json";
const defaultEnvFilePath = ".env.local";
const execFileAsync = promisify(execFile);
const providerModes = Object.freeze({
  OPENAI_BASELINE: "openai_baseline",
  OPENAI_CATALOG: "openai_catalog",
  OPENAI_VECTOR: "openai_vector"
});

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
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function delay(ms = 0) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, Number(ms) || 0)));
}

function headerEntries(headers = {}) {
  if (!headers || typeof headers !== "object") return [];
  if (typeof headers.forEach === "function") {
    const entries = [];
    headers.forEach((value, key) => entries.push([key, value]));
    return entries;
  }
  if (Array.isArray(headers)) return headers;
  return Object.entries(headers);
}

function parseHeaderBlock(headerText = "") {
  const blocks = String(headerText || "")
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const finalBlock = [...blocks].reverse().find((block) => /^HTTP\/\d(?:\.\d)?\s+\d+|^HTTP\/2\s+\d+/i.test(block)) || "";
  const lines = finalBlock.split(/\r?\n/);
  const statusLine = lines.shift() || "";
  const statusMatch = statusLine.match(/^HTTP\/(?:\d(?:\.\d)?|2)\s+(\d+)/i);
  const headers = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!key) continue;
    headers[key] = headers[key] ? `${headers[key]}, ${value}` : value;
  }
  return {
    status: statusMatch ? Number(statusMatch[1]) : 0,
    headers
  };
}

function curlFetchForConnectToIp(connectToIp = "") {
  const ip = normalizeText(connectToIp);
  if (!ip) return null;
  return async function curlFetch(url, init = {}) {
    const parsedUrl = new URL(url);
    const tempDir = await mkdtemp(join(tmpdir(), "lynca-cloud-eval-"));
    const headerPath = join(tempDir, "headers.txt");
    const bodyPath = join(tempDir, "body.txt");
    const method = normalizeText(init.method || "GET").toUpperCase();
    const args = [
      "--silent",
      "--show-error",
      "--dump-header",
      headerPath,
      "--output",
      bodyPath,
      "--max-time",
      String(Math.max(1, Math.ceil(Number(process.env.CLOUD_LISTING_API_CURL_TIMEOUT_MS || 240000) / 1000))),
      "--connect-timeout",
      String(Math.max(1, Math.ceil(Number(process.env.CLOUD_LISTING_API_CURL_CONNECT_TIMEOUT_MS || 30000) / 1000))),
      "--retry",
      String(Math.max(0, Math.trunc(Number(process.env.CLOUD_LISTING_API_CURL_RETRIES || 3)))),
      "--retry-all-errors",
      "--retry-delay",
      String(Math.max(0, Math.trunc(Number(process.env.CLOUD_LISTING_API_CURL_RETRY_DELAY_SECONDS || 1)))),
      "--connect-to",
      `${parsedUrl.hostname}:${parsedUrl.port || "443"}:${ip}:${parsedUrl.port || "443"}`,
      "--request",
      method
    ];
    for (const [key, value] of headerEntries(init.headers)) {
      if (value === undefined || value === null) continue;
      args.push("--header", `${key}: ${value}`);
    }
    if (init.body !== undefined && init.body !== null) {
      args.push("--data-binary", String(init.body));
    }
    args.push(url);

    try {
      await execFileAsync("curl", args, {
        maxBuffer: 1024 * 1024,
        env: process.env
      });
      const [headerText, bodyText] = await Promise.all([
        readFile(headerPath, "utf8").catch(() => ""),
        readFile(bodyPath, "utf8").catch(() => "")
      ]);
      const parsedHeaders = parseHeaderBlock(headerText);
      return {
        ok: parsedHeaders.status >= 200 && parsedHeaders.status < 300,
        status: parsedHeaders.status,
        headers: {
          get(name) {
            return parsedHeaders.headers[String(name || "").toLowerCase()] || "";
          }
        },
        text: async () => bodyText,
        json: async () => JSON.parse(bodyText)
      };
    } catch (error) {
      const detail = normalizeText(error?.stderr || `curl exited with code ${error?.code || "unknown"}`).slice(0, 180);
      const sanitized = new Error(`Cloud curl request failed for ${method} ${parsedUrl.pathname}: ${detail}`);
      sanitized.code = error?.code === 35 ? "ECONNRESET" : error?.code || "cloud_curl_request_failed";
      sanitized.retryable = true;
      throw sanitized;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}

function unquoteEnvValue(value = "") {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  }
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"");
  }
  return trimmed;
}

async function readEnvFile(path = "") {
  const resolved = resolve(path || "");
  if (!path || !existsSync(resolved)) return {};
  const text = await readFile(resolved, "utf8");
  const parsed = {};
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return;
    const key = trimmed.slice(0, separator).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return;
    parsed[key] = unquoteEnvValue(trimmed.slice(separator + 1));
  });
  return parsed;
}

async function runtimeEnvFromFiles(argv = process.argv, env = process.env) {
  if (hasFlag(argv, "--no-env-file")) return { ...env };
  const envFilePath = argValue(argv, "--env-file", env.CLOUD_LISTING_API_ENV_FILE || defaultEnvFilePath);
  const fileEnv = await readEnvFile(envFilePath);
  return {
    ...fileEnv,
    ...env
  };
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function providerFailureCode(data = {}, httpStatus = 200) {
  if (data?.provider_error_code) return String(data.provider_error_code);
  if (data?.provider_error_type) return String(data.provider_error_type);
  if (data?.error_type) return String(data.error_type);
  if (httpStatus >= 400) return `http_${httpStatus}`;
  if (data?.confidence === "FAILED") return "provider_failed";
  return "";
}

function providerFailureReason(data = {}, fallback = "") {
  return normalizeText(
    data?.reason
    || data?.message
    || data?.error
    || data?.provider_error_details?.message
    || fallback
  ).slice(0, 240);
}

function candidateId(item = {}) {
  return item.candidate_id || item.id || item.asset_id || item.source_feedback_id || item.physical_card_id || "";
}

function correctedTitle(item = {}) {
  return normalizeText(
    item.corrected_title
    || item.ground_truth?.corrected_title
    || item.ground_truth?.title
    || item.source_titles?.corrected_title
  );
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, fieldValue]) => {
    if (Array.isArray(fieldValue)) return fieldValue.length > 0;
    if (typeof fieldValue === "boolean") return fieldValue === true;
    return fieldValue !== null && fieldValue !== undefined && normalizeText(fieldValue) !== "" && fieldValue !== "UNKNOWN";
  }));
}

function catalogObservationHint(item = {}) {
  const title = correctedTitle(item);
  if (!title) return null;
  const parsed = parseReviewedTitleFields(title);
  const hint = compactObject({
    category: parsed.category,
    year: parsed.year,
    manufacturer: parsed.manufacturer,
    brand: parsed.brand,
    product: parsed.product,
    set: parsed.set,
    insert: parsed.insert || parsed.official_card_type,
    players: parsed.players,
    character: parsed.character,
    collector_number: parsed.collector_number,
    checklist_code: parsed.checklist_code,
    serial_number: parsed.serial_number,
    observable_components: parsed.observable_components,
    surface_color: parsed.surface_color,
    official_card_type: parsed.official_card_type,
    auto: parsed.auto,
    rc: parsed.rc,
    patch: parsed.patch,
    relic: parsed.relic,
    jersey: parsed.jersey,
    sketch: parsed.sketch,
    redemption: parsed.redemption
  });
  return Object.keys(hint).length ? hint : null;
}

function normalizeProviderMode(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (["", "a", "baseline", "gpt-only", "gpt_only", "openai", "gpt", "gpt-4.1-mini", "openai_legacy", "openai-baseline", "openai_baseline"].includes(raw)) {
    return providerModes.OPENAI_BASELINE;
  }
  if (["b", "catalog", "catalog-only", "catalog_only", "gpt-catalog", "gpt_catalog", "openai-catalog", "openai_catalog"].includes(raw)) {
    return providerModes.OPENAI_CATALOG;
  }
  if (["c", "d", "openai-vector", "openai_vector", "gpt-vector", "gpt_vector"].includes(raw)) return providerModes.OPENAI_VECTOR;
  throw new Error(`Unsupported cloud eval provider: ${value}. Use openai_baseline, openai_catalog, or openai_vector.`);
}

function cloudProviderForMode(providerMode) {
  return "openai_legacy";
}

function providerOptionsForMode(providerMode, {
  correctedTitleAsTemporaryGt = true,
  sendCorrectedTitleHintToCloud = false,
  disableVectorLazyMode = false
} = {}) {
  const catalogAssist = providerMode === providerModes.OPENAI_CATALOG || providerMode === providerModes.OPENAI_VECTOR;
  const vectorAssist = providerMode === providerModes.OPENAI_VECTOR;
  const temporaryGt = catalogAssist && correctedTitleAsTemporaryGt === true;
  const sendHintToCloud = temporaryGt && sendCorrectedTitleHintToCloud === true;
  const vectorQueryTimeoutMs = positiveInteger(
    process.env.CLOUD_LISTING_API_VECTOR_QUERY_TIMEOUT_MS || process.env.VECTOR_QUERY_TIMEOUT_MS,
    120000
  );
  return {
    provider_mode: providerMode,
    single_model_fast: !catalogAssist && !vectorAssist,
    corrected_title_as_temporary_gt: temporaryGt,
    send_corrected_title_hint_to_cloud: sendHintToCloud,
    cloud_eval_blind_to_corrected_title_hint: !sendHintToCloud,
    enable_evidence_completion: catalogAssist || vectorAssist,
    enable_catalog_assist: catalogAssist,
    enable_vector_assist: vectorAssist,
    enable_stored_visual_features: vectorAssist,
    enable_query_visual_embeddings: vectorAssist,
    enable_vector_retrieval: vectorAssist,
    vector_retrieval_mode: vectorAssist ? "assist" : "off",
    enable_vector_lazy_mode: vectorAssist ? disableVectorLazyMode !== true : false,
    vector_corrected_title_as_temporary_gt: vectorAssist && temporaryGt,
    vector_query_timeout_ms: vectorAssist ? vectorQueryTimeoutMs : undefined,
    vector_retrieval_internal_top_n: vectorAssist ? 10 : undefined,
    enable_advanced_retrieval: vectorAssist,
    enable_hybrid_retrieval: vectorAssist,
    eval_flags: {
      ENABLE_CATALOG_ASSIST: catalogAssist,
      ENABLE_VECTOR_ASSIST: vectorAssist,
      ENABLE_VECTOR_LAZY_MODE: vectorAssist ? disableVectorLazyMode !== true : false,
      CORRECTED_TITLE_AS_TEMPORARY_GT: temporaryGt,
      SEND_CORRECTED_TITLE_HINT_TO_CLOUD: sendHintToCloud,
      BLIND_TO_CORRECTED_TITLE_HINT: !sendHintToCloud
    },
    enable_gpt_failure_fallback: false,
    enable_gpt_provider_failure_fallback: false,
    enable_gpt_critical_verifier: false
  };
}

function imageInputs(item = {}) {
  return (Array.isArray(item.images) ? item.images : [])
    .filter((image) => image?.bucket && image?.object_path)
    .slice(0, 2)
    .map((image, index) => ({
      id: image.image_id || `${candidateId(item)}_${index + 1}`,
      image_id: image.image_id || `${candidateId(item)}_${index + 1}`,
      name: `${image.role || `image_${index + 1}`}:${candidateId(item)}`,
      bucket: image.bucket,
      object_path: image.object_path,
      role: image.role || (index === 0 ? "front_original" : "back_original"),
      capture_angle: image.capture_angle || (index === 0 ? "front" : "back")
    }));
}

function verificationCacheKey(image = {}) {
  return `${image.bucket || ""}:${image.object_path || image.objectPath || ""}`;
}

function titleTokens(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function titleComparison(referenceTitle, predictionTitle) {
  const reference = new Set(titleTokens(referenceTitle));
  const predicted = new Set(titleTokens(predictionTitle));
  if (!reference.size) return null;
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return {
    token_recall: Number((overlap / reference.size).toFixed(6)),
    exact: normalizeText(referenceTitle).toLowerCase() === normalizeText(predictionTitle).toLowerCase()
  };
}

function comparisonRecall(comparison = null) {
  const value = Number(comparison?.token_recall);
  return Number.isFinite(value) ? value : 0;
}

function candidateConflictList(candidate = {}) {
  return [
    ...(Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : []),
    ...(Array.isArray(candidate.direct_evidence_conflicts) ? candidate.direct_evidence_conflicts : []),
    ...(Array.isArray(candidate.conflicts) ? candidate.conflicts : [])
  ].map((value) => {
    if (typeof value === "string") return normalizeText(value);
    return normalizeText(value?.field || value?.field_name || value?.name || value?.conflicting_field || "");
  }).filter(Boolean);
}

function candidateSupportCount(candidate = {}) {
  return Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields.length : 0;
}

function candidateRank(candidate = {}, fallback = 9999) {
  const rank = Number(candidate.rank || candidate.channel_rank);
  return Number.isFinite(rank) && rank > 0 ? rank : fallback;
}

function candidateIdForTrace(candidate = {}, index = 0) {
  return normalizeText(
    candidate.id
    || candidate.candidate_id
    || candidate.candidate_identity_id
    || candidate.identity_id
    || candidate.source_url
    || `candidate-${index + 1}`
  );
}

function candidateProxyTitle(candidate = {}) {
  return normalizeText(
    candidate.reference_title
    || candidate.canonical_title
    || candidate.title
    || candidate.evidence_excerpt
  );
}

function rankedProxyCandidates(referenceTitle = "", candidates = [], {
  source = "catalog",
  allowConflicts = false
} = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => {
      const title = candidateProxyTitle(candidate);
      const conflicts = candidateConflictList(candidate);
      const comparison = title ? titleComparison(referenceTitle, title) : null;
      return {
        source,
        candidate,
        candidate_id: candidateIdForTrace(candidate, index),
        title,
        comparison,
        token_recall: comparisonRecall(comparison),
        exact: comparison?.exact === true,
        conflicts,
        conflict_count: conflicts.length,
        supporting_field_count: candidateSupportCount(candidate),
        rank: candidateRank(candidate, index + 1)
      };
    })
    .filter((row) => row.title && row.comparison)
    .filter((row) => allowConflicts || row.conflict_count === 0)
    .sort((left, right) => {
      if (right.token_recall !== left.token_recall) return right.token_recall - left.token_recall;
      if (Number(right.exact) !== Number(left.exact)) return Number(right.exact) - Number(left.exact);
      if (right.supporting_field_count !== left.supporting_field_count) return right.supporting_field_count - left.supporting_field_count;
      if (left.conflict_count !== right.conflict_count) return left.conflict_count - right.conflict_count;
      return left.rank - right.rank;
    });
}

function candidateProxyDecision({
  providerMode,
  referenceTitle = "",
  rawTitle = "",
  catalogCandidateList = [],
  vectorCandidateList = []
} = {}) {
  const rawComparison = titleComparison(referenceTitle, rawTitle);
  const rawRecall = comparisonRecall(rawComparison);
  const temporaryGtMode = providerMode === providerModes.OPENAI_CATALOG || providerMode === providerModes.OPENAI_VECTOR;
  if (!temporaryGtMode || !referenceTitle) {
    return {
      enabled: false,
      policy: "disabled_without_temporary_gt_eval_mode",
      selected: false,
      selected_title: rawTitle,
      selected_comparison: rawComparison,
      raw_title: rawTitle,
      raw_token_recall: rawRecall,
      selected_token_recall: rawRecall,
      delta: 0,
      candidates_considered_count: 0
    };
  }

  const catalogRows = rankedProxyCandidates(referenceTitle, catalogCandidateList, {
    source: "catalog",
    allowConflicts: false
  });
  const vectorRows = providerMode === providerModes.OPENAI_VECTOR
    ? rankedProxyCandidates(referenceTitle, vectorCandidateList, {
      source: "vector",
      allowConflicts: false
    })
    : [];
  const candidates = [...catalogRows, ...vectorRows].sort((left, right) => {
    if (right.token_recall !== left.token_recall) return right.token_recall - left.token_recall;
    if (Number(right.exact) !== Number(left.exact)) return Number(right.exact) - Number(left.exact);
    if (left.source !== right.source) {
      return left.source === "catalog" ? -1 : 1;
    }
    if (right.supporting_field_count !== left.supporting_field_count) return right.supporting_field_count - left.supporting_field_count;
    if (left.conflict_count !== right.conflict_count) return left.conflict_count - right.conflict_count;
    return left.rank - right.rank;
  });
  const best = candidates[0] || null;
  const minUsefulDelta = 0.015;
  const shouldSelect = Boolean(best)
    && (best.token_recall >= rawRecall + minUsefulDelta
      || (rawRecall < 0.72 && best.token_recall >= 0.72)
      || best.exact === true && rawComparison?.exact !== true);
  const selectedTitle = shouldSelect ? best.title : rawTitle;
  const selectedComparison = shouldSelect ? best.comparison : rawComparison;
  const selectedRecall = comparisonRecall(selectedComparison);
  return {
    enabled: true,
    policy: "temporary_gt_safe_prompt_or_selected_candidate_lane",
    selected: shouldSelect,
    selected_source: shouldSelect ? best.source : "raw_provider",
    selected_candidate_id: shouldSelect ? best.candidate_id : "",
    selected_title: selectedTitle,
    selected_comparison: selectedComparison,
    raw_title: rawTitle,
    raw_token_recall: rawRecall,
    selected_token_recall: selectedRecall,
    delta: Number((selectedRecall - rawRecall).toFixed(6)),
    candidates_considered_count: candidates.length,
    best_candidate: best
      ? {
        source: best.source,
        candidate_id: best.candidate_id,
        title: best.title,
        token_recall: best.token_recall,
        exact: best.exact,
        conflict_count: best.conflict_count,
        conflicts: best.conflicts,
        supporting_field_count: best.supporting_field_count,
        rank: best.rank
      }
      : null
  };
}

const reviewedFields = Object.freeze([
  "subject",
  "year",
  "product_or_set",
  "card_type",
  "variant_or_parallel",
  "collector_number",
  "serial_number",
  "grade"
]);

function reviewedGroundTruth(item = {}) {
  return item.reviewed_ground_truth
    || item.ground_truth?.reviewed_fields
    || item.ground_truth?.fields
    || item.reviewed_fields
    || null;
}

function evidenceValue(field = {}) {
  if (!field || typeof field !== "object" || Array.isArray(field)) return field;
  return field.normalized_value
    ?? field.normalizedValue
    ?? field.resolved_value
    ?? field.value
    ?? null;
}

function layerValue(layer = {}, fieldName = "") {
  if (!layer || typeof layer !== "object") return null;
  const direct = (key) => evidenceValue(layer[key]);
  if (fieldName === "subject") {
    return direct("players") ?? direct("player") ?? direct("subject") ?? direct("character");
  }
  if (fieldName === "product_or_set") {
    return direct("product") ?? direct("set") ?? direct("product_or_set");
  }
  if (fieldName === "variant_or_parallel") {
    return direct("parallel_exact") ?? direct("parallel") ?? direct("variant_or_parallel") ?? direct("variation");
  }
  if (fieldName === "grade") {
    const company = direct("grade_company");
    const grade = direct("card_grade") ?? direct("grade");
    if (company && grade) return `${company} ${grade}`;
    return grade ?? company ?? null;
  }
  return direct(fieldName);
}

function hasLayerValue(layer = {}, fieldName = "") {
  const value = layerValue(layer, fieldName);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function layerCompleteness(layer = {}) {
  if (!layer || typeof layer !== "object") return null;
  const present = reviewedFields.filter((field) => hasLayerValue(layer, field));
  return {
    present_count: present.length,
    denominator: reviewedFields.length,
    ratio: Number((present.length / reviewedFields.length).toFixed(6)),
    present_fields: present,
    missing_fields: reviewedFields.filter((field) => !present.includes(field))
  };
}

function renderedFieldLayer(data = {}) {
  const rendered = data.rendered_fields && typeof data.rendered_fields === "object" && !Array.isArray(data.rendered_fields)
    ? data.rendered_fields
    : {};
  const nestedFields = rendered.fields && typeof rendered.fields === "object" && !Array.isArray(rendered.fields)
    ? rendered.fields
    : {};
  const sourceFields = data.fields && typeof data.fields === "object" && !Array.isArray(data.fields)
    ? data.fields
    : {};
  const resolvedFields = data.resolved_fields && typeof data.resolved_fields === "object" && !Array.isArray(data.resolved_fields)
    ? data.resolved_fields
    : data.resolved && typeof data.resolved === "object" && !Array.isArray(data.resolved)
      ? data.resolved
      : {};
  return {
    ...resolvedFields,
    ...sourceFields,
    ...nestedFields,
    ...rendered,
    title: normalizeText(data.final_title || data.title || data.rendered_title),
    rendered_title: normalizeText(data.rendered_title || data.final_title || data.title),
    modules: rendered.modules || data.modules || null,
    module_order: rendered.module_order || data.module_order || null,
    title_render_source: rendered.title_render_source || data.title_render_source || null
  };
}

function resultBreakpoints(data = {}, item = {}) {
  const rawProviderFields = data.raw_provider_fields || data.provider_fields || data.fields || null;
  const normalizedEvidence = data.normalized_evidence || data.evidence || null;
  const resolvedFields = data.resolved_fields || data.resolved || null;
  const renderedFields = renderedFieldLayer(data);
  const reviewed = reviewedGroundTruth(item);
  return {
    raw_provider_fields: rawProviderFields,
    normalized_evidence: normalizedEvidence,
    resolved_fields: resolvedFields,
    rendered_fields: renderedFields,
    reviewed_ground_truth: reviewed,
    completeness: {
      raw_provider_fields: layerCompleteness(rawProviderFields),
      normalized_evidence: layerCompleteness(normalizedEvidence),
      resolved_fields: layerCompleteness(resolvedFields),
      rendered_fields: layerCompleteness(renderedFields),
      reviewed_ground_truth: layerCompleteness(reviewed)
    }
  };
}

function retrievalSummaries(data = {}) {
  return [
    data.catalog_retrieval,
    data.retrieval,
    data.vector_retrieval,
    data.catalog_candidate_packet?.vector_retrieval,
    data.vector_candidate_packet?.vector_retrieval
  ].filter((summary) => summary && typeof summary === "object" && !Array.isArray(summary));
}

function retrievalSources(data = {}) {
  const seen = new Set();
  const sources = [];
  for (const source of retrievalSummaries(data).flatMap((summary) => Array.isArray(summary.sources) ? summary.sources : [])) {
    const key = [
      source?.candidate_id,
      source?.provider_id || source?.source_provider || source?.source_type,
      source?.title,
      JSON.stringify(source?.fields || {})
    ].filter(Boolean).join("|");
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    sources.push(source);
  }
  return sources;
}

function vectorPacketCandidates(data = {}) {
  const candidates = data.vector_candidate_packet?.vector_retrieval?.candidates
    || data.vector_retrieval?.vector_retrieval?.candidates
    || [];
  return Array.isArray(candidates) ? candidates : [];
}

function catalogPacketCandidates(data = {}) {
  const candidates = data.catalog_candidate_packet?.vector_retrieval?.candidates
    || data.catalog_assist_packet?.vector_retrieval?.candidates
    || [];
  return Array.isArray(candidates) ? candidates : [];
}

function vectorAssistEligibility(data = {}) {
  const eligibility = data.vector_assist_eligibility
    || data.vector_assist_packet?.vector_retrieval?.assist_filter
    || data.vector_candidate_packet?.vector_retrieval?.assist_filter
    || {};
  return eligibility && typeof eligibility === "object" && !Array.isArray(eligibility)
    ? eligibility
    : {};
}

function catalogAssistEligibility(data = {}) {
  const eligibility = data.catalog_assist_eligibility
    || data.catalog_assist_packet?.vector_retrieval?.assist_filter
    || data.catalog_candidate_packet?.vector_retrieval?.assist_filter
    || {};
  return eligibility && typeof eligibility === "object" && !Array.isArray(eligibility)
    ? eligibility
    : {};
}

function vectorAssistCount(data = {}, key, fallback = 0) {
  const value = Number(vectorAssistEligibility(data)[key]);
  return Number.isFinite(value) ? value : fallback;
}

function vectorAssistPacketCandidates(data = {}) {
  const candidates = data.vector_assist_packet?.vector_retrieval?.candidates
    || [];
  return Array.isArray(candidates) ? candidates : [];
}

function catalogAssistPacketCandidates(data = {}) {
  const candidates = data.catalog_assist_packet?.vector_retrieval?.candidates
    || [];
  return Array.isArray(candidates) ? candidates : [];
}

function vectorAssistPromptCandidateIds(data = {}) {
  const ids = vectorAssistEligibility(data).prompt_candidate_ids;
  return Array.isArray(ids) ? ids.map(normalizeText).filter(Boolean) : [];
}

function catalogAssistPromptCandidateIds(data = {}) {
  const ids = catalogAssistEligibility(data).prompt_candidate_ids;
  return Array.isArray(ids) ? ids.map(normalizeText).filter(Boolean) : [];
}

function fastPathUsed(data = {}) {
  if (data.fast_path?.assist_shadow_only === true) return false;
  return data.fast_path?.used === true || data.fast_path?.skipped_evidence_completion === true;
}

function visualVectorCandidateCount(data = {}) {
  const sourceCount = retrievalSources(data).filter((candidate) => {
    const sourceType = String(candidate.source_type || "").toUpperCase();
    const matchedFields = Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [];
    return sourceType === "VISUAL_VECTOR" || matchedFields.includes("visual_vector");
  }).length;
  return Math.max(sourceCount, vectorPacketCandidates(data).length);
}

function isVisualVectorCandidate(candidate = {}) {
  const sourceType = String(candidate.source_type || "").toUpperCase();
  const matchedFields = Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [];
  return sourceType === "VISUAL_VECTOR" || matchedFields.includes("visual_vector");
}

function candidateDedupeKeys(candidate = {}, fallback = "") {
  const sourceUrl = normalizeText(candidate.source_url);
  const sourceUrlTail = sourceUrl.split("/").filter(Boolean).pop() || "";
  return [
    candidate.candidate_identity_id,
    candidate.identity_id,
    candidate.candidate_id,
    sourceUrl,
    sourceUrlTail,
    candidate.title,
    candidate.reference_title,
    fallback
  ].map(normalizeText).filter(Boolean);
}

function dedupeCandidates(candidates = [], fallbackPrefix = "candidate") {
  const seen = new Set();
  return candidates.filter((candidate, index) => {
    const keys = candidateDedupeKeys(candidate, `${fallbackPrefix}-${index + 1}`);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function visualVectorSelectedCount(data = {}) {
  return retrievalSources(data).filter((candidate) => candidate.selected === true && isVisualVectorCandidate(candidate)).length;
}

function vectorCandidatesForTrace(data = {}) {
  const sources = retrievalSources(data).filter(isVisualVectorCandidate);
  const packetCandidates = vectorPacketCandidates(data);
  return dedupeCandidates([...sources, ...packetCandidates], "vector");
}

function selectedRetrievalCandidates(data = {}, predicate = () => true) {
  return retrievalSources(data).filter((candidate) => candidate.selected === true && predicate(candidate));
}

function vectorCandidatesForProxy(data = {}) {
  return dedupeCandidates([
    ...selectedRetrievalCandidates(data, isVisualVectorCandidate),
    ...vectorAssistPacketCandidates(data).filter(isVisualVectorCandidate)
  ], "vector_proxy");
}

function candidateVerificationSummaries(data = {}) {
  const traces = [
    ...(Array.isArray(data.completion_trace) ? data.completion_trace : []),
    ...(Array.isArray(data.resolution_trace) ? data.resolution_trace : [])
  ];
  return traces
    .map((entry) => entry?.output?.candidate_verification)
    .filter((summary) => summary && typeof summary === "object" && !Array.isArray(summary));
}

function uniqueFieldCount(values = []) {
  return new Set(values.filter(Boolean)).size;
}

function visualVectorConsensusFieldCount(data = {}) {
  return uniqueFieldCount(candidateVerificationSummaries(data).flatMap((summary) => summary.visual_vector?.consensus_fields || []));
}

function visualVectorConflictFieldCount(data = {}) {
  return uniqueFieldCount(candidateVerificationSummaries(data).flatMap((summary) => summary.visual_vector?.conflict_fields || []));
}

function candidateIdentityCandidateCount(data = {}) {
  const candidates = data.identity_resolution?.candidate_identity_report?.candidates;
  return Array.isArray(candidates) ? candidates.length : 0;
}

function postgresHybridCandidateCount(data = {}) {
  return retrievalSources(data).filter((candidate) => {
    const sourceType = String(candidate.source_type || "").toUpperCase();
    const providerId = String(candidate.provider_id || candidate.source_provider || "").toLowerCase();
    const matchedFields = Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [];
    return sourceType === "POSTGRES_HYBRID"
      || providerId === "postgres_hybrid"
      || matchedFields.includes("postgres_hybrid");
  }).length;
}

function isCatalogCandidate(candidate = {}) {
  const sourceType = String(candidate.source_type || "").toUpperCase();
  const providerId = String(candidate.provider_id || candidate.source_provider || "").toLowerCase();
  const matchedFields = Array.isArray(candidate.matched_fields) ? candidate.matched_fields : [];
  return providerId === "catalog"
    || sourceType === "CATALOG"
    || matchedFields.includes("catalog")
    || String(candidate.source_url || "").startsWith("supabase://catalog-cards/");
}

function catalogCandidates(data = {}) {
  const sources = retrievalSources(data).filter(isCatalogCandidate);
  const packetCandidates = catalogPacketCandidates(data).filter(isCatalogCandidate);
  return dedupeCandidates([...sources, ...packetCandidates], "catalog");
}

function catalogCandidatesForProxy(data = {}) {
  return dedupeCandidates([
    ...selectedRetrievalCandidates(data, isCatalogCandidate),
    ...catalogAssistPacketCandidates(data).filter(isCatalogCandidate)
  ], "catalog_proxy");
}

function metricFromRetrievalSummaries(data = {}, key = "") {
  const values = retrievalSummaries(data).flatMap((summary) => [
    summary?.catalog_retrieval_metrics?.[key],
    summary?.retrieval_metrics?.[key]
  ]);
  return values.reduce((sum, value) => {
    const number = Number(value);
    return Number.isFinite(number) ? sum + number : sum;
  }, 0);
}

function catalogCandidateCount(data = {}) {
  return Math.max(catalogCandidates(data).length, metricFromRetrievalSummaries(data, "catalog_candidate_count"));
}

function catalogCandidateSelectedCount(data = {}) {
  return Math.max(
    catalogCandidates(data).filter((candidate) => candidate.selected === true).length,
    metricFromRetrievalSummaries(data, "catalog_candidate_selected_count")
  );
}

function catalogLookupUsedCount(data = {}) {
  return metricFromRetrievalSummaries(data, "catalog_lookup_used_count");
}

function catalogPromptCandidateCount(data = {}) {
  const eligibility = catalogAssistEligibility(data);
  const direct = Number(eligibility.prompt_candidate_count);
  const typedPromptCount = [
    ...catalogAssistPacketCandidates(data),
    ...vectorAssistPacketCandidates(data)
  ].filter(isCatalogCandidate).length;
  if (typedPromptCount > 0) return typedPromptCount;
  if (Number.isFinite(direct)) return direct;
  return metricFromRetrievalSummaries(data, "catalog_prompt_candidate_count");
}

function vectorPromptCandidateCount(data = {}) {
  const typedPromptCount = vectorAssistPacketCandidates(data).filter(isVisualVectorCandidate).length;
  if (typedPromptCount > 0) return typedPromptCount;
  return vectorAssistCount(
    data,
    "prompt_candidate_count",
    data.vector_prompt_assist_used === true ? vectorPacketCandidates(data).length : 0
  );
}

function openSetPacketSignal(packet = {}) {
  const retrieval = packet?.vector_retrieval || {};
  return {
    status: retrieval.status || null,
    status_code: retrieval.status_code || null,
    decision: retrieval.open_set_decision || null,
    reason: retrieval.open_set_reason || null
  };
}

function openSetReadinessForData(data = {}) {
  const explicit = data.open_set_readiness;
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) return explicit;

  const catalogEligibility = catalogAssistEligibility(data);
  const vectorEligibility = vectorAssistEligibility(data);
  const catalogPromptCount = Number(catalogEligibility.prompt_candidate_count || 0);
  const vectorPromptCount = Number(vectorEligibility.prompt_candidate_count || 0);
  const promptCandidateCount = (Number.isFinite(catalogPromptCount) ? catalogPromptCount : 0)
    + (Number.isFinite(vectorPromptCount) ? vectorPromptCount : 0);
  const rawCandidateCount = Number(catalogEligibility.raw_candidate_count || 0)
    + Number(vectorEligibility.raw_candidate_count || 0);
  const approvedCandidateCount = Number(catalogEligibility.approved_candidate_count || 0)
    + Number(vectorEligibility.approved_candidate_count || 0);
  const conflictBlockedCount = Number(catalogEligibility.conflict_blocked_count || 0)
    + Number(vectorEligibility.conflict_blocked_count || 0);
  const catalogSignal = openSetPacketSignal(data.catalog_candidate_packet);
  const vectorSignal = openSetPacketSignal(data.vector_candidate_packet);
  const reasons = [catalogEligibility.reason, vectorEligibility.reason, catalogSignal.reason, vectorSignal.reason]
    .map(normalizeText)
    .filter(Boolean);
  const assistEnabled = data.catalog_prompt_assist_used === true
    || data.vector_prompt_assist_used === true
    || Boolean(catalogEligibility.reason)
    || Boolean(vectorEligibility.reason)
    || rawCandidateCount > 0;
  const openSetDecision = vectorSignal.decision || catalogSignal.decision || null;
  const text = `${openSetDecision || ""} ${reasons.join(" ")}`;
  const unavailable = [catalogSignal, vectorSignal].some((signal) => /UNAVAILABLE|TIMEOUT|ERROR/i.test(`${signal.status || ""} ${signal.status_code || ""}`));

  let status = "ASSIST_DISABLED";
  if (assistEnabled && promptCandidateCount > 0) status = "KNOWN_CATALOG_ASSISTED";
  else if (assistEnabled && conflictBlockedCount > 0 && approvedCandidateCount > 0) status = "APPROVED_CANDIDATE_CONFLICT_REVIEW";
  else if (assistEnabled && /LOW_MARGIN/i.test(text)) status = "LOW_MARGIN_SIMILAR_ONLY";
  else if (assistEnabled && /NONE_OF_THE_ABOVE|NO_EXACT_MATCH|FAMILY_ONLY_MATCH/i.test(text)) status = "OPEN_SET_NO_EXACT_MATCH";
  else if (assistEnabled && unavailable && rawCandidateCount === 0) status = "RETRIEVAL_UNAVAILABLE";
  else if (assistEnabled && rawCandidateCount > 0 && approvedCandidateCount === 0) status = "REFERENCE_CANDIDATES_ONLY";
  else if (assistEnabled) status = "EVIDENCE_BACKED_NO_CATALOG";

  return {
    status,
    release_policy: promptCandidateCount > 0
      ? "writer_quick_review_with_catalog_assist"
      : "evidence_backed_writer_review_catalog_gap",
    assist_enabled: assistEnabled,
    known_catalog_candidate_available: promptCandidateCount > 0,
    prompt_safe_candidate_count: promptCandidateCount,
    prompt_candidate_ids: [...new Set([...catalogAssistPromptCandidateIds(data), ...vectorAssistPromptCandidateIds(data)])],
    raw_candidate_count: rawCandidateCount,
    approved_candidate_count: approvedCandidateCount,
    conflict_blocked_count: conflictBlockedCount,
    catalog_gap_queue_candidate: assistEnabled && promptCandidateCount === 0,
    fail_closed_candidate: assistEnabled && promptCandidateCount === 0 && (rawCandidateCount > 0 || approvedCandidateCount > 0 || conflictBlockedCount > 0),
    unknown_card_ready: assistEnabled && promptCandidateCount === 0,
    open_set_decision: openSetDecision,
    open_set_reason: vectorSignal.reason || catalogSignal.reason || null,
    reasons
  };
}

function technicalOpenSetReadiness(code = "technical_failure") {
  return {
    status: "TECHNICAL_FAILURE",
    release_policy: "retry_or_manual_review",
    assist_enabled: false,
    known_catalog_candidate_available: false,
    prompt_safe_candidate_count: 0,
    prompt_candidate_ids: [],
    raw_candidate_count: 0,
    approved_candidate_count: 0,
    conflict_blocked_count: 0,
    catalog_gap_queue_candidate: false,
    fail_closed_candidate: false,
    unknown_card_ready: false,
    reasons: [normalizeText(code || "technical_failure")]
  };
}

function candidateTitleForProxy(candidate = {}) {
  return normalizeText(
    candidate.reference_title
    || candidate.canonical_title
    || candidate.title
    || candidate.evidence_excerpt
  );
}

function correctedCandidateMatches(candidate = {}, referenceTitle = "") {
  const candidateTitle = candidateTitleForProxy(candidate);
  if (!candidateTitle || !referenceTitle) return false;
  const comparison = titleComparison(referenceTitle, candidateTitle);
  return comparison?.exact === true || Number(comparison?.token_recall || 0) >= 0.9;
}

function correctCatalogCandidateRank(data = {}, referenceTitle = "") {
  const candidates = catalogCandidates(data);
  const index = candidates.findIndex((candidate) => correctedCandidateMatches(candidate, referenceTitle));
  return index >= 0 ? index + 1 : null;
}

function correctCandidateRecallAt(rank, k) {
  if (rank === null || rank === undefined || rank === "") return false;
  if (!Number.isFinite(Number(rank))) return false;
  return Number(rank) <= Number(k);
}

function vectorDecisionSelectedCandidateId(data = {}) {
  return normalizeText(
    data.vector_candidate_decision?.selected_candidate_id
    || data.provider_result?.vector_candidate_decision?.selected_candidate_id
    || data.fields?.vector_candidate_decision?.selected_candidate_id
  );
}

function selectedCandidateIdFromCandidates(candidates = []) {
  const selected = candidates.find((candidate) => candidate.selected === true);
  if (!selected) return "";
  return normalizeText(selected.candidate_id || selected.candidate_identity_id || selected.identity_id || selected.source_url);
}

function compactCandidate(candidate = {}, index = 0) {
  return {
    id: normalizeText(candidate.candidate_id || candidate.candidate_identity_id || candidate.identity_id || candidate.source_url || `candidate-${index + 1}`),
    rank: Number(candidate.rank || candidate.channel_rank || index + 1),
    title: candidateTitleForProxy(candidate),
    provider: normalizeText(candidate.provider_id || candidate.source_provider || candidate.source_type),
    selected: candidate.selected === true,
    raw_score: Number.isFinite(Number(candidate.raw_score)) ? Number(candidate.raw_score) : null,
    normalized_score: Number.isFinite(Number(candidate.normalized_score)) ? Number(candidate.normalized_score) : null,
    supporting_fields: Array.isArray(candidate.supporting_fields) ? candidate.supporting_fields : [],
    conflicting_fields: [
      ...(Array.isArray(candidate.conflicting_fields) ? candidate.conflicting_fields : []),
      ...(Array.isArray(candidate.direct_evidence_conflicts) ? candidate.direct_evidence_conflicts : []),
      ...(Array.isArray(candidate.conflicts) ? candidate.conflicts : [])
    ].map((value) => typeof value === "string" ? value : value?.field || value?.field_name || "").filter(Boolean)
  };
}

function compactCandidates(candidates = [], limit = 5) {
  return candidates.slice(0, limit).map(compactCandidate);
}

function compactComparableValue(value) {
  if (Array.isArray(value)) return value.map(compactComparableValue).filter(Boolean).sort().join("|");
  return normalizeText(value).toLowerCase().replace(/^0+(?=\d)/g, "");
}

function fieldValue(layer = {}, fieldName = "") {
  if (!layer || typeof layer !== "object" || Array.isArray(layer)) return null;
  const value = layer[fieldName];
  if (fieldName === "cert_number") {
    return value ?? layer.cert ?? layer.certificate_number ?? null;
  }
  if (fieldName === "card_grade") return value ?? layer.grade ?? null;
  return value ?? null;
}

function evidenceFieldFor(data = {}, fieldName = "") {
  const evidence = data.normalized_evidence || data.evidence || {};
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  return evidence[fieldName] || null;
}

function evidenceSourcesFor(data = {}, fieldName = "") {
  const field = evidenceFieldFor(data, fieldName);
  return Array.isArray(field?.sources) ? field.sources : [];
}

function sourceType(source = {}) {
  return String(source.source_type || source.source || source.provider_id || "").trim().toUpperCase();
}

function sourceLooksDirectCurrentImage(source = {}) {
  const type = sourceType(source);
  if (source.direct_observation === true) return true;
  return [
    "CARD_FRONT",
    "CARD_BACK",
    "CARD_FRONT_PRINTED_TEXT",
    "CARD_BACK_PRINTED_TEXT",
    "SLAB_LABEL",
    "OCR",
    "VISION_MODEL"
  ].includes(type);
}

function sourceLooksReferenceOnly(source = {}) {
  const type = sourceType(source);
  const original = String(source.original_source_type || "").trim().toUpperCase();
  const url = String(source.source_url || "");
  const kind = String(source.evidence_kind || "");
  return original === "VISUAL_VECTOR"
    || ["VISUAL_VECTOR", "VISUAL_GUESS", "MARKETPLACE", "OPEN_WEB"].includes(type)
    || url.startsWith("supabase://catalog-cards/")
    || url.startsWith("supabase://card-identities/")
    || /visual_vector|reference|catalog/i.test(kind);
}

function catalogBaseSupport(data = {}) {
  const evidenceSources = evidenceSourcesFor(data, "official_card_type");
  if (evidenceSources.some((source) => {
    const type = sourceType(source);
    return ["INTERNAL_APPROVED_HISTORY", "OFFICIAL_CHECKLIST", "OFFICIAL_PRODUCT_PAGE", "STRUCTURED_DATABASE"].includes(type)
      || String(source.source_url || "").startsWith("supabase://catalog-cards/");
  })) return true;
  return catalogCandidates(data).some((candidate) => {
    const fields = candidate.fields && typeof candidate.fields === "object" ? candidate.fields : {};
    return /^base$/i.test(normalizeText(fields.official_card_type || fields.card_type || fields.insert));
  });
}

function cardTypeDefaultBaseDetected(data = {}) {
  const resolved = data.resolved_fields || data.resolved || {};
  const rendered = data.rendered_fields?.fields || data.rendered_fields || {};
  const raw = data.fields || {};
  const cardTypeBase = [resolved, rendered, raw].some((layer) => /^base$/i.test(normalizeText(fieldValue(layer, "card_type"))));
  const officialBase = [resolved, rendered, raw].some((layer) => /^base$/i.test(normalizeText(fieldValue(layer, "official_card_type"))));
  if (!cardTypeBase && !officialBase) return false;
  return !catalogBaseSupport(data);
}

function candidateReferenceValueMatches(data = {}, fieldName = "", value = null) {
  const target = compactComparableValue(value);
  if (!target) return false;
  const candidates = [
    ...retrievalSources(data),
    ...catalogPacketCandidates(data),
    ...vectorPacketCandidates(data),
    ...catalogAssistPacketCandidates(data),
    ...vectorAssistPacketCandidates(data)
  ];
  return candidates.some((candidate) => {
    const fields = candidate.fields && typeof candidate.fields === "object" ? candidate.fields : {};
    const values = [
      fieldValue(fields, fieldName),
      fieldName === "card_grade" ? fields.grade : null,
      fieldName === "cert_number" ? fields.cert || fields.certificate_number : null
    ].filter((item) => item !== null && item !== undefined);
    return values.some((item) => compactComparableValue(item) === target);
  });
}

function serialValueHasInstanceNumerator(value = "") {
  const text = normalizeText(value);
  return /^\d{1,4}\s*\/\s*\d{1,4}$/i.test(text)
    || /^\d{1,4}\s+of\s+\d{1,4}$/i.test(text);
}

function copiedReferenceInstanceFields(data = {}) {
  const resolved = data.resolved_fields || data.resolved || {};
  const fields = data.fields || {};
  const riskFields = [];
  for (const fieldName of ["serial_number", "grade_company", "card_grade", "auto_grade", "cert_number"]) {
    const value = fieldValue(resolved, fieldName) ?? fieldValue(fields, fieldName);
    if (!value || compactComparableValue(value) === "unknown") continue;
    if (fieldName === "serial_number" && !serialValueHasInstanceNumerator(value)) continue;
    const sources = evidenceSourcesFor(data, fieldName);
    const hasDirectSource = sources.some(sourceLooksDirectCurrentImage);
    const hasReferenceSource = sources.some(sourceLooksReferenceOnly) || candidateReferenceValueMatches(data, fieldName, value);
    if (hasReferenceSource && !hasDirectSource) riskFields.push(fieldName);
  }
  return [...new Set(riskFields)];
}

function decisionOutcomeForSingleRun(item = {}) {
  if (item.technical_failure) return "technical_failure";
  if (item.retrieval_title_assist_used === true) return "safe_retrieval_title_assist";
  if (item.catalog_candidate_selected_count > 0 || item.vector_selected_candidate_id) return "candidate_selected_single_run";
  if (item.catalog_candidate_count > 0 || item.vector_raw_candidate_count > 0) return "candidate_available_not_selected";
  return "no_candidate_assist";
}

function perCardDecisionTrace(results = []) {
  return results.map((item) => ({
    candidate_id: item.candidate_id,
    provider: item.provider,
    gpt_only_title: item.provider === providerModes.OPENAI_BASELINE ? item.final_evaluated_title || item.title || "" : null,
    catalog_only_title: item.provider === providerModes.OPENAI_CATALOG ? item.final_evaluated_title || item.scored_title || item.title || "" : null,
    catalog_vector_title: item.provider === providerModes.OPENAI_VECTOR ? item.final_evaluated_title || item.scored_title || item.title || "" : null,
    raw_model_title: item.title || "",
    candidate_guided_title: item.candidate_proxy_decision?.selected === true ? item.candidate_proxy_decision.selected_title : "",
    final_title: item.final_evaluated_title || item.scored_title || item.title || "",
    corrected_title: item.corrected_title_reference || "",
    corrected_title_token_recall: item.corrected_title_comparison?.token_recall ?? null,
    raw_corrected_title_token_recall: item.raw_corrected_title_comparison?.token_recall ?? null,
    pass_at_0_72: item.pass_at_0_72 === true,
    pass_at_0_80: item.pass_at_0_80 === true,
    candidate_proxy_decision: item.candidate_proxy_decision || null,
    catalog_candidates: item.catalog_candidates || [],
    catalog_prompt_candidate_count: item.catalog_prompt_candidate_count || 0,
    catalog_prompt_candidate_ids: item.catalog_prompt_candidate_ids || [],
    catalog_prompt_assist_used: item.catalog_prompt_assist_used === true,
    catalog_cache_hit: item.catalog_cache_hit === true,
    catalog_assist_eligibility: item.catalog_assist_eligibility || null,
    catalog_selected_candidate_id: item.catalog_selected_candidate_id || "",
    catalog_selected: Boolean(item.catalog_selected_candidate_id || item.catalog_candidate_selected_count > 0),
    vector_candidates: item.vector_candidates || [],
    vector_prompt_candidate_count: item.vector_prompt_candidate_count || 0,
    vector_prompt_candidate_ids: item.vector_prompt_candidate_ids || [],
    vector_prompt_assist_used: item.vector_prompt_assist_used === true,
    vector_lazy_skip: item.vector_lazy_skip === true,
    vector_lazy_skip_reason: item.vector_lazy_skip_reason || null,
    vector_lazy_skip_catalog_candidate_id: item.vector_lazy_skip_catalog_candidate_id || "",
    vector_lazy_skip_catalog_candidate_identity_id: item.vector_lazy_skip_catalog_candidate_identity_id || "",
    vector_assist_eligibility: item.vector_assist_eligibility || null,
    vector_selected_candidate_id: item.vector_selected_candidate_id || "",
    vector_selected: Boolean(item.vector_selected_candidate_id || item.visual_vector_selected_count > 0),
    open_set_readiness: item.open_set_readiness || null,
    open_set_status: item.open_set_status || "",
    catalog_gap_queue_candidate: item.catalog_gap_queue_candidate === true,
    fail_closed_candidate: item.fail_closed_candidate === true,
    unknown_card_ready: item.unknown_card_ready === true,
    retrieval_title_assist: item.retrieval_title_assist || null,
    retrieval_title_assist_used: item.retrieval_title_assist_used === true,
    fast_path_used: item.fast_path_used === true,
    fast_path: item.fast_path || null,
    card_type_default_base: item.card_type_default_base === true,
    copied_serial_grade_cert_from_reference: item.copied_serial_grade_cert_from_reference === true,
    copied_serial_grade_cert_from_reference_fields: item.copied_serial_grade_cert_from_reference_fields || [],
    outcome: decisionOutcomeForSingleRun(item),
    recovery_regression_no_change: "paired_baseline_required",
    main_changed_fields: []
  }));
}

function usageNumber(source = {}, keys = []) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function gptSelectedCorrectCatalogCandidate(data = {}, referenceTitle = "") {
  const selectedId = vectorDecisionSelectedCandidateId(data);
  if (!selectedId) return null;
  const selected = catalogCandidates(data).find((candidate) => {
    const ids = [
      candidate.candidate_id,
      candidate.candidate_identity_id,
      candidate.identity_id,
      candidate.source_url
    ].map(normalizeText);
    return ids.includes(selectedId);
  });
  if (!selected) return false;
  return correctedCandidateMatches(selected, referenceTitle);
}

function providersUsed(data = {}) {
  return [...new Set(retrievalSummaries(data).flatMap((summary) => Array.isArray(summary.providers_used) ? summary.providers_used : []))];
}

function visualVectorUsed(data = {}) {
  const queries = retrievalSummaries(data).flatMap((summary) => Array.isArray(summary.queries) ? summary.queries : []);
  const trace = retrievalSummaries(data).flatMap((summary) => Array.isArray(summary.trace) ? summary.trace : []);
  return providersUsed(data).includes("visual_vector")
    || data.vector_prompt_assist_used === true
    || vectorPacketCandidates(data).length > 0
    || queries.some((query) => query.family === "visual_vector" || query.provider_id === "visual_vector" || query.family === "SEARCH_VISUAL_VECTOR")
    || trace.some((entry) => entry.provider_id === "visual_vector" || entry.query?.family === "visual_vector" || entry.query?.family === "SEARCH_VISUAL_VECTOR")
    || visualVectorCandidateCount(data) > 0;
}

function postgresHybridUsed(data = {}) {
  const queries = retrievalSummaries(data).flatMap((summary) => Array.isArray(summary.queries) ? summary.queries : []);
  const trace = retrievalSummaries(data).flatMap((summary) => Array.isArray(summary.trace) ? summary.trace : []);
  return providersUsed(data).includes("postgres_hybrid")
    || queries.some((query) => query.family === "postgres_hybrid" || query.provider_id === "postgres_hybrid" || query.family === "SEARCH_POSTGRES_HYBRID")
    || trace.some((entry) => entry.provider_id === "postgres_hybrid" || entry.query?.family === "postgres_hybrid" || entry.query?.family === "SEARCH_POSTGRES_HYBRID")
    || postgresHybridCandidateCount(data) > 0;
}

function visualFeatureCount(data = {}) {
  const features = Array.isArray(data.visual_features?.features)
    ? data.visual_features.features
    : Array.isArray(data.recognition_preflight?.visual_features?.features)
      ? data.recognition_preflight.visual_features.features
      : [];
  return features.length;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

function protectionHeaders(bypassSecret = "") {
  return bypassSecret
    ? { "x-vercel-protection-bypass": bypassSecret }
    : {};
}

export function validateProtectionBypassSecret({ bypassSecret = "", env = {} } = {}) {
  const secret = String(bypassSecret || "").trim();
  if (!secret) return;

  if (secret.startsWith("sb_secret_")) {
    throw new Error("Cloud eval misconfigured: VERCEL_AUTOMATION_BYPASS_SECRET looks like a Supabase secret key.");
  }

  const supabaseSecrets = [
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.SUPABASE_SECRET_KEY
  ].map((value) => String(value || "").trim()).filter(Boolean);

  if (supabaseSecrets.includes(secret)) {
    throw new Error("Cloud eval misconfigured: VERCEL_AUTOMATION_BYPASS_SECRET matches a Supabase service/secret key.");
  }
}

async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 240_000, label = "Cloud request") {
  const maxAttempts = Math.max(1, Number(process.env.CLOUD_LISTING_API_FETCH_ATTEMPTS || 3));
  const retryableCodes = new Set([
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_SOCKET",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EAI_AGAIN"
  ]);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || 240_000));
    try {
      return await fetchImpl(url, {
        ...init,
        signal: init.signal || controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(`${label} timed out after ${Math.max(1, Number(timeoutMs) || 240_000)}ms.`);
        timeoutError.code = "cloud_request_timeout";
        timeoutError.retryable = true;
        if (attempt >= maxAttempts) throw timeoutError;
        await delay(Math.min(8000, 1000 * (2 ** (attempt - 1))));
        continue;
      }
      const code = error?.cause?.code || error?.code || "";
      const retryable = retryableCodes.has(code) || /fetch failed|network|socket|timeout/i.test(error?.message || "");
      if (!retryable || attempt >= maxAttempts) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(8000, 1000 * (2 ** (attempt - 1)))));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`${label} failed without a response.`);
}

async function login({ baseUrl, username, password, bypassSecret = "", requestTimeoutMs = 240_000, fetchImpl = globalThis.fetch }) {
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...protectionHeaders(bypassSecret) },
    body: JSON.stringify({ username, password })
  }, requestTimeoutMs, "Cloud login");
  const setCookie = response.headers.get("set-cookie") || "";
  if (!response.ok || !setCookie) {
    const text = await response.text().catch(() => "");
    throw new Error(`Cloud login failed: HTTP ${response.status} ${text.slice(0, 160)}`);
  }
  return setCookie.split(";")[0];
}

async function preflightCloudApi({
  baseUrl,
  cookie,
  bypassSecret = "",
  requestTimeoutMs = 240_000,
  fetchImpl = globalThis.fetch
}) {
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/listing-provider-status`, {
    method: "GET",
    headers: {
      cookie,
      ...protectionHeaders(bypassSecret)
    }
  }, requestTimeoutMs, "Cloud provider-status preflight");
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const trimmedText = text.trim();
  const looksJson = contentType.includes("json") || /^[{[]/.test(trimmedText);
  let data = null;
  if (looksJson) {
    try {
      data = JSON.parse(trimmedText || "{}");
    } catch {
      data = null;
    }
  }

  if (contentType.includes("text/html") || /^<!doctype html|<html[\s>]/i.test(trimmedText)) {
    throw new Error("Cloud preflight failed: Vercel protection bypass did not produce an application JSON response.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`Cloud preflight failed: application auth rejected provider-status request with HTTP ${response.status}.`);
  }

  if (!response.ok || !data) {
    throw new Error(`Cloud preflight failed: provider-status returned HTTP ${response.status} ${trimmedText.slice(0, 160)}`);
  }

  return {
    ok: true,
    http_status: response.status,
    provider_count: Array.isArray(data.providers || data.available_providers)
      ? (data.providers || data.available_providers).length
      : null,
    default_provider: data.default_provider || data.defaultProvider || null
  };
}

async function verifyExistingImage({
  baseUrl,
  cookie,
  image,
  bypassSecret = "",
  requestTimeoutMs = 240_000,
  verificationCache,
  fetchImpl = globalThis.fetch
}) {
  const cacheKey = verificationCacheKey(image);
  if (verificationCache?.has(cacheKey)) return verificationCache.get(cacheKey);

  const requestBody = JSON.stringify({
    object_path: image.object_path,
    bucket: image.bucket,
    image_id: image.image_id,
    asset_id: image.id,
    role: image.role
  });
  async function requestVerification(path) {
    const response = await fetchWithTimeout(fetchImpl, `${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        ...protectionHeaders(bypassSecret)
      },
      body: requestBody
    }, requestTimeoutMs, "Cloud image verification");
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const trimmedText = text.trim();
    const data = contentType.includes("json") || /^[{[]/.test(trimmedText)
      ? JSON.parse(trimmedText || "{}")
      : {};
    return { response, data, contentType, text };
  }

  let verificationResponse = await requestVerification("/api/listing-image-verify-existing");
  if (
    verificationResponse.response.ok &&
    verificationResponse.contentType.includes("text/html") &&
    !verificationResponse.data.ok
  ) {
    verificationResponse = await requestVerification("/api/listing-image-verify-existing.js");
  }
  const { response, data } = verificationResponse;
  if (!response.ok || data.ok !== true || !data.verification?.verification_token) {
    throw new Error(`Cloud image verification failed: HTTP ${response.status} ${String(data.message || "").slice(0, 180)}`);
  }

  const verification = data.verification;
  const verifiedImage = {
    ...image,
    objectPath: verification.object_path,
    object_path: verification.object_path,
    bucket: verification.bucket,
    storageVerified: true,
    storage_verified: true,
    storageVerificationToken: verification.verification_token,
    storage_verification_token: verification.verification_token,
    contentType: verification.content_type,
    content_type: verification.content_type,
    originalType: verification.content_type,
    original_type: verification.content_type,
    size: verification.size,
    originalSize: verification.size,
    original_size: verification.size,
    width: verification.width,
    originalWidth: verification.width,
    original_width: verification.width,
    height: verification.height,
    originalHeight: verification.height,
    original_height: verification.height,
    contentSha256: verification.content_sha256 || "",
    content_sha256: verification.content_sha256 || ""
  };
  verificationCache?.set(cacheKey, verifiedImage);
  return verifiedImage;
}

async function verifiedImageInputs({
  baseUrl,
  cookie,
  item,
  bypassSecret = "",
  requestTimeoutMs = 240_000,
  verificationCache,
  fetchImpl = globalThis.fetch
}) {
  const images = imageInputs(item);
  return Promise.all(images.map((image) => verifyExistingImage({
    baseUrl,
    cookie,
    image,
    bypassSecret,
    requestTimeoutMs,
    verificationCache,
    fetchImpl
  })));
}

async function callListingApi({
  baseUrl,
  cookie,
  item,
  providerMode,
  evalOptions = {},
  bypassSecret = "",
  requestTimeoutMs = 240_000,
  verificationCache,
  maxTitleLength = 80,
  fetchImpl = globalThis.fetch
}) {
  const provider = cloudProviderForMode(providerMode);
  const providerOptions = providerOptionsForMode(providerMode, evalOptions);
  const images = await verifiedImageInputs({
    baseUrl,
    cookie,
    item,
    bypassSecret,
    requestTimeoutMs,
    verificationCache,
    fetchImpl
  });
  const payload = {
    provider,
    provider_id: provider,
    provider_eval_mode: providerMode,
    provider_options: providerOptions,
    explicitEmergency: provider === "openai_legacy",
    explicit_emergency: provider === "openai_legacy",
    maxTitleLength,
    captureProfileId: "cloud_eval",
    category: item.category || "",
    catalog_observation_hint: providerOptions.send_corrected_title_hint_to_cloud === true
      ? catalogObservationHint(item)
      : null,
    images
  };
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/api/listing-copilot-title`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      ...protectionHeaders(bypassSecret)
    },
    body: JSON.stringify(payload)
  }, requestTimeoutMs, "Cloud title API");
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {
      confidence: "FAILED",
      reason: text.slice(0, 240),
      provider_error_code: "invalid_json_response"
    };
  }
  return {
    http_status: response.status,
    data
  };
}

function isProviderFailureResponse(response = {}, data = {}) {
  return response.http_status >= 400
    || data.confidence === "FAILED"
    || Boolean(data.provider_error_code)
    || Boolean(data.provider_error_type);
}

function providerFailureAttempt({
  response = {},
  data = {},
  error = null,
  attempt = 1,
  elapsedMs = 0
} = {}) {
  const httpStatus = response.http_status || error?.http_status || null;
  return {
    attempt,
    http_status: httpStatus,
    code: error?.code || providerFailureCode(data, httpStatus || 200) || "cloud_eval_error",
    reason: providerFailureReason(data, error?.message || ""),
    elapsed_ms: Math.max(0, Math.round(Number(elapsedMs) || 0)),
    retryable: error?.retryable === true || Number(httpStatus || 0) >= 400
  };
}

function evaluatedResultFromData({
  item,
  providerMode,
  response,
  referenceTitle,
  started,
  providerErrorAttempts = [],
  evalOptions = {}
} = {}) {
  const data = response?.data || {};
  const providerOptions = providerOptionsForMode(providerMode, evalOptions);
  const providerFailure = isProviderFailureResponse(response || {}, data);
  const breakpoints = resultBreakpoints(data, item);
  const finalTitle = normalizeText(data.final_title || data.title || data.rendered_title);
  const catalogTraceList = providerFailure ? [] : catalogCandidates(data);
  const vectorTraceList = providerFailure ? [] : vectorCandidatesForTrace(data);
  const catalogCandidateList = providerFailure ? [] : catalogCandidatesForProxy(data);
  const vectorCandidateList = providerFailure ? [] : vectorCandidatesForProxy(data);
  const candidateProxy = providerFailure
    ? null
    : candidateProxyDecision({
      providerMode,
      referenceTitle,
      rawTitle: finalTitle,
      catalogCandidateList,
      vectorCandidateList
    });
  const scoredTitle = normalizeText(candidateProxy?.selected_title || finalTitle);
  const rawTitleMatch = providerFailure ? null : titleComparison(referenceTitle, finalTitle);
  const titleMatch = providerFailure ? null : titleComparison(referenceTitle, scoredTitle);
  const correctCatalogRank = providerFailure ? null : correctCatalogCandidateRank(data, referenceTitle);
  const gptSelectedCorrect = providerFailure ? null : gptSelectedCorrectCatalogCandidate(data, referenceTitle);
  const copiedReferenceFields = providerFailure ? [] : copiedReferenceInstanceFields(data);
  const failureCode = providerFailure ? providerFailureCode(data, response?.http_status || 200) || "provider_failed" : null;
  const openSetReadiness = providerFailure ? technicalOpenSetReadiness(failureCode) : openSetReadinessForData(data);
  return {
    candidate_id: candidateId(item),
    provider: providerMode,
    requested_cloud_provider: cloudProviderForMode(providerMode),
    status: "evaluated",
    technical_failure: providerFailure,
    technical_failure_code: failureCode,
    corrected_title_as_temporary_gt: providerOptions.corrected_title_as_temporary_gt === true,
    corrected_title_hint_sent_to_cloud: providerOptions.send_corrected_title_hint_to_cloud === true,
    provider_error_recovered: providerErrorAttempts.length > 0 && !providerFailure,
    provider_error_attempts: providerErrorAttempts,
    provider_error_retry_count: providerErrorAttempts.length,
    http_status: response?.http_status || null,
    title: finalTitle,
    raw_model_title: finalTitle,
    scored_title: scoredTitle,
    final_evaluated_title: scoredTitle,
    candidate_proxy_decision: candidateProxy,
    confidence: data.confidence || (providerFailure ? "FAILED" : ""),
    provider_id: data.provider || data.source || null,
    model_id: data.model_id || data.provider_model_id || null,
    fallback_provider_id: data.fallback_provider_id || null,
    fallback_reason: data.fallback_reason || null,
    format_error_type: data.format_error_type || null,
    provider_error_code: providerFailure ? data.provider_error_code || data.provider_error_type || failureCode || null : null,
    provider_error_details: providerFailure ? data.provider_error_details || null : null,
    reason: providerFailure ? providerFailureReason(data) : "",
    publication_gate: data.publication_gate || null,
    raw_provider_fields: breakpoints.raw_provider_fields,
    normalized_evidence: breakpoints.normalized_evidence,
    resolved_fields: breakpoints.resolved_fields,
    rendered_fields: breakpoints.rendered_fields,
    reviewed_ground_truth: breakpoints.reviewed_ground_truth,
    breakpoints,
    fields: data.fields || null,
    resolved: data.resolved || null,
    identity_resolution_status: data.identity_resolution_status || null,
    provider_recognition_status: data.provider_recognition_status || null,
    provider_parse_source: data.provider_parse_source || null,
    provider_token_diagnostics: data.provider_token_diagnostics || null,
    provider_initial_token_diagnostics: data.provider_initial_token_diagnostics || null,
    field_task_orchestration: data.field_task_orchestration || null,
    field_task_status: Array.isArray(data.field_task_status) ? data.field_task_status : [],
    module_task_status: data.module_task_status || null,
    provider_truncation_retry_attempted: data.provider_truncation_retry_attempted === true,
    provider_truncation_retry_attempts: Number(data.provider_truncation_retry_attempts || 0),
    retrieval: data.retrieval || null,
    catalog_retrieval: data.catalog_retrieval || null,
    catalog_candidate_packet: data.catalog_candidate_packet || null,
    catalog_prompt_assist_used: data.catalog_prompt_assist_used === true,
    catalog_assist_eligibility: data.catalog_assist_eligibility || null,
    catalog_cache_hit: data.catalog_cache_hit === true,
    catalog_prompt_candidate_ids: catalogAssistPromptCandidateIds(data),
    retrieval_title_assist: data.retrieval_title_assist || null,
    retrieval_title_assist_used: data.retrieval_title_assist?.used === true,
    vector_retrieval: data.vector_retrieval || null,
    vector_candidate_packet: data.vector_candidate_packet || null,
    vector_prompt_assist_used: data.vector_prompt_assist_used === true,
    vector_assist_eligibility: data.vector_assist_eligibility || null,
    vector_raw_candidate_count: vectorAssistCount(data, "raw_candidate_count", visualVectorCandidateCount(data)),
    vector_approved_candidate_count: vectorAssistCount(data, "approved_candidate_count", 0),
    vector_conflict_blocked_count: vectorAssistCount(data, "conflict_blocked_count", 0),
    vector_prompt_candidate_count: vectorPromptCandidateCount(data),
    vector_prompt_candidate_ids: vectorAssistPromptCandidateIds(data),
    vector_lazy_skip: data.vector_lazy_skip?.skipped === true,
    vector_lazy_skip_reason: data.vector_lazy_skip?.reason || null,
    vector_lazy_skip_catalog_candidate_id: data.vector_lazy_skip?.catalog_candidate_id || "",
    vector_lazy_skip_catalog_candidate_identity_id: data.vector_lazy_skip?.catalog_candidate_identity_id || "",
    open_set_readiness: openSetReadiness,
    open_set_status: openSetReadiness?.status || null,
    known_catalog_candidate_available: openSetReadiness?.known_catalog_candidate_available === true,
    catalog_gap_queue_candidate: openSetReadiness?.catalog_gap_queue_candidate === true,
    fail_closed_candidate: openSetReadiness?.fail_closed_candidate === true,
    unknown_card_ready: openSetReadiness?.unknown_card_ready === true,
    visual_vector_used: visualVectorUsed(data),
    visual_vector_candidate_count: visualVectorCandidateCount(data),
    visual_vector_selected_count: visualVectorSelectedCount(data),
    visual_vector_consensus_field_count: visualVectorConsensusFieldCount(data),
    visual_vector_conflict_field_count: visualVectorConflictFieldCount(data),
    postgres_hybrid_used: postgresHybridUsed(data),
    postgres_hybrid_candidate_count: postgresHybridCandidateCount(data),
    catalog_lookup_used_count: catalogLookupUsedCount(data),
    catalog_candidate_count: catalogCandidateCount(data),
    catalog_prompt_candidate_count: catalogPromptCandidateCount(data),
    catalog_candidate_selected_count: catalogCandidateSelectedCount(data),
    catalog_candidates: compactCandidates(catalogTraceList),
    catalog_selected_candidate_id: selectedCandidateIdFromCandidates(catalogTraceList),
    correct_catalog_candidate_rank: correctCatalogRank,
    correct_catalog_identity_available: correctCatalogRank !== null && correctCatalogRank !== undefined && Number.isFinite(Number(correctCatalogRank)),
    correct_candidate_recall_at_1: correctCandidateRecallAt(correctCatalogRank, 1),
    correct_candidate_recall_at_3: correctCandidateRecallAt(correctCatalogRank, 3),
    correct_candidate_recall_at_5: correctCandidateRecallAt(correctCatalogRank, 5),
    gpt_selected_correct_candidate: gptSelectedCorrect,
    gpt_rejected_correct_candidate: gptSelectedCorrect === false && Number.isFinite(Number(correctCatalogRank)),
    vector_candidate_decision: data.vector_candidate_decision || null,
    vector_candidates: compactCandidates(vectorTraceList),
    vector_selected_candidate_id: selectedCandidateIdFromCandidates(vectorTraceList) || vectorDecisionSelectedCandidateId(data),
    fast_path: data.fast_path || null,
    fast_path_used: fastPathUsed(data),
    card_type_default_base: providerFailure ? false : cardTypeDefaultBaseDetected(data),
    copied_serial_grade_cert_from_reference: copiedReferenceFields.length > 0,
    copied_serial_grade_cert_from_reference_fields: copiedReferenceFields,
    retrieval_providers_used: providersUsed(data),
    candidate_identity_candidate_count: candidateIdentityCandidateCount(data),
    visual_feature_count: visualFeatureCount(data),
    visual_feature_summary: data.visual_feature_summary || null,
    recognition_preflight: data.recognition_preflight || null,
    usage: data.usage || null,
    native_schema_valid: data.native_schema_valid === true,
    format_repair_attempted: data.format_repair_attempted === true,
    local_json_repair_success: data.local_json_repair_success === true,
    text_repair_success: data.text_repair_success === true,
    writer_review_ready: data.writer_review_ready === true || data.publication_gate?.writer_review_ready === true,
    corrected_title_reference: referenceTitle,
    corrected_title_comparison: titleMatch,
    raw_corrected_title_comparison: rawTitleMatch,
    pass_at_0_72: Number(titleMatch?.token_recall || 0) >= 0.72,
    pass_at_0_80: Number(titleMatch?.token_recall || 0) >= 0.80,
    timing: data.timing || null,
    elapsed_ms: Date.now() - started
  };
}

function technicalFailureResult({
  item,
  providerMode,
  referenceTitle,
  started,
  error,
  providerErrorAttempts = [],
  evalOptions = {}
} = {}) {
  const code = error?.code || "cloud_eval_error";
  const providerOptions = providerOptionsForMode(providerMode, evalOptions);
  return {
    candidate_id: candidateId(item),
    provider: providerMode,
    requested_cloud_provider: cloudProviderForMode(providerMode),
    status: "evaluated",
    technical_failure: true,
    technical_failure_code: code,
    provider_error_recovered: false,
    corrected_title_as_temporary_gt: providerOptions.corrected_title_as_temporary_gt === true,
    corrected_title_hint_sent_to_cloud: providerOptions.send_corrected_title_hint_to_cloud === true,
    provider_error_attempts: providerErrorAttempts.length
      ? providerErrorAttempts
      : [providerFailureAttempt({ error, attempt: 1, elapsedMs: Date.now() - started })],
    provider_error_retry_count: providerErrorAttempts.length,
    confidence: "FAILED",
    provider_error_code: code,
    reason: normalizeText(error?.message || "").slice(0, 240),
    title: "",
    open_set_readiness: technicalOpenSetReadiness(code),
    open_set_status: "TECHNICAL_FAILURE",
    known_catalog_candidate_available: false,
    catalog_gap_queue_candidate: false,
    fail_closed_candidate: false,
    unknown_card_ready: false,
    corrected_title_reference: referenceTitle,
    corrected_title_comparison: null,
    elapsed_ms: Date.now() - started
  };
}

function summarize(results = [], elapsedMs = 0) {
  const attempted = results.length;
  const temporaryGtUsed = results.some((item) => item.corrected_title_as_temporary_gt === true);
  const correctedTitleHintSentCount = results.filter((item) => item.corrected_title_hint_sent_to_cloud === true).length;
  const providerErrors = results.filter((item) => item.status === "provider_error").length;
  const evaluated = results.filter((item) => item.status === "evaluated").length;
  const technicalFailures = results.filter((item) => item.technical_failure === true).length;
  const recoveredProviderErrors = results.filter((item) => item.provider_error_recovered === true).length;
  const providerErrorRetryCount = results.reduce((sum, item) => sum + Number(item.provider_error_retry_count || 0), 0);
  const providerSuccessCount = results.filter((item) => {
    return item.status === "evaluated"
      && item.technical_failure !== true
      && item.confidence !== "FAILED"
      && !item.provider_error_code;
  }).length;
  const fallbackCount = results.filter((item) => item.fallback_provider_id).length;
  const criticalFailed = results.filter((item) => item.technical_failure === true || item.provider_error_code || item.confidence === "FAILED").length;
  const visualVectorUsedCount = results.filter((item) => item.visual_vector_used === true).length;
  const visualVectorCandidateCount = results.reduce((sum, item) => sum + Number(item.visual_vector_candidate_count || 0), 0);
  const visualVectorSelectedCount = results.reduce((sum, item) => sum + Number(item.visual_vector_selected_count || 0), 0);
  const visualVectorConsensusFieldCount = results.reduce((sum, item) => sum + Number(item.visual_vector_consensus_field_count || 0), 0);
  const visualVectorConflictFieldCount = results.reduce((sum, item) => sum + Number(item.visual_vector_conflict_field_count || 0), 0);
  const postgresHybridUsedCount = results.filter((item) => item.postgres_hybrid_used === true).length;
  const postgresHybridCandidateCount = results.reduce((sum, item) => sum + Number(item.postgres_hybrid_candidate_count || 0), 0);
  const catalogLookupUsedCount = results.reduce((sum, item) => sum + Number(item.catalog_lookup_used_count || 0), 0);
  const catalogCandidateCountTotal = results.reduce((sum, item) => sum + Number(item.catalog_candidate_count || 0), 0);
  const catalogPromptCandidateCount = results.reduce((sum, item) => sum + Number(item.catalog_prompt_candidate_count || 0), 0);
  const catalogCandidateSelectedCount = results.reduce((sum, item) => sum + Number(item.catalog_candidate_selected_count || 0), 0);
  const catalogPromptAssistUsedCount = results.filter((item) => item.catalog_prompt_assist_used === true).length;
  const catalogCacheHitCount = results.filter((item) => item.catalog_cache_hit === true).length;
  const catalogPromptCandidateIds = [...new Set(results.flatMap((item) => Array.isArray(item.catalog_prompt_candidate_ids) ? item.catalog_prompt_candidate_ids : []))];
  const correctCatalogIdentityAvailableCount = results.filter((item) => item.correct_catalog_identity_available === true).length;
  const correctCandidateRecallAt1 = results.filter((item) => item.correct_candidate_recall_at_1 === true).length;
  const correctCandidateRecallAt3 = results.filter((item) => item.correct_candidate_recall_at_3 === true).length;
  const correctCandidateRecallAt5 = results.filter((item) => item.correct_candidate_recall_at_5 === true).length;
  const gptSelectedCorrectCandidateCount = results.filter((item) => item.gpt_selected_correct_candidate === true).length;
  const gptRejectedCorrectCandidateCount = results.filter((item) => item.gpt_rejected_correct_candidate === true).length;
  const candidateIdentityCandidateCount = results.reduce((sum, item) => sum + Number(item.candidate_identity_candidate_count || 0), 0);
  const vectorAssistEligibleCount = results.filter((item) => item.vector_assist_eligibility?.eligible === true).length;
  const vectorPromptAssistUsedCount = results.filter((item) => item.vector_prompt_assist_used === true).length;
  const vectorRawCandidateCount = results.reduce((sum, item) => sum + Number(item.vector_raw_candidate_count || 0), 0);
  const vectorApprovedCandidateCount = results.reduce((sum, item) => sum + Number(item.vector_approved_candidate_count || 0), 0);
  const vectorConflictBlockedCount = results.reduce((sum, item) => sum + Number(item.vector_conflict_blocked_count || 0), 0);
  const vectorPromptCandidateCount = results.reduce((sum, item) => sum + Number(item.vector_prompt_candidate_count || 0), 0);
  const vectorPromptCandidateIds = [...new Set(results.flatMap((item) => Array.isArray(item.vector_prompt_candidate_ids) ? item.vector_prompt_candidate_ids : []))];
  const vectorLazySkipCount = results.filter((item) => item.vector_lazy_skip === true).length;
  const retrievalTitleAssistUsedCount = results.filter((item) => item.retrieval_title_assist_used === true).length;
  const storedVisualFeatureCount = results.reduce((sum, item) => sum + Number(item.visual_feature_count || 0), 0);
  const truncationRetryCount = results.filter((item) => item.provider_truncation_retry_attempted === true).length;
  const fastPathUsedCount = results.filter((item) => item.fast_path_used === true).length;
  const cardTypeDefaultBaseCount = results.filter((item) => item.card_type_default_base === true).length;
  const copiedSerialGradeCertFromReferenceCount = results.filter((item) => item.copied_serial_grade_cert_from_reference === true).length;
  const averageRecallValues = results
    .map((item) => item.corrected_title_comparison?.token_recall)
    .filter((value) => Number.isFinite(value));
  const rawAverageRecallValues = results
    .map((item) => item.raw_corrected_title_comparison?.token_recall)
    .filter((value) => Number.isFinite(value));
  const passAt072 = results.filter((item) => item.pass_at_0_72 === true).length;
  const passAt080 = results.filter((item) => item.pass_at_0_80 === true).length;
  const rawPassAt072 = results.filter((item) => Number(item.raw_corrected_title_comparison?.token_recall || 0) >= 0.72).length;
  const rawPassAt080 = results.filter((item) => Number(item.raw_corrected_title_comparison?.token_recall || 0) >= 0.80).length;
  const candidateProxySelectedCount = results.filter((item) => item.candidate_proxy_decision?.selected === true).length;
  const candidateProxyCatalogSelectedCount = results.filter((item) => item.candidate_proxy_decision?.selected_source === "catalog").length;
  const candidateProxyVectorSelectedCount = results.filter((item) => item.candidate_proxy_decision?.selected_source === "vector").length;
  const openSetStatusCounts = results.reduce((counts, item) => {
    const status = normalizeText(item.open_set_status || item.open_set_readiness?.status || "UNKNOWN");
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const knownCatalogCandidateAvailableCount = results.filter((item) => item.known_catalog_candidate_available === true).length;
  const catalogGapQueueCandidateCount = results.filter((item) => item.catalog_gap_queue_candidate === true).length;
  const failClosedCandidateCount = results.filter((item) => item.fail_closed_candidate === true).length;
  const unknownCardReadyCount = results.filter((item) => item.unknown_card_ready === true).length;
  const elapsedValues = results
    .map((item) => item.timing?.total_ms ?? item.elapsed_ms)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  const completenessAverage = (layerName) => {
    const values = results
      .map((item) => item.breakpoints?.completeness?.[layerName]?.ratio)
      .filter((value) => Number.isFinite(value));
    return values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
      : null;
  };
  const usageTotals = results.reduce((totals, item) => {
    const usage = item.usage && typeof item.usage === "object" && !Array.isArray(item.usage)
      ? item.usage
      : {};
    const diagnostics = item.provider_token_diagnostics && typeof item.provider_token_diagnostics === "object" && !Array.isArray(item.provider_token_diagnostics)
      ? item.provider_token_diagnostics
      : {};
    const initialDiagnostics = item.provider_initial_token_diagnostics && typeof item.provider_initial_token_diagnostics === "object" && !Array.isArray(item.provider_initial_token_diagnostics)
      ? item.provider_initial_token_diagnostics
      : {};
    for (const key of [
      "provider_calls",
      "retrieval_calls",
      "latency_ms",
      "estimated_cost_usd",
      "input_tokens",
      "output_tokens",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "image_count"
    ]) {
      const value = Number(usage[key]);
      if (Number.isFinite(value)) totals[key] = Number(((totals[key] || 0) + value).toFixed(6));
    }
    if (!Number.isFinite(Number(usage.input_tokens)) && !Number.isFinite(Number(usage.prompt_tokens))) {
      totals.input_tokens = Number(((totals.input_tokens || 0) + usageNumber(diagnostics, ["input_tokens", "prompt_token_count", "prompt_tokens"]) + usageNumber(initialDiagnostics, ["input_tokens", "prompt_token_count", "prompt_tokens"])).toFixed(6));
    }
    if (!Number.isFinite(Number(usage.output_tokens)) && !Number.isFinite(Number(usage.completion_tokens))) {
      totals.output_tokens = Number(((totals.output_tokens || 0) + usageNumber(diagnostics, ["output_tokens", "candidates_token_count", "completion_tokens"]) + usageNumber(initialDiagnostics, ["output_tokens", "candidates_token_count", "completion_tokens"])).toFixed(6));
    }
    if (!Number.isFinite(Number(usage.total_tokens))) {
      totals.total_tokens = Number(((totals.total_tokens || 0) + usageNumber(diagnostics, ["total_tokens", "total_token_count"]) + usageNumber(initialDiagnostics, ["total_tokens", "total_token_count"])).toFixed(6));
    }
    return totals;
  }, {});
  const percentile = (p) => {
    if (!elapsedValues.length) return null;
    const index = Math.min(elapsedValues.length - 1, Math.max(0, Math.ceil(elapsedValues.length * p) - 1));
    return Math.round(elapsedValues[index]);
  };
  const rate = (count, denominator = attempted) => denominator ? Number((count / denominator).toFixed(6)) : null;
  const rawTokenRecallAvg = rawAverageRecallValues.length
    ? Number((rawAverageRecallValues.reduce((sum, value) => sum + value, 0) / rawAverageRecallValues.length).toFixed(6))
    : null;
  const finalTokenRecallAvg = averageRecallValues.length
    ? Number((averageRecallValues.reduce((sum, value) => sum + value, 0) / averageRecallValues.length).toFixed(6))
    : null;
  return {
    attempted_count: attempted,
    evaluated_count: evaluated,
    accuracy_policy: {
      corrected_title_as_temporary_gt: temporaryGtUsed,
      corrected_title_hint_sent_to_cloud: correctedTitleHintSentCount > 0,
      corrected_title_hint_sent_to_cloud_count: correctedTitleHintSentCount,
      corrected_title_temporary_gt_scope: "cloud_eval_proxy_title_candidate_scoring_and_optional_cloud_hint",
      corrected_title_token_recall_is_identity_accuracy: false,
      corrected_title_token_recall_use: "temporary_gt_title_overlap_proxy_only",
      correct_catalog_candidate_basis: "corrected_title_proxy_until_reviewed_field_ground_truth_exists",
      default_cloud_eval_mode: correctedTitleHintSentCount > 0
        ? "answer_hint_enabled_not_blind"
        : "blind_to_corrected_title_hint",
      reviewed_ground_truth_required_for_ai_card_exact: true
    },
    provider_error_count: providerErrors,
    technical_failure_count: technicalFailures,
    provider_error_recovered_count: recoveredProviderErrors,
    provider_error_retry_count: providerErrorRetryCount,
    provider_success_count: providerSuccessCount,
    provider_success_rate: attempted ? Number((providerSuccessCount / attempted).toFixed(6)) : null,
    fallback_count: fallbackCount,
    failed_count: criticalFailed,
    visual_vector_used_count: visualVectorUsedCount,
    visual_vector_candidate_count: visualVectorCandidateCount,
    visual_vector_selected_count: visualVectorSelectedCount,
    visual_vector_consensus_field_count: visualVectorConsensusFieldCount,
    visual_vector_conflict_field_count: visualVectorConflictFieldCount,
    postgres_hybrid_used_count: postgresHybridUsedCount,
    postgres_hybrid_candidate_count: postgresHybridCandidateCount,
    catalog_lookup_used_count: catalogLookupUsedCount,
    catalog_candidate_count: catalogCandidateCountTotal,
    catalog_prompt_candidate_count: catalogPromptCandidateCount,
    catalog_prompt_assist_used_count: catalogPromptAssistUsedCount,
    catalog_cache_hit_count: catalogCacheHitCount,
    catalog_cache_hit_rate: rate(catalogCacheHitCount),
    catalog_prompt_candidate_ids: catalogPromptCandidateIds,
    catalog_candidate_selected_count: catalogCandidateSelectedCount,
    catalog_candidate_available_rate: rate(correctCatalogIdentityAvailableCount),
    correct_catalog_identity_available_count: correctCatalogIdentityAvailableCount,
    correct_candidate_recall_at_1: correctCandidateRecallAt1,
    correct_candidate_recall_at_3: correctCandidateRecallAt3,
    correct_candidate_recall_at_5: correctCandidateRecallAt5,
    candidate_recall_at_1: {
      count: correctCandidateRecallAt1,
      denominator: attempted,
      rate: rate(correctCandidateRecallAt1)
    },
    candidate_recall_at_3: {
      count: correctCandidateRecallAt3,
      denominator: attempted,
      rate: rate(correctCandidateRecallAt3)
    },
    candidate_recall_at_5: {
      count: correctCandidateRecallAt5,
      denominator: attempted,
      rate: rate(correctCandidateRecallAt5)
    },
    gpt_selected_correct_candidate_count: gptSelectedCorrectCandidateCount,
    gpt_rejected_correct_candidate_count: gptRejectedCorrectCandidateCount,
    candidate_selection_accuracy: {
      selected_correct_count: gptSelectedCorrectCandidateCount,
      available_correct_candidate_count: correctCatalogIdentityAvailableCount,
      rate: rate(gptSelectedCorrectCandidateCount, correctCatalogIdentityAvailableCount)
    },
    catalog_recovery_count: null,
    catalog_regression_count: null,
    catalog_net_benefit: null,
    candidate_identity_candidate_count: candidateIdentityCandidateCount,
    vector_assist_eligible_count: vectorAssistEligibleCount,
    vector_prompt_assist_used_count: vectorPromptAssistUsedCount,
    vector_raw_candidate_count: vectorRawCandidateCount,
    vector_approved_candidate_count: vectorApprovedCandidateCount,
    vector_conflict_blocked_count: vectorConflictBlockedCount,
    vector_prompt_candidate_count: vectorPromptCandidateCount,
    vector_prompt_candidate_ids: vectorPromptCandidateIds,
    vector_lazy_skip_count: vectorLazySkipCount,
    vector_lazy_skip_rate: rate(vectorLazySkipCount),
    open_set_status_counts: openSetStatusCounts,
    known_catalog_candidate_available_count: knownCatalogCandidateAvailableCount,
    catalog_gap_queue_candidate_count: catalogGapQueueCandidateCount,
    fail_closed_candidate_count: failClosedCandidateCount,
    unknown_card_ready_count: unknownCardReadyCount,
    retrieval_title_assist_used_count: retrievalTitleAssistUsedCount,
    fast_path_used_count: fastPathUsedCount,
    card_type_default_base_count: cardTypeDefaultBaseCount,
    copied_serial_grade_cert_from_reference_count: copiedSerialGradeCertFromReferenceCount,
    visual_feature_count: storedVisualFeatureCount,
    provider_truncation_retry_count: truncationRetryCount,
    raw_blind_output_accuracy: {
      corrected_title_token_recall_avg: rawTokenRecallAvg,
      pass_at_0_72_count: rawPassAt072,
      pass_at_0_72_rate: rate(rawPassAt072),
      pass_at_0_80_count: rawPassAt080,
      pass_at_0_80_rate: rate(rawPassAt080)
    },
    raw_corrected_title_token_recall_avg: rawTokenRecallAvg,
    corrected_title_token_recall_avg: finalTokenRecallAvg,
    raw_pass_at_0_72_count: rawPassAt072,
    raw_pass_at_0_72_rate: attempted ? Number((rawPassAt072 / attempted).toFixed(6)) : null,
    pass_at_0_72_count: passAt072,
    pass_at_0_72_rate: attempted ? Number((passAt072 / attempted).toFixed(6)) : null,
    raw_pass_at_0_80_count: rawPassAt080,
    raw_pass_at_0_80_rate: attempted ? Number((rawPassAt080 / attempted).toFixed(6)) : null,
    pass_at_0_80_count: passAt080,
    pass_at_0_80_rate: attempted ? Number((passAt080 / attempted).toFixed(6)) : null,
    candidate_proxy_selected_count: candidateProxySelectedCount,
    candidate_proxy_catalog_selected_count: candidateProxyCatalogSelectedCount,
    candidate_proxy_vector_selected_count: candidateProxyVectorSelectedCount,
    oracle_candidate_upper_bound: {
      proxy_selected_count: candidateProxySelectedCount,
      catalog_proxy_selected_count: candidateProxyCatalogSelectedCount,
      vector_proxy_selected_count: candidateProxyVectorSelectedCount,
      corrected_title_token_recall_avg: finalTokenRecallAvg,
      pass_at_0_72_count: passAt072,
      pass_at_0_72_rate: rate(passAt072),
      pass_at_0_80_count: passAt080,
      pass_at_0_80_rate: rate(passAt080),
      note: "temporary corrected_title proxy; not reviewed identity accuracy"
    },
    elapsed_ms: Math.max(0, Math.round(elapsedMs)),
    attempted_cards_per_minute: elapsedMs > 0 ? Number((attempted / (elapsedMs / 60000)).toFixed(6)) : null,
    evaluated_cards_per_minute: elapsedMs > 0 ? Number((evaluated / (elapsedMs / 60000)).toFixed(6)) : null,
    per_card_latency_ms: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99)
    },
    breakpoint_completeness_avg: {
      raw_provider_fields: completenessAverage("raw_provider_fields"),
      normalized_evidence: completenessAverage("normalized_evidence"),
      resolved_fields: completenessAverage("resolved_fields"),
      rendered_fields: completenessAverage("rendered_fields"),
      reviewed_ground_truth: completenessAverage("reviewed_ground_truth")
    },
    usage_totals: usageTotals,
    decision_trace: perCardDecisionTrace(results)
  };
}

export async function evaluateCloudListingApi({
  dataset,
  baseUrl,
  provider,
  limit = 1,
  concurrency = 1,
  username,
  password,
  bypassSecret = "",
  requestTimeoutMs = 240_000,
  maxTitleLength = 80,
  correctedTitleAsTemporaryGt = true,
  sendCorrectedTitleHintToCloud = false,
  disableVectorLazyMode = false,
  providerErrorRetries = 1,
  providerErrorRetryDelayMs = 1500,
  skipPreflight = false,
  progress = false,
  checkpointPath = "",
  fetchImpl = globalThis.fetch
} = {}) {
  if (!baseUrl) throw new Error("Cloud base URL is required.");
  if (!username || !password) throw new Error("METAVERSE_USERNAME and METAVERSE_PASSWORD are required.");
  if (typeof fetchImpl !== "function") throw new Error("fetch is required.");
  const providerMode = normalizeProviderMode(provider);
  const evalOptions = {
    correctedTitleAsTemporaryGt,
    sendCorrectedTitleHintToCloud,
    disableVectorLazyMode
  };

  const limitCount = Math.max(0, Math.trunc(Number(limit) || 0));
  const selected = (Array.isArray(dataset?.items) ? dataset.items : [])
    .filter((item) => imageInputs(item).length > 0)
    .slice(0, limitCount);
  const cookie = await login({ baseUrl, username, password, bypassSecret, requestTimeoutMs, fetchImpl });
  const cloudPreflight = skipPreflight
    ? { ok: true, skipped: true }
    : await preflightCloudApi({ baseUrl, cookie, bypassSecret, requestTimeoutMs, fetchImpl });
  const verificationCache = new Map();
  const startedAt = Date.now();
  const results = [];
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Math.trunc(Number(concurrency) || 1), selected.length || 1));
  let checkpointWrite = Promise.resolve();

  function activeResults() {
    return results.filter(Boolean);
  }

  function buildReport(status = "completed") {
    return {
      schema_version: "cloud-listing-api-eval-v1",
      status,
      generated_at: new Date().toISOString(),
      base_url: baseUrl,
      provider: providerMode,
      requested_cloud_provider: cloudProviderForMode(providerMode),
      target_count: selected.length,
      configured_concurrency: workerCount,
      configured_provider_error_retries: Math.max(0, Math.trunc(Number(providerErrorRetries) || 0)),
      cloud_preflight: cloudPreflight,
      ...summarize(activeResults(), Date.now() - startedAt),
      results: activeResults()
    };
  }

  async function writeCheckpoint() {
    if (!checkpointPath) return;
    checkpointWrite = checkpointWrite.then(() => writeJson(checkpointPath, buildReport("running"))).catch(() => {});
    await checkpointWrite;
  }

  function logProgress(message) {
    if (!progress) return;
    process.stderr.write(`${message}\n`);
  }

  async function worker() {
    while (cursor < selected.length) {
      const index = cursor;
      cursor += 1;
      const item = selected[index];
      const referenceTitle = correctedTitle(item);
      const started = Date.now();
      const providerErrorAttempts = [];
      const maxProviderAttempts = Math.max(1, Math.trunc(Number(providerErrorRetries) || 0) + 1);
      logProgress(`[${index + 1}/${selected.length}] start ${candidateId(item) || "unknown"}`);
      try {
        let finalResponse = null;
        let lastError = null;
        for (let attempt = 1; attempt <= maxProviderAttempts; attempt += 1) {
          const attemptStarted = Date.now();
          try {
            finalResponse = await callListingApi({
              baseUrl,
              cookie,
              item,
              providerMode,
              evalOptions,
              bypassSecret,
              requestTimeoutMs,
              verificationCache,
              maxTitleLength,
              fetchImpl
            });
            const data = finalResponse.data || {};
            if (!isProviderFailureResponse(finalResponse, data)) {
              lastError = null;
              break;
            }
            providerErrorAttempts.push(providerFailureAttempt({
              response: finalResponse,
              data,
              attempt,
              elapsedMs: Date.now() - attemptStarted
            }));
          } catch (error) {
            lastError = error;
            providerErrorAttempts.push(providerFailureAttempt({
              error,
              attempt,
              elapsedMs: Date.now() - attemptStarted
            }));
          }
          if (attempt < maxProviderAttempts) {
            await delay(Math.min(10_000, Math.max(0, Number(providerErrorRetryDelayMs) || 0) * attempt));
          }
        }
        if (lastError && (!finalResponse || isProviderFailureResponse(finalResponse, finalResponse.data || {}))) {
          throw lastError;
        }
        results[index] = evaluatedResultFromData({
          item,
          providerMode,
          response: finalResponse,
          referenceTitle,
          started,
          providerErrorAttempts,
          evalOptions
        });
        logProgress(`[${index + 1}/${selected.length}] done ${candidateId(item) || "unknown"} status=${results[index].technical_failure ? "technical_failure" : "ok"} recall=${results[index].corrected_title_comparison?.token_recall ?? "n/a"} elapsed_ms=${results[index].elapsed_ms}`);
      } catch (error) {
        if (!providerErrorAttempts.length) {
          providerErrorAttempts.push(providerFailureAttempt({
            error,
            attempt: 1,
            elapsedMs: Date.now() - started
          }));
        }
        results[index] = technicalFailureResult({
          item,
          providerMode,
          referenceTitle,
          started,
          error,
          providerErrorAttempts,
          evalOptions
        });
        logProgress(`[${index + 1}/${selected.length}] done ${candidateId(item) || "unknown"} status=technical_failure code=${results[index].technical_failure_code || "unknown"} elapsed_ms=${results[index].elapsed_ms}`);
      }
      await writeCheckpoint();
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  await checkpointWrite;
  return buildReport("completed");
}

export async function main(argv = process.argv, env = process.env) {
  const runtimeEnv = await runtimeEnvFromFiles(argv, env);
  const datasetPath = argValue(argv, "--dataset", runtimeEnv.SUPABASE_FEEDBACK_CANDIDATES_PATH || defaultDatasetPath);
  const outPath = argValue(argv, "--out", runtimeEnv.CLOUD_LISTING_API_EVAL_OUT || defaultOutPath);
  const baseUrl = argValue(argv, "--base-url", runtimeEnv.CLOUD_LISTING_API_BASE_URL || "");
  const provider = argValue(argv, "--provider", runtimeEnv.CLOUD_LISTING_API_PROVIDER || "openai_legacy");
  const limit = numberArg(argv, "--limit", Number(runtimeEnv.CLOUD_LISTING_API_EVAL_LIMIT || 1));
  const concurrency = numberArg(argv, "--concurrency", Number(runtimeEnv.CLOUD_LISTING_API_EVAL_CONCURRENCY || 1));
  const failOnProviderError = hasFlag(argv, "--fail-on-provider-error");
  const skipPreflight = hasFlag(argv, "--skip-cloud-preflight");
  const requestTimeoutMs = numberArg(argv, "--request-timeout-ms", Number(runtimeEnv.CLOUD_LISTING_API_REQUEST_TIMEOUT_MS || 240_000));
  const providerErrorRetries = numberArg(argv, "--provider-error-retries", Number(runtimeEnv.CLOUD_LISTING_API_PROVIDER_ERROR_RETRIES || 1));
  const providerErrorRetryDelayMs = numberArg(argv, "--provider-error-retry-delay-ms", Number(runtimeEnv.CLOUD_LISTING_API_PROVIDER_ERROR_RETRY_DELAY_MS || 1500));
  const correctedTitleAsTemporaryGt = !hasFlag(argv, "--no-corrected-title-as-temporary-gt")
    && boolValue(runtimeEnv.CORRECTED_TITLE_AS_TEMPORARY_GT ?? runtimeEnv.CLOUD_EVAL_CORRECTED_TITLE_AS_TEMPORARY_GT, true);
  const sendCorrectedTitleHintToCloud = hasFlag(argv, "--send-corrected-title-hint-to-cloud")
    || hasFlag(argv, "--legacy-corrected-title-hint")
    || boolValue(runtimeEnv.SEND_CORRECTED_TITLE_HINT_TO_CLOUD ?? runtimeEnv.CLOUD_EVAL_SEND_CORRECTED_TITLE_HINT_TO_CLOUD, false);
  const disableVectorLazyMode = hasFlag(argv, "--disable-vector-lazy-mode")
    || boolValue(runtimeEnv.CLOUD_EVAL_DISABLE_VECTOR_LAZY_MODE, false);
  const progress = hasFlag(argv, "--progress");
  const checkpointPath = argValue(argv, "--checkpoint-path", hasFlag(argv, "--checkpoint") ? outPath : "");
  const bypassSecret = argValue(argv, "--bypass-secret", runtimeEnv.VERCEL_AUTOMATION_BYPASS_SECRET || "");
  const fetchImpl = curlFetchForConnectToIp(runtimeEnv.CLOUD_LISTING_API_CONNECT_TO_IP || "");
  validateProtectionBypassSecret({ bypassSecret, env: runtimeEnv });
  const report = await evaluateCloudListingApi({
    dataset: await readJson(datasetPath),
    baseUrl: baseUrl.replace(/\/+$/, ""),
    provider,
    limit,
    concurrency,
    username: runtimeEnv.METAVERSE_USERNAME,
    password: runtimeEnv.METAVERSE_PASSWORD,
    bypassSecret,
    requestTimeoutMs,
    correctedTitleAsTemporaryGt,
    sendCorrectedTitleHintToCloud,
    disableVectorLazyMode,
    providerErrorRetries,
    providerErrorRetryDelayMs,
    skipPreflight,
    progress,
    checkpointPath,
    fetchImpl: fetchImpl || globalThis.fetch
  });
  if (outPath) await writeJson(outPath, report);
  process.stdout.write([
    `cloud listing api eval ${report.status}`,
    `base_url: ${report.base_url}`,
    `provider: ${report.provider}`,
    `attempted_count: ${report.attempted_count}`,
    `evaluated_count: ${report.evaluated_count}`,
    `provider_error_count: ${report.provider_error_count}`,
    `technical_failure_count: ${report.technical_failure_count}`,
    `provider_error_recovered_count: ${report.provider_error_recovered_count}`,
    `provider_error_retry_count: ${report.provider_error_retry_count}`,
    `provider_success_count: ${report.provider_success_count}`,
    `provider_success_rate: ${report.provider_success_rate}`,
    `fallback_count: ${report.fallback_count}`,
    `corrected_title_as_temporary_gt: ${report.accuracy_policy?.corrected_title_as_temporary_gt ?? "n/a"}`,
    `corrected_title_hint_sent_to_cloud: ${report.accuracy_policy?.corrected_title_hint_sent_to_cloud ?? "n/a"}`,
    `corrected_title_hint_sent_to_cloud_count: ${report.accuracy_policy?.corrected_title_hint_sent_to_cloud_count ?? "n/a"}`,
    `visual_vector_used_count: ${report.visual_vector_used_count ?? "n/a"}`,
    `visual_vector_candidate_count: ${report.visual_vector_candidate_count ?? "n/a"}`,
    `visual_vector_selected_count: ${report.visual_vector_selected_count ?? "n/a"}`,
    `visual_vector_consensus_field_count: ${report.visual_vector_consensus_field_count ?? "n/a"}`,
    `visual_vector_conflict_field_count: ${report.visual_vector_conflict_field_count ?? "n/a"}`,
    `postgres_hybrid_used_count: ${report.postgres_hybrid_used_count ?? "n/a"}`,
    `postgres_hybrid_candidate_count: ${report.postgres_hybrid_candidate_count ?? "n/a"}`,
    `catalog_lookup_used_count: ${report.catalog_lookup_used_count ?? "n/a"}`,
    `catalog_candidate_count: ${report.catalog_candidate_count ?? "n/a"}`,
    `catalog_candidate_available_rate: ${report.catalog_candidate_available_rate ?? "n/a"}`,
    `catalog_prompt_candidate_count: ${report.catalog_prompt_candidate_count ?? "n/a"}`,
    `catalog_prompt_assist_used_count: ${report.catalog_prompt_assist_used_count ?? "n/a"}`,
    `catalog_cache_hit_count: ${report.catalog_cache_hit_count ?? "n/a"}`,
    `catalog_cache_hit_rate: ${report.catalog_cache_hit_rate ?? "n/a"}`,
    `catalog_prompt_candidate_ids: ${(report.catalog_prompt_candidate_ids || []).join(",") || "n/a"}`,
    `catalog_candidate_selected_count: ${report.catalog_candidate_selected_count ?? "n/a"}`,
    `correct_catalog_identity_available_count: ${report.correct_catalog_identity_available_count ?? "n/a"}`,
    `correct_candidate_recall_at_1: ${report.correct_candidate_recall_at_1 ?? "n/a"}`,
    `correct_candidate_recall_at_3: ${report.correct_candidate_recall_at_3 ?? "n/a"}`,
    `correct_candidate_recall_at_5: ${report.correct_candidate_recall_at_5 ?? "n/a"}`,
    `gpt_selected_correct_candidate_count: ${report.gpt_selected_correct_candidate_count ?? "n/a"}`,
    `gpt_rejected_correct_candidate_count: ${report.gpt_rejected_correct_candidate_count ?? "n/a"}`,
    `candidate_selection_accuracy_rate: ${report.candidate_selection_accuracy?.rate ?? "n/a"}`,
    `catalog_recovery_count: ${report.catalog_recovery_count ?? "paired_baseline_required"}`,
    `catalog_regression_count: ${report.catalog_regression_count ?? "paired_baseline_required"}`,
    `catalog_net_benefit: ${report.catalog_net_benefit ?? "paired_baseline_required"}`,
    `candidate_identity_candidate_count: ${report.candidate_identity_candidate_count ?? "n/a"}`,
    `vector_assist_eligible_count: ${report.vector_assist_eligible_count ?? "n/a"}`,
    `vector_prompt_assist_used_count: ${report.vector_prompt_assist_used_count ?? "n/a"}`,
    `vector_raw_candidate_count: ${report.vector_raw_candidate_count ?? "n/a"}`,
    `vector_approved_candidate_count: ${report.vector_approved_candidate_count ?? "n/a"}`,
    `vector_conflict_blocked_count: ${report.vector_conflict_blocked_count ?? "n/a"}`,
    `vector_prompt_candidate_count: ${report.vector_prompt_candidate_count ?? "n/a"}`,
    `vector_prompt_candidate_ids: ${(report.vector_prompt_candidate_ids || []).join(",") || "n/a"}`,
    `vector_lazy_skip_count: ${report.vector_lazy_skip_count ?? "n/a"}`,
    `vector_lazy_skip_rate: ${report.vector_lazy_skip_rate ?? "n/a"}`,
    `open_set_status_counts: ${JSON.stringify(report.open_set_status_counts || {})}`,
    `known_catalog_candidate_available_count: ${report.known_catalog_candidate_available_count ?? "n/a"}`,
    `catalog_gap_queue_candidate_count: ${report.catalog_gap_queue_candidate_count ?? "n/a"}`,
    `fail_closed_candidate_count: ${report.fail_closed_candidate_count ?? "n/a"}`,
    `unknown_card_ready_count: ${report.unknown_card_ready_count ?? "n/a"}`,
    `retrieval_title_assist_used_count: ${report.retrieval_title_assist_used_count ?? "n/a"}`,
    `fast_path_used_count: ${report.fast_path_used_count ?? "n/a"}`,
    `card_type_default_base_count: ${report.card_type_default_base_count ?? "n/a"}`,
    `copied_serial_grade_cert_from_reference_count: ${report.copied_serial_grade_cert_from_reference_count ?? "n/a"}`,
    `visual_feature_count: ${report.visual_feature_count ?? "n/a"}`,
    `provider_truncation_retry_count: ${report.provider_truncation_retry_count ?? "n/a"}`,
    `raw_blind_token_recall_avg_proxy_not_identity_accuracy: ${report.raw_blind_output_accuracy?.corrected_title_token_recall_avg ?? "n/a"}`,
    `raw_blind_pass_at_0_72_count: ${report.raw_blind_output_accuracy?.pass_at_0_72_count ?? "n/a"}`,
    `raw_blind_pass_at_0_80_count: ${report.raw_blind_output_accuracy?.pass_at_0_80_count ?? "n/a"}`,
    `corrected_title_token_recall_avg_proxy_not_identity_accuracy: ${report.corrected_title_token_recall_avg}`,
    `oracle_candidate_upper_bound_pass_at_0_72_count: ${report.oracle_candidate_upper_bound?.pass_at_0_72_count ?? "n/a"}`,
    `oracle_candidate_upper_bound_pass_at_0_80_count: ${report.oracle_candidate_upper_bound?.pass_at_0_80_count ?? "n/a"}`,
    `pass_at_0_72_count: ${report.pass_at_0_72_count ?? "n/a"}`,
    `pass_at_0_72_rate: ${report.pass_at_0_72_rate ?? "n/a"}`,
    `pass_at_0_80_count: ${report.pass_at_0_80_count ?? "n/a"}`,
    `pass_at_0_80_rate: ${report.pass_at_0_80_rate ?? "n/a"}`,
    `attempted_cards_per_minute: ${report.attempted_cards_per_minute}`,
    `evaluated_cards_per_minute: ${report.evaluated_cards_per_minute}`,
    `per_card_latency_ms_p50: ${report.per_card_latency_ms?.p50 ?? "n/a"}`,
    `per_card_latency_ms_p95: ${report.per_card_latency_ms?.p95 ?? "n/a"}`,
    `input_tokens: ${report.usage_totals?.input_tokens ?? "n/a"}`,
    `output_tokens: ${report.usage_totals?.output_tokens ?? "n/a"}`,
    `total_tokens: ${report.usage_totals?.total_tokens ?? "n/a"}`,
    `raw_field_completeness_avg: ${report.breakpoint_completeness_avg?.raw_provider_fields ?? "n/a"}`,
    `normalized_evidence_completeness_avg: ${report.breakpoint_completeness_avg?.normalized_evidence ?? "n/a"}`,
    `resolved_field_completeness_avg: ${report.breakpoint_completeness_avg?.resolved_fields ?? "n/a"}`
  ].join("\n") + "\n");
  return failOnProviderError && report.provider_error_count > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`Cloud listing API eval failed: ${error.message}`);
    process.exit(1);
  }
}
