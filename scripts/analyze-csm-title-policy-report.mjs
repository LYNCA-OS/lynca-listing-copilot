import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleWithSerialNumeratorRemoved(title = "") {
  return normalizeText(title)
    .replace(/#?\b0*(\d{1,6})\s*(?:\/|of)\s*0*(\d{1,6})\b/gi, (_, numerator, denominator) => {
      const numeratorValue = Number(numerator);
      const denominatorValue = Number(denominator);
      if (denominatorValue === 1 && numeratorValue === 1) return "1/1";
      return `#/${denominatorValue}`;
    })
    .replace(/#\/0*(\d{1,6})\b/g, (_, denominator) => `#/${Number(denominator)}`)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForTokens(title = "") {
  return titleWithSerialNumeratorRemoved(title)
    .replace(/\bAutographs?\b/gi, "Auto")
    .replace(/\bAutos\b/gi, "Auto")
    .replace(/\bRookie\s+Card\b/gi, "RC")
    .replace(/\bRookie\b/gi, "RC")
    .replace(/\bOne\s+of\s+One\b/gi, "1/1")
    .replace(/#(?!\/)[A-Z0-9-]+\b/gi, " ")
    .replace(/\b(?:card|cards|the|and|with|seller|dcsports87|sports)\b/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9/#'.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const opticalExactTokens = new Set([
  "refractor",
  "shimmer",
  "wave",
  "mojo",
  "atomic",
  "sapphire",
  "breakaway",
  "choice",
  "holo",
  "hologold",
  "nebula",
  "fotl"
]);

function csmV1CoreTokens(title = "") {
  const tokens = normalizeForTokens(title).split(/\s+/).filter(Boolean);
  return [...new Set(tokens.filter((token) => {
    if (opticalExactTokens.has(token)) return false;
    if (/^#?[a-z]{1,5}-[a-z0-9-]+$/i.test(token)) return false;
    if (/^\d{1,4}$/.test(token) && !/^19|20/.test(token)) return false;
    return true;
  }))];
}

function tokenRecall(referenceTitle = "", predictionTitle = "") {
  const reference = csmV1CoreTokens(referenceTitle);
  if (!reference.length) return null;
  const prediction = new Set(csmV1CoreTokens(predictionTitle));
  const matched = reference.filter((token) => prediction.has(token));
  return {
    recall: Number((matched.length / reference.length).toFixed(6)),
    matched,
    missing: reference.filter((token) => !prediction.has(token)),
    reference_count: reference.length,
    prediction_count: prediction.size
  };
}

function extractYears(title = "") {
  return [...normalizeText(title).matchAll(/\b(19\d{2}|20\d{2})(?:-(\d{2}))?\b/g)].map((match) => match[0]);
}

function yearsCompatible(referenceYear = "", predictionYear = "") {
  if (!referenceYear || !predictionYear) return true;
  if (referenceYear === predictionYear) return true;
  if (referenceYear.includes("-") && referenceYear.startsWith(predictionYear)) return true;
  if (predictionYear.includes("-") && predictionYear.startsWith(referenceYear)) return true;
  return false;
}

function serialDenominators(title = "") {
  return [...normalizeText(title).matchAll(/(?:#?\b\d{1,6}\s*(?:\/|of)\s*|#\/)\s*0*(\d{1,6})\b/gi)]
    .map((match) => String(Number(match[1])))
    .filter(Boolean);
}

function gradeTokens(title = "") {
  return [...normalizeText(title).matchAll(/\b(PSA|BGS|SGC|CGC|TAG)\s*(?:GEM\s*MINT\s*)?(AUTH|\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/gi)]
    .map((match) => [match[1].toUpperCase(), match[2], match[3]].filter(Boolean).join(" "));
}

function productFamilyTokens(title = "") {
  const text = normalizeForTokens(title);
  return [
    "topps",
    "bowman",
    "panini",
    "upper",
    "deck",
    "chrome",
    "prizm",
    "mosaic",
    "flawless",
    "encased",
    "immaculate",
    "national",
    "treasures",
    "eminence",
    "status",
    "select"
  ].filter((token) => new RegExp(`\\b${token}\\b`, "i").test(text));
}

function highRiskMismatchProxy(referenceTitle = "", predictionTitle = "") {
  const mismatches = [];
  const referenceYears = extractYears(referenceTitle);
  const predictionYears = extractYears(predictionTitle);
  if (referenceYears.length && predictionYears.length && !yearsCompatible(referenceYears[0], predictionYears[0])) {
    mismatches.push({ field: "year", reference: referenceYears[0], prediction: predictionYears[0] });
  }

  const referenceDenoms = serialDenominators(referenceTitle);
  const predictionDenoms = serialDenominators(predictionTitle);
  if (referenceDenoms.length && predictionDenoms.length && referenceDenoms[0] !== predictionDenoms[0]) {
    mismatches.push({ field: "serial_denominator", reference: referenceDenoms[0], prediction: predictionDenoms[0] });
  }

  const referenceGrades = gradeTokens(referenceTitle);
  const predictionGrades = gradeTokens(predictionTitle);
  if (referenceGrades.length && predictionGrades.length && referenceGrades[0] !== predictionGrades[0]) {
    mismatches.push({ field: "grade", reference: referenceGrades[0], prediction: predictionGrades[0] });
  }

  const referenceProducts = productFamilyTokens(referenceTitle);
  const predictionProducts = productFamilyTokens(predictionTitle);
  if (referenceProducts.length && predictionProducts.length) {
    const overlap = referenceProducts.filter((token) => predictionProducts.includes(token));
    if (!overlap.length) {
      mismatches.push({ field: "product_family", reference: referenceProducts, prediction: predictionProducts });
    }
  }
  return mismatches;
}

function fullSerialNumeratorPolicyViolation(title = "") {
  return /\b(?!1\s*\/\s*1\b)0*\d{1,6}\s*(?:\/|of)\s*0*(\d{1,6})\b/i.test(normalizeText(title));
}

function avg(values = []) {
  const finite = values.filter((value) => Number.isFinite(Number(value)));
  return finite.length ? Number((finite.reduce((sum, value) => sum + Number(value), 0) / finite.length).toFixed(6)) : null;
}

function percentile(values = [], p = 0.5) {
  const finite = values.filter((value) => Number.isFinite(Number(value))).sort((left, right) => left - right);
  if (!finite.length) return null;
  const index = Math.min(finite.length - 1, Math.max(0, Math.ceil(finite.length * p) - 1));
  return Math.round(finite[index]);
}

async function main() {
  const input = argValue(process.argv, "--input");
  const outJson = argValue(process.argv, "--out-json");
  const outMd = argValue(process.argv, "--out-md");
  if (!input || !outJson) {
    throw new Error("Usage: node scripts/analyze-csm-title-policy-report.mjs --input <cloud-report.json> --out-json <summary.json> [--out-md <summary.md>]");
  }
  const report = JSON.parse(await readFile(input, "utf8"));
  const rows = (report.results || []).map((item, index) => {
    const modelTitle = normalizeText(item.final_evaluated_title || item.title);
    const referenceTitle = normalizeText(item.corrected_title_reference);
    const serialPolicyTitlePreview = titleWithSerialNumeratorRemoved(modelTitle);
    const weak = tokenRecall(referenceTitle, serialPolicyTitlePreview);
    const mismatches = highRiskMismatchProxy(referenceTitle, serialPolicyTitlePreview);
    return {
      index: index + 1,
      candidate_id: item.candidate_id,
      reference_label_type: item.reference_title_label_type || "marketplace_weak_label",
      model_title_as_run: modelTitle,
      serial_policy_title_preview: serialPolicyTitlePreview,
      weak_marketplace_title: referenceTitle,
      csm_v1_core_recall: weak?.recall ?? null,
      csm_v1_pass_at_0_72: Number(weak?.recall ?? 0) >= 0.72,
      csm_v1_pass_at_0_80: Number(weak?.recall ?? 0) >= 0.80,
      missing_core_terms: weak?.missing || [],
      high_risk_mismatch_proxy: mismatches,
      serial_numerator_policy_violation_as_run: fullSerialNumeratorPolicyViolation(modelTitle),
      serial_numerator_policy_violation_after_preview: fullSerialNumeratorPolicyViolation(serialPolicyTitlePreview),
      title_length_after_preview: serialPolicyTitlePreview.length,
      open_set_status: item.open_set_status,
      catalog_prompt_candidate_count: item.catalog_prompt_candidate_count,
      vector_prompt_candidate_count: item.vector_prompt_candidate_count,
      catalog_gap_queue_candidate: item.catalog_gap_queue_candidate === true,
      fail_closed_candidate: item.fail_closed_candidate === true,
      elapsed_ms: item.elapsed_ms,
      input_tokens: item.usage?.input_tokens ?? null,
      output_tokens: item.usage?.output_tokens ?? null,
      total_tokens: item.usage?.total_tokens ?? null
    };
  });
  const summary = {
    source_report: input,
    generated_at: new Date().toISOString(),
    policy: {
      reference_title_role: "marketplace_weak_label_diagnostic_only",
      strict_gt_available: false,
      serial_numerator_scoring: "ignored",
      exact_optical_parallel_scoring: "not_required_in_v1_core_recall",
      final_title_standard: "LYNCA CSM Standard Card Grammar"
    },
    attempted_count: rows.length,
    provider_success_count: report.provider_success_count,
    provider_error_recovered_count: report.provider_error_recovered_count,
    technical_failure_count: report.technical_failure_count,
    raw_marketplace_title_token_recall_avg: report.corrected_title_token_recall_avg,
    numerical_rarity_token_recall_avg_as_reported: report.numerical_rarity_title_token_recall_avg,
    csm_v1_core_recall_avg_after_serial_policy: avg(rows.map((row) => row.csm_v1_core_recall)),
    csm_v1_pass_at_0_72_count: rows.filter((row) => row.csm_v1_pass_at_0_72).length,
    csm_v1_pass_at_0_80_count: rows.filter((row) => row.csm_v1_pass_at_0_80).length,
    high_risk_mismatch_proxy_count: rows.filter((row) => row.high_risk_mismatch_proxy.length > 0).length,
    serial_numerator_policy_violation_as_run_count: rows.filter((row) => row.serial_numerator_policy_violation_as_run).length,
    serial_numerator_policy_violation_after_preview_count: rows.filter((row) => row.serial_numerator_policy_violation_after_preview).length,
    catalog_gap_queue_candidate_count: rows.filter((row) => row.catalog_gap_queue_candidate).length,
    fail_closed_candidate_count: rows.filter((row) => row.fail_closed_candidate).length,
    catalog_prompt_candidate_count: rows.reduce((sum, row) => sum + Number(row.catalog_prompt_candidate_count || 0), 0),
    vector_prompt_candidate_count: rows.reduce((sum, row) => sum + Number(row.vector_prompt_candidate_count || 0), 0),
    server_timing_p50_latency_ms: report.per_card_latency_ms?.p50 ?? null,
    server_timing_p95_latency_ms: report.per_card_latency_ms?.p95 ?? null,
    wall_clock_p50_latency_ms: percentile(rows.map((row) => row.elapsed_ms), 0.5),
    wall_clock_p95_latency_ms: percentile(rows.map((row) => row.elapsed_ms), 0.95),
    token_totals: report.usage_totals || {
      input_tokens: report.input_tokens,
      output_tokens: report.output_tokens,
      total_tokens: report.total_tokens
    }
  };
  const output = { summary, rows };
  await mkdir(dirname(outJson), { recursive: true });
  await writeFile(outJson, `${JSON.stringify(output, null, 2)}\n`);
  if (outMd) {
    await mkdir(dirname(outMd), { recursive: true });
    const lines = [
      "# eBay C10 CSM Title Policy Smoke",
      "",
      "This is a weak-label diagnostic report. Marketplace seller titles are not reviewed ground truth.",
      "",
      "## Summary",
      "",
      `- Provider success: ${summary.provider_success_count}/${summary.attempted_count}`,
      `- Technical failures: ${summary.technical_failure_count}`,
      `- Raw marketplace title token recall avg: ${summary.raw_marketplace_title_token_recall_avg}`,
      `- CSM v1 core recall avg after serial policy: ${summary.csm_v1_core_recall_avg_after_serial_policy}`,
      `- CSM v1 pass@0.72: ${summary.csm_v1_pass_at_0_72_count}/${summary.attempted_count}`,
      `- CSM v1 pass@0.80: ${summary.csm_v1_pass_at_0_80_count}/${summary.attempted_count}`,
      `- High-risk mismatch proxy: ${summary.high_risk_mismatch_proxy_count}/${summary.attempted_count}`,
      `- Serial numerator policy violations as run: ${summary.serial_numerator_policy_violation_as_run_count}/${summary.attempted_count}`,
      `- Serial numerator policy violations after preview: ${summary.serial_numerator_policy_violation_after_preview_count}/${summary.attempted_count}`,
      `- Catalog gaps: ${summary.catalog_gap_queue_candidate_count}/${summary.attempted_count}`,
      `- Catalog prompt candidates: ${summary.catalog_prompt_candidate_count}`,
      `- Vector prompt candidates: ${summary.vector_prompt_candidate_count}`,
      `- Server timing p50 / p95 latency ms: ${summary.server_timing_p50_latency_ms} / ${summary.server_timing_p95_latency_ms}`,
      `- Wall-clock p50 / p95 latency ms: ${summary.wall_clock_p50_latency_ms} / ${summary.wall_clock_p95_latency_ms}`,
      "",
      "## Per Card",
      "",
      "| # | CSM recall | Risk proxy | Catalog/Vector prompt | Title preview | Weak marketplace title |",
      "|---|---:|---|---|---|---|",
      ...rows.map((row) => `| ${row.index} | ${row.csm_v1_core_recall ?? ""} | ${row.high_risk_mismatch_proxy.map((risk) => risk.field).join(", ") || "-"} | ${row.catalog_prompt_candidate_count}/${row.vector_prompt_candidate_count} | ${row.serial_policy_title_preview.replace(/\|/g, "/")} | ${row.weak_marketplace_title.replace(/\|/g, "/")} |`)
    ];
    await writeFile(outMd, `${lines.join("\n")}\n`);
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
