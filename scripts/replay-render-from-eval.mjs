import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderListingPresentation } from "../lib/listing/renderer/listing-renderer.mjs";
import { fairTokenRecall } from "./evaluate-cloud-listing-api.mjs";

// Offline replay harness: re-render every card of a recorded cloud eval
// through the CURRENT deterministic renderer (resolved_fields + evidence)
// and compare against the recorded titles. Zero API cost - validates
// renderer/policy changes before any paid cloud run.
//
// Usage:
//   node scripts/replay-render-from-eval.mjs --input <cloud-eval.json> [--max-length 80] [--out <report.json>]

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1] || fallback;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function legacyTokens(value) {
  return new Set(normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .filter(Boolean));
}

function legacyRecall(referenceTitle, predictionTitle) {
  const reference = legacyTokens(referenceTitle);
  if (!reference.size) return null;
  const predicted = legacyTokens(predictionTitle);
  const overlap = [...reference].filter((token) => predicted.has(token)).length;
  return Number((overlap / reference.size).toFixed(6));
}

function referenceTitleForResult(result = {}) {
  return normalizeText(
    result.corrected_title_reference
    || result.corrected_title
    || result.reference_title
    || result.seller_title
    || ""
  );
}

function replayResolvedFields(result = {}) {
  const rendered = result.rendered_fields && typeof result.rendered_fields === "object" && !Array.isArray(result.rendered_fields)
    ? result.rendered_fields
    : {};
  const renderedFields = rendered.fields && typeof rendered.fields === "object" && !Array.isArray(rendered.fields)
    ? rendered.fields
    : {};
  const resolved = result.resolved_fields || result.resolved || {};
  return {
    ...resolved,
    ...renderedFields
  };
}

export async function replayRenderFromEval({
  inputPath,
  maxLength = 80
} = {}) {
  const report = JSON.parse(await readFile(resolve(inputPath), "utf8"));
  const results = Array.isArray(report.results) ? report.results : [];
  const rows = [];
  let recordedFairSum = 0;
  let replayedFairSum = 0;
  let scored = 0;
  let up = 0;
  let down = 0;
  let assistPreserved = 0;

  for (const result of results) {
    const reference = referenceTitleForResult(result);
    const recorded = normalizeText(result.title || result.final_title || "");
    const titleRenderSource = result.rendered_fields?.title_render_source
      || result.title_render_source
      || "";
    // Assist-lane titles are produced outside the plain deterministic render;
    // replay preserves them so the harness only measures renderer changes.
    const preserveRecorded = titleRenderSource === "safe_retrieval_title_assist";
    const replayed = preserveRecorded
      ? recorded
      : normalizeText(renderListingPresentation({
        resolved: replayResolvedFields(result),
        evidence: result.normalized_evidence || result.evidence || {},
        maxLength
      }).final_title || "");
    if (preserveRecorded) assistPreserved += 1;
    if (!reference) {
      rows.push({
        candidate_id: result.candidate_id || null,
        scored: false,
        recorded_title: recorded,
        replayed_title: replayed,
        title_render_source: titleRenderSource
      });
      continue;
    }
    const recordedFair = fairTokenRecall(reference, recorded);
    const replayedFair = fairTokenRecall(reference, replayed);
    recordedFairSum += recordedFair || 0;
    replayedFairSum += replayedFair || 0;
    scored += 1;
    if (replayedFair > recordedFair + 1e-9) up += 1;
    else if (replayedFair < recordedFair - 1e-9) down += 1;
    rows.push({
      candidate_id: result.candidate_id || null,
      scored: true,
      reference_title: reference,
      recorded_title: recorded,
      replayed_title: replayed,
      title_render_source: titleRenderSource,
      recorded_legacy_recall: legacyRecall(reference, recorded),
      recorded_fair_recall: recordedFair,
      replayed_fair_recall: replayedFair,
      delta: Number(((replayedFair || 0) - (recordedFair || 0)).toFixed(6))
    });
  }

  const passAt = (threshold, key) => rows.filter((row) => row.scored && Number(row[key]) >= threshold).length;

  return {
    schema_version: "replay-render-from-eval-v1",
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    max_length: maxLength,
    result_count: results.length,
    scored_count: scored,
    assist_titles_preserved: assistPreserved,
    recorded: {
      fair_avg: scored ? Number((recordedFairSum / scored).toFixed(6)) : null,
      fair_pass_at_0_72: passAt(0.72, "recorded_fair_recall"),
      fair_pass_at_0_80: passAt(0.80, "recorded_fair_recall")
    },
    replayed: {
      fair_avg: scored ? Number((replayedFairSum / scored).toFixed(6)) : null,
      fair_pass_at_0_72: passAt(0.72, "replayed_fair_recall"),
      fair_pass_at_0_80: passAt(0.80, "replayed_fair_recall")
    },
    up_count: up,
    down_count: down,
    rows
  };
}

export async function main(argv = process.argv) {
  const inputPath = argValue(argv, "--input");
  if (!inputPath) {
    console.error("Usage: node scripts/replay-render-from-eval.mjs --input <cloud-eval.json> [--max-length 80] [--out <report.json>]");
    return 1;
  }
  const maxLength = Number(argValue(argv, "--max-length", "80")) || 80;
  const outPath = argValue(argv, "--out", "");
  const report = await replayRenderFromEval({ inputPath, maxLength });
  if (outPath) {
    const resolved = resolve(outPath);
    if (!existsSync(dirname(resolved))) await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`);
  }
  const lines = [
    `replay-render-from-eval: ${report.scored_count}/${report.result_count} scored (maxLength=${report.max_length}, assist preserved=${report.assist_titles_preserved})`,
    `recorded fair: avg=${report.recorded.fair_avg} pass@0.72=${report.recorded.fair_pass_at_0_72} pass@0.80=${report.recorded.fair_pass_at_0_80}`,
    `replayed fair: avg=${report.replayed.fair_avg} pass@0.72=${report.replayed.fair_pass_at_0_72} pass@0.80=${report.replayed.fair_pass_at_0_80}`,
    `up=${report.up_count} down=${report.down_count}`
  ];
  for (const row of report.rows.filter((item) => item.scored && Math.abs(item.delta) > 1e-9)) {
    lines.push(`${row.delta > 0 ? "UP  " : "DOWN"} ${String(row.candidate_id || "").slice(-8)} ${row.recorded_fair_recall} -> ${row.replayed_fair_recall}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(`replay-render-from-eval failed: ${error.message}`);
    process.exit(1);
  }
}
