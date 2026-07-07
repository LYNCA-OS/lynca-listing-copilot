import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fairTokenRecall, policyFairTokenRecall } from "./evaluate-cloud-listing-api.mjs";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function numberArg(argv, name, fallback) {
  const value = Number(argValue(argv, name, ""));
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path, value) {
  const resolved = resolve(path);
  if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, String(value || ""));
}

function loadDatasetItems(dataset) {
  if (Array.isArray(dataset)) return dataset;
  return dataset.items || dataset.records || dataset.results || dataset.cards || [];
}

async function readDataset(path) {
  const dataset = JSON.parse(await readFile(resolve(path), "utf8"));
  return loadDatasetItems(dataset);
}

async function readSealedLabels(path) {
  const byCaseId = new Map();
  if (!path) return byCaseId;
  const text = await readFile(resolve(path), "utf8").catch(() => "");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.case_id) byCaseId.set(row.case_id, row);
    } catch {
      // Ignore bad sealed-label rows; smoke should still run.
    }
  }
  return byCaseId;
}

function candidateId(item = {}, index = 0) {
  return cleanText(item.asset_id || item.candidate_id || item.id || item.physical_card_id || `v4-ebay-smoke-${index + 1}`);
}

function itemImages(item = {}) {
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
      capture_angle: image.capture_angle || (index === 0 ? "front" : "back"),
      width: image.width || null,
      height: image.height || null
    }));
}

function verificationCacheKey(image = {}) {
  return `${image.bucket || ""}:${image.object_path || image.objectPath || ""}`;
}

async function verifyExistingImage({
  baseUrl,
  cookie,
  image,
  assetId,
  requestTimeoutMs,
  verificationCache,
  fetchImpl = globalThis.fetch
}) {
  const cacheKey = verificationCacheKey(image);
  if (verificationCache?.has(cacheKey)) return verificationCache.get(cacheKey);
  const response = await postJson({
    baseUrl,
    path: "/api/listing-image-verify-existing",
    cookie,
    payload: {
      object_path: image.object_path,
      bucket: image.bucket,
      image_id: image.image_id,
      asset_id: assetId,
      role: image.role
    },
    requestTimeoutMs,
    fetchImpl
  });
  const verification = response.data?.verification || {};
  if (!response.ok || response.data?.ok !== true || !verification.verification_token) {
    throw new Error(`image verification failed HTTP ${response.http_status}: ${cleanText(response.data?.message).slice(0, 180)}`);
  }
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

async function verifiedItemImages({
  item = {},
  index = 0,
  baseUrl,
  cookie,
  requestTimeoutMs,
  verificationCache
}) {
  const assetId = candidateId(item, index);
  const images = itemImages(item);
  const verified = [];
  for (const image of images) {
    verified.push(await verifyExistingImage({
      baseUrl,
      cookie,
      image,
      assetId,
      requestTimeoutMs,
      verificationCache
    }));
  }
  return verified;
}

function payloadForItem(item = {}, index = 0, images = itemImages(item)) {
  return {
    asset_id: candidateId(item, index),
    source_feedback_id: item.source_feedback_id || item.source_record_id || null,
    physical_card_id: item.physical_card_id || candidateId(item, index),
    category: item.category || "collectible_card",
    maxTitleLength: 80,
    captureProfileId: "v4_ebay_blind_smoke",
    provider: "openai_legacy",
    provider_id: "openai_legacy",
    vision_provider: "openai_legacy",
    provider_options: {
      enable_catalog_assist: true,
      enable_vector_retrieval: true,
      vector_retrieval_mode: "assist",
      enable_v4_progressive_l1: true,
      cloud_eval_blind_to_corrected_title_hint: true,
      corrected_title_as_temporary_gt: false,
      send_corrected_title_hint_to_cloud: false
    },
    images
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

async function login({ baseUrl, username, password, fetchImpl = globalThis.fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`login failed HTTP ${response.status}: ${JSON.stringify(payload || {}).slice(0, 200)}`);
  }
  const cookie = cleanText(response.headers.get("set-cookie")).split(";")[0];
  if (!cookie) throw new Error("login did not return a session cookie");
  return cookie;
}

async function postJson({ baseUrl, path, cookie, payload, requestTimeoutMs, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request_timeout")), requestTimeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await readJsonResponse(response);
    return {
      ok: response.ok,
      http_status: response.status,
      latency_ms: Date.now() - started,
      data
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson({ baseUrl, path, cookie, requestTimeoutMs, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request_timeout")), requestTimeoutMs);
  const started = Date.now();
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: { cookie },
      signal: controller.signal
    });
    const data = await readJsonResponse(response);
    return {
      ok: response.ok,
      http_status: response.status,
      latency_ms: Date.now() - started,
      data
    };
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, Number(ms) || 0)));
}

function sessionL2Summary(statusPayload = {}) {
  const session = statusPayload.session || {};
  const summary = session.provider_result_summary || {};
  return {
    session_status: session.status || null,
    assisted_draft_status: summary.assisted_draft_status || null,
    title: session.final_title || summary.final_title || null,
    route: session.route || null,
    prompt_candidate_count: Number(session.candidate_control_plane_trace?.catalog_activation_funnel?.prompt_candidate_count || 0)
      + Number(session.candidate_control_plane_trace?.vector_activation_funnel?.prompt_candidate_count || 0),
    catalog_prompt_candidate_count: Number(session.candidate_control_plane_trace?.catalog_activation_funnel?.prompt_candidate_count || 0),
    vector_prompt_candidate_count: Number(session.candidate_control_plane_trace?.vector_activation_funnel?.prompt_candidate_count || 0),
    related_counts: statusPayload.related_counts || {}
  };
}

async function pollSessionStatus({
  baseUrl,
  cookie,
  sessionId,
  waitMs = 18000,
  intervalMs = 1500,
  requestTimeoutMs = 30000
}) {
  if (!sessionId) return { polls: 0, ready: false, summary: null, last: null };
  const started = Date.now();
  let polls = 0;
  let last = null;
  while (Date.now() - started <= waitMs) {
    polls += 1;
    last = await getJson({
      baseUrl,
      path: `/api/v4/listing-session-status?recognition_session_id=${encodeURIComponent(sessionId)}`,
      cookie,
      requestTimeoutMs
    });
    const summary = sessionL2Summary(last.data || {});
    if (summary.assisted_draft_status === "READY") {
      return { polls, ready: true, summary, last };
    }
    if (summary.assisted_draft_status === "FAILED" || summary.assisted_draft_status === "TIMEOUT") {
      return { polls, ready: false, summary, last };
    }
    if (!summary.assisted_draft_status && summary.session_status === "DRAFT_READY") {
      return { polls, ready: false, summary, last };
    }
    await delay(intervalMs);
  }
  return { polls, ready: false, summary: sessionL2Summary(last?.data || {}), last };
}

function titleTokens(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function rawTokenRecall(referenceTitle = "", predictionTitle = "") {
  const reference = new Set(titleTokens(referenceTitle));
  if (!reference.size) return null;
  const predicted = new Set(titleTokens(predictionTitle));
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return Number((overlap / reference.size).toFixed(6));
}

function serialMatches(value = "") {
  return [...String(value || "").matchAll(/(?<![\d.])0*(\d+)\s*\/\s*(\d+)\b/g)].map((match) => ({
    exact: `${Number(match[1])}/${Number(match[2])}`,
    denominator: String(Number(match[2]))
  }));
}

function serialTitleAnalysis(referenceTitle = "", predictionTitle = "") {
  const reference = serialMatches(referenceTitle);
  const prediction = serialMatches(predictionTitle);
  const exactSet = new Set(prediction.map((item) => item.exact));
  const denominatorSet = new Set(prediction.map((item) => item.denominator));
  for (const match of String(predictionTitle || "").matchAll(/(?:^|\s)#?\/\s*0*(\d+)\b/g)) {
    denominatorSet.add(String(Number(match[1])));
  }
  const details = reference.map((serial) => {
    const exact = exactSet.has(serial.exact);
    const denominator = denominatorSet.has(serial.denominator);
    return {
      reference_serial: serial.exact,
      numerical_rarity: `/${serial.denominator}`,
      exact_match: exact,
      denominator_match: denominator,
      numerator_omitted: !exact && denominator,
      missing: !exact && !denominator
    };
  });
  return {
    reference_serial_count: reference.length,
    prediction_serial_count: prediction.length,
    exact_match_count: details.filter((item) => item.exact_match).length,
    denominator_match_count: details.filter((item) => item.denominator_match).length,
    numerator_omission_count: details.filter((item) => item.numerator_omitted).length,
    missing_count: details.filter((item) => item.missing).length,
    details
  };
}

function scoreTitles(referenceTitle = "", predictionTitle = "") {
  return {
    raw_token_recall: rawTokenRecall(referenceTitle, predictionTitle),
    fair_token_recall: fairTokenRecall(referenceTitle, predictionTitle),
    policy_fair_token_recall: policyFairTokenRecall(referenceTitle, predictionTitle),
    serial_number_title_analysis: serialTitleAnalysis(referenceTitle, predictionTitle)
  };
}

function quantile(values, q) {
  const clean = values.filter((value) => Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(clean.length * q) - 1));
  return clean[index];
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!clean.length) return null;
  return Number((clean.reduce((sum, value) => sum + value, 0) / clean.length).toFixed(6));
}

function countPass(values, threshold) {
  return values.filter((value) => Number.isFinite(Number(value)) && Number(value) >= threshold).length;
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function resultTitle(response = {}) {
  return cleanText(response.final_title || response.writer_safe_draft || response.title || "");
}

function cacheStatusFromResponse(data = {}) {
  return {
    cache_hit: data.fast_scout_cache_hit === true || data.provider_result?.fast_scout?.cache_hit === true,
    cache_status: data.fast_scout_cache_status || (data.provider_result?.fast_scout?.cache_hit ? "HIT" : null),
    prewarmer_used: data.fast_scout_prewarmer_used === true,
    blocking_call_used: data.fast_scout_blocking_call_used !== false
  };
}

async function runOne({
  item,
  index,
  sealedLabels,
  baseUrl,
  cookie,
  prewarm,
  l2WaitMs,
  requestTimeoutMs
}) {
  const id = candidateId(item, index);
  const verificationCache = runOne.verificationCache || new Map();
  runOne.verificationCache = verificationCache;
  const images = await verifiedItemImages({
    item,
    index,
    baseUrl,
    cookie,
    requestTimeoutMs: Math.min(requestTimeoutMs, 45000),
    verificationCache
  });
  const payload = payloadForItem(item, index, images);
  const sealedKey = item.sealed_eval_label_ref?.key || "";
  const sealed = sealedLabels.get(id.replace(/^ebay_image_only_/, "")) || sealedLabels.get(item.source_record?.case_id) || null;
  const fallbackSealed = [...sealedLabels.values()].find((row) => row.key === sealedKey) || null;
  const label = sealed || fallbackSealed || {};
  const sellerTitle = cleanText(label.title || item.corrected_title || item.canonical_title || "");
  let prewarmResult = null;
  if (prewarm) {
    prewarmResult = await postJson({
      baseUrl,
      path: "/api/v4/fast-scout-prewarm",
      cookie,
      payload,
      requestTimeoutMs
    });
  }

  const l1 = await postJson({
    baseUrl,
    path: "/api/v4/listing-copilot-title",
    cookie,
    payload,
    requestTimeoutMs
  });
  const data = l1.data || {};
  const sessionId = data.recognition_session_id || null;
  const l2 = await pollSessionStatus({
    baseUrl,
    cookie,
    sessionId,
    waitMs: l2WaitMs,
    requestTimeoutMs: Math.min(requestTimeoutMs, 45000)
  });
  const l1Title = resultTitle(data);
  const l2Title = cleanText(l2.summary?.title || "");
  const finalTitle = l2Title || l1Title;
  const l1Score = scoreTitles(sellerTitle, l1Title);
  const finalScore = scoreTitles(sellerTitle, finalTitle);
  const fastScout = data.provider_result?.fast_scout || {};
  const cache = cacheStatusFromResponse(data);
  return compactObject({
    asset_id: id,
    sealed_label_key: sealedKey || label.key || null,
    seller_title_visible_to_model: false,
    seller_title_used_for_local_eval_only: Boolean(sellerTitle),
    seller_title: sellerTitle,
    image_count: payload.images.length,
    http_status: l1.http_status,
    ok: Boolean(l1.ok && data.ok),
    error: l1.ok ? null : data,
    l1_wall_latency_ms: l1.latency_ms,
    l1_time_to_safe_draft_ms: cache.cache_hit
      ? l1.latency_ms
      : (data.module_speed_metrics?.time_to_l1_safe_draft_ms || l1.latency_ms),
    cached_fast_scout_source_latency_ms: fastScout.latency_ms ?? data.provider_result?.timing?.fast_scout_latency_ms ?? null,
    route: data.route_plan?.route || null,
    title_stage: data.title_stage || null,
    recognition_session_id: sessionId,
    l1_title: l1Title,
    l2_ready: Boolean(l2.ready),
    l2_poll_count: l2.polls,
    l2_status: l2.summary,
    final_title: finalTitle,
    l1_return_reason: data.l1_return_reason || null,
    l1_return_barrier_version: data.l1_return_barrier_version || null,
    l1_blocking_modules: data.l1_blocking_modules || data.blocking_modules || [],
    l1_deferred_modules: data.l1_deferred_modules || data.background_modules || [],
    deferred_persistence_status: data.deferred_persistence_status || null,
    l2_background_status: data.l2_background_status || null,
    time_after_l1_spent_on_persistence_ms: data.time_after_l1_spent_on_persistence_ms ?? null,
    fast_scout_cache_hit: cache.cache_hit,
    fast_scout_cache_status: cache.cache_status,
    fast_scout_prewarmer_used: cache.prewarmer_used,
    fast_scout_blocking_call_used: cache.blocking_call_used,
    fast_scout_input_image_count: fastScout.input_image_count || null,
    fast_scout_input_roles: (fastScout.input_images || []).map((image) => image.role).filter(Boolean),
    prewarm_status: prewarmResult?.data?.prewarm_status || null,
    prewarm_latency_ms: prewarmResult?.latency_ms || null,
    prewarm_cache_hit: prewarmResult?.data?.fast_scout_cache_hit ?? null,
    prewarm_cache_status: prewarmResult?.data?.fast_scout_cache_status || null,
    catalog_prompt_candidate_count: Number(data.catalog_activation_funnel?.prompt_candidate_count || 0),
    vector_prompt_candidate_count: Number(data.vector_activation_funnel?.prompt_candidate_count || 0),
    provider_prompt_candidate_count: Number(data.provider_result?.prompt_candidate_count || 0),
    l2_catalog_prompt_candidate_count: l2.summary?.catalog_prompt_candidate_count ?? null,
    l2_vector_prompt_candidate_count: l2.summary?.vector_prompt_candidate_count ?? null,
    l1_scoring: l1Score,
    final_scoring: finalScore,
    item_web_url: label.item_web_url || null
  });
}

function summarize(results = []) {
  const l1Raw = results.map((item) => item.l1_scoring?.raw_token_recall);
  const l1Fair = results.map((item) => item.l1_scoring?.fair_token_recall);
  const l1Policy = results.map((item) => item.l1_scoring?.policy_fair_token_recall);
  const finalRaw = results.map((item) => item.final_scoring?.raw_token_recall);
  const finalFair = results.map((item) => item.final_scoring?.fair_token_recall);
  const finalPolicy = results.map((item) => item.final_scoring?.policy_fair_token_recall);
  return {
    attempted_count: results.length,
    ok_count: results.filter((item) => item.ok).length,
    l2_ready_count: results.filter((item) => item.l2_ready).length,
    fast_scout_cache_hit_count: results.filter((item) => item.fast_scout_cache_hit).length,
    fast_scout_blocking_call_count: results.filter((item) => item.fast_scout_blocking_call_used).length,
    prewarm_cache_hit_count: results.filter((item) => item.prewarm_cache_hit === true).length,
    l1_p50_ms: quantile(results.map((item) => item.l1_wall_latency_ms), 0.5),
    l1_p95_ms: quantile(results.map((item) => item.l1_wall_latency_ms), 0.95),
    l1_safe_draft_p50_ms: quantile(results.map((item) => item.l1_time_to_safe_draft_ms), 0.5),
    l1_safe_draft_p95_ms: quantile(results.map((item) => item.l1_time_to_safe_draft_ms), 0.95),
    prewarm_p50_ms: quantile(results.map((item) => item.prewarm_latency_ms), 0.5),
    prewarm_p95_ms: quantile(results.map((item) => item.prewarm_latency_ms), 0.95),
    catalog_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.catalog_prompt_candidate_count || 0), 0),
    vector_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.vector_prompt_candidate_count || 0), 0),
    l2_catalog_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_catalog_prompt_candidate_count || 0), 0),
    l2_vector_prompt_candidate_count: results.reduce((sum, item) => sum + Number(item.l2_vector_prompt_candidate_count || 0), 0),
    l1_accuracy_proxy: {
      raw_token_recall_avg: average(l1Raw),
      fair_token_recall_avg: average(l1Fair),
      policy_fair_token_recall_avg: average(l1Policy),
      raw_pass_at_0_72: countPass(l1Raw, 0.72),
      fair_pass_at_0_72: countPass(l1Fair, 0.72),
      policy_fair_pass_at_0_72: countPass(l1Policy, 0.72),
      policy_fair_pass_at_0_80: countPass(l1Policy, 0.8)
    },
    final_accuracy_proxy: {
      raw_token_recall_avg: average(finalRaw),
      fair_token_recall_avg: average(finalFair),
      policy_fair_token_recall_avg: average(finalPolicy),
      raw_pass_at_0_72: countPass(finalRaw, 0.72),
      fair_pass_at_0_72: countPass(finalFair, 0.72),
      policy_fair_pass_at_0_72: countPass(finalPolicy, 0.72),
      policy_fair_pass_at_0_80: countPass(finalPolicy, 0.8)
    },
    serial_title_analysis: {
      reference_serial_cards: results.filter((item) => item.final_scoring?.serial_number_title_analysis?.reference_serial_count > 0).length,
      exact_match_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.exact_match_count || 0), 0),
      denominator_match_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.denominator_match_count || 0), 0),
      numerator_omission_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.numerator_omission_count || 0), 0),
      missing_count: results.reduce((sum, item) => sum + Number(item.final_scoring?.serial_number_title_analysis?.missing_count || 0), 0)
    }
  };
}

function tsvEscape(value) {
  return String(value ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function perCardTsv(results = []) {
  const columns = [
    "asset_id",
    "ok",
    "l1_ms",
    "l1_safe_ms",
    "cache",
    "l2_ready",
    "l1_policy_fair",
    "final_policy_fair",
    "catalog_prompt",
    "vector_prompt",
    "l1_title",
    "final_title",
    "seller_title"
  ];
  const rows = results.map((item) => [
    item.asset_id,
    item.ok,
    item.l1_wall_latency_ms,
    item.l1_time_to_safe_draft_ms,
    item.fast_scout_cache_status,
    item.l2_ready,
    item.l1_scoring?.policy_fair_token_recall,
    item.final_scoring?.policy_fair_token_recall,
    item.catalog_prompt_candidate_count,
    item.vector_prompt_candidate_count,
    item.l1_title,
    item.final_title,
    item.seller_title
  ].map(tsvEscape).join("\t"));
  return `${columns.join("\t")}\n${rows.join("\n")}\n`;
}

export async function runV4EbaySmoke({
  datasetPath,
  sealedLabelsPath,
  baseUrl,
  username,
  password,
  limit = 10,
  offset = 0,
  prewarm = false,
  l2WaitMs = 18000,
  requestTimeoutMs = 90000,
  outPath = "",
  progress = true
} = {}) {
  if (!datasetPath) throw new Error("--dataset is required");
  if (!baseUrl) throw new Error("--base-url is required");
  if (!username || !password) throw new Error("--username and --password are required");
  const items = (await readDataset(datasetPath)).slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit));
  if (!items.length) throw new Error("dataset slice has no items");
  const sealedLabels = await readSealedLabels(sealedLabelsPath);
  const cookie = await login({ baseUrl, username, password });
  const results = [];
  for (const [localIndex, item] of items.entries()) {
    const index = offset + localIndex;
    if (progress) process.stderr.write(`v4 ebay smoke ${localIndex + 1}/${items.length} asset=${candidateId(item, index)} prewarm=${prewarm}\n`);
    const row = await runOne({
      item,
      index,
      sealedLabels,
      baseUrl,
      cookie,
      prewarm,
      l2WaitMs,
      requestTimeoutMs
    });
    results.push(row);
    if (progress) {
      process.stderr.write(`  ok=${row.ok} l1=${row.l1_wall_latency_ms}ms cache=${row.fast_scout_cache_status || "n/a"} final_policy=${row.final_scoring?.policy_fair_token_recall ?? "n/a"} title=${row.final_title}\n`);
    }
  }
  const report = {
    schema_version: "v4-ebay-smoke-v1",
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    dataset_path: datasetPath,
    sealed_labels_path: sealedLabelsPath || null,
    limit,
    offset,
    prewarm_enabled: prewarm,
    blind_policy: {
      seller_title_visible_to_model: false,
      seller_title_used_for_local_eval_only: true,
      seller_title_is_ground_truth: false
    },
    summary: summarize(results),
    results
  };
  if (outPath) {
    await writeJson(outPath, report);
    await writeText(outPath.replace(/\.json$/i, ".tsv"), perCardTsv(results));
  }
  return report;
}

export async function main(argv = process.argv, env = process.env) {
  const stamp = nowStamp();
  const outPath = argValue(argv, "--out", `data/eval/workflow-sidecar-smoke/v4-ebay-smoke-${stamp}.json`);
  const report = await runV4EbaySmoke({
    datasetPath: argValue(argv, "--dataset", env.V4_EBAY_SMOKE_DATASET || "data/eval/ebay-reference/ebay-c100-cloud-eval-dataset-20260707.json"),
    sealedLabelsPath: argValue(argv, "--sealed-labels", env.V4_EBAY_SMOKE_SEALED_LABELS || "data/eval/ebay-reference/ebay-c100-sealed-labels-20260707.jsonl"),
    baseUrl: cleanText(argValue(argv, "--base-url", env.V4_EBAY_SMOKE_BASE_URL || env.API_BASE_URL || "https://listing.lyncafei.team")).replace(/\/+$/, ""),
    username: cleanText(argValue(argv, "--username", env.METAVERSE_USERNAME || "metaverse")),
    password: cleanText(argValue(argv, "--password", env.METAVERSE_PASSWORD || "mtv")),
    limit: Math.max(1, Math.trunc(numberArg(argv, "--limit", 10))),
    offset: Math.max(0, Math.trunc(numberArg(argv, "--offset", 0))),
    prewarm: hasFlag(argv, "--prewarm"),
    l2WaitMs: Math.max(0, Math.trunc(numberArg(argv, "--l2-wait-ms", 18000))),
    requestTimeoutMs: Math.max(10000, Math.trunc(numberArg(argv, "--request-timeout-ms", 90000))),
    outPath,
    progress: !hasFlag(argv, "--quiet")
  });
  process.stdout.write([
    `v4 ebay smoke completed`,
    `report_json: ${resolve(outPath)}`,
    `report_tsv: ${resolve(outPath.replace(/\.json$/i, ".tsv"))}`,
    `attempted: ${report.summary.attempted_count}`,
    `ok: ${report.summary.ok_count}`,
    `l2_ready: ${report.summary.l2_ready_count}`,
    `l1_p50_ms: ${report.summary.l1_p50_ms}`,
    `l1_p95_ms: ${report.summary.l1_p95_ms}`,
    `fast_scout_cache_hit_count: ${report.summary.fast_scout_cache_hit_count}`,
    `final_policy_fair_avg: ${report.summary.final_accuracy_proxy.policy_fair_token_recall_avg}`,
    `final_policy_fair_pass@0.72: ${report.summary.final_accuracy_proxy.policy_fair_pass_at_0_72}/${report.summary.attempted_count}`,
    `final_policy_fair_pass@0.80: ${report.summary.final_accuracy_proxy.policy_fair_pass_at_0_80}/${report.summary.attempted_count}`
  ].join("\n") + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`v4 ebay smoke failed: ${error.message}`);
    process.exit(1);
  });
}
