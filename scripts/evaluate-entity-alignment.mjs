#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  alignEntityClaim,
  entityAlignmentRelations
} from "../lib/listing/catalog/entity-alignment.mjs";
import { parseReviewedTitleFields } from "../lib/listing/memory/title-field-parser.mjs";
import { policyFairTokenRecall } from "./evaluate-cloud-listing-api.mjs";

const { PREFIX, HYPERNYM, NONE } = entityAlignmentRelations;

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function safeDivide(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(6)) : null;
}

export function metrics(rows = []) {
  const checked = rows.filter((row) => row.checked);
  const labelled = checked.filter((row) => typeof row.expected_none === "boolean");
  const tp = labelled.filter((row) => row.predicted_none && row.expected_none).length;
  const fp = labelled.filter((row) => row.predicted_none && !row.expected_none).length;
  const fn = labelled.filter((row) => !row.predicted_none && row.expected_none).length;
  const tn = labelled.filter((row) => !row.predicted_none && !row.expected_none).length;
  const hasLabels = labelled.length > 0;
  return {
    total: rows.length,
    checked: checked.length,
    unchecked: rows.length - checked.length,
    labelled: labelled.length,
    unlabelled: rows.length - labelled.length,
    true_positive: hasLabels ? tp : null,
    false_positive: hasLabels ? fp : null,
    false_negative: hasLabels ? fn : null,
    true_negative: hasLabels ? tn : null,
    none_precision: hasLabels ? safeDivide(tp, tp + fp) : null,
    none_recall: hasLabels ? safeDivide(tp, tp + fn) : null,
    false_none_rate: hasLabels ? safeDivide(fp, fp + tn) : null
  };
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function counterfactualReplace(title, claim, candidate) {
  const source = cleanText(title);
  const observed = cleanText(claim);
  const published = cleanText(candidate);
  if (!source || !observed || !published || source.toLowerCase().includes(published.toLowerCase())) return source;
  const pattern = new RegExp(`\\b${regexEscape(observed)}\\b`, "i");
  const match = pattern.exec(source);
  if (!match) return source;
  const prefix = source.slice(0, match.index).trim();
  const candidateWords = published.split(" ");
  const prefixWords = prefix.split(" ").filter(Boolean);
  let shared = 0;
  for (let count = Math.min(candidateWords.length - 1, prefixWords.length); count >= 1; count -= 1) {
    const left = prefixWords.slice(-count).join(" ").toLowerCase();
    const right = candidateWords.slice(0, count).join(" ").toLowerCase();
    if (left === right) {
      shared = count;
      break;
    }
  }
  const replacement = candidateWords.slice(shared).join(" ") || published;
  return cleanText(source.replace(pattern, replacement));
}

function candidate(value, kind) {
  return { id: `${kind}:${cleanText(value).toLowerCase()}`, value: cleanText(value), kind };
}

function evaluateUnseenRow(row, truth, label) {
  const claims = unique([row.resolved_fields?.product, row.resolved_fields?.set]);
  const candidates = unique([truth.product, truth.set_or_insert]).map((value) => candidate(
    value,
    cleanText(value) === cleanText(truth.product) ? "product" : "set"
  ));
  const alignments = claims.map((claim) => alignEntityClaim(claim, candidates));
  let counterfactualTitle = cleanText(row.final_title);
  const upgrades = [];
  for (const alignment of alignments) {
    if (![PREFIX, HYPERNYM].includes(alignment.relation) || !alignment.selected_candidate) continue;
    const upgraded = counterfactualReplace(counterfactualTitle, alignment.claim, alignment.selected_candidate.value);
    if (upgraded === counterfactualTitle) continue;
    upgrades.push({
      claim: alignment.claim,
      relation: alignment.relation,
      published_value: alignment.selected_candidate.value
    });
    counterfactualTitle = upgraded;
  }
  const baselineScore = Number(row.final_scoring?.policy_fair_token_recall);
  const counterfactualScore = policyFairTokenRecall(row.reference_title, counterfactualTitle);
  return {
    key: row.source_asset_id,
    cohort: "unseen17",
    checked: alignments.some((alignment) => alignment.checked),
    expected_none: label.expected_none === true,
    predicted_none: alignments.some((alignment) => alignment.relation === NONE),
    claims,
    authoritative_candidates: candidates,
    alignments,
    baseline_title: cleanText(row.final_title),
    counterfactual_title: counterfactualTitle,
    upgrades,
    baseline_policy_fair_token_recall: Number.isFinite(baselineScore) ? baselineScore : null,
    counterfactual_policy_fair_token_recall: counterfactualScore,
    counterfactual_delta: Number.isFinite(baselineScore) && Number.isFinite(counterfactualScore)
      ? Number((counterfactualScore - baselineScore).toFixed(6))
      : null,
    label_reason: label.reason
  };
}

function evaluateFamiliarProductRow(row, round) {
  const parsed = parseReviewedTitleFields(row.reference_title || "");
  const claim = cleanText(row.resolved_fields?.product);
  const published = cleanText(parsed.product);
  const alignment = alignEntityClaim(claim, published ? [candidate(published, "product")] : []);
  let counterfactualTitle = cleanText(row.final_title);
  const upgrades = [];
  if ([PREFIX, HYPERNYM].includes(alignment.relation) && alignment.selected_candidate) {
    const upgraded = counterfactualReplace(counterfactualTitle, claim, alignment.selected_candidate.value);
    if (upgraded !== counterfactualTitle) {
      upgrades.push({ claim, relation: alignment.relation, published_value: alignment.selected_candidate.value });
      counterfactualTitle = upgraded;
    }
  }
  const baselineScore = Number(row.final_scoring?.policy_fair_token_recall);
  const counterfactualScore = policyFairTokenRecall(row.reference_title, counterfactualTitle);
  return {
    key: `${round}:${row.source_feedback_id || row.source_asset_id}`,
    cohort: "familiar60_product_only",
    checked: alignment.checked,
    expected_none: null,
    predicted_none: alignment.relation === NONE,
    claims: claim ? [claim] : [],
    authoritative_candidates: published ? [candidate(published, "product")] : [],
    alignments: [alignment],
    baseline_title: cleanText(row.final_title),
    counterfactual_title: counterfactualTitle,
    upgrades,
    baseline_policy_fair_token_recall: Number.isFinite(baselineScore) ? baselineScore : null,
    counterfactual_policy_fair_token_recall: counterfactualScore,
    counterfactual_delta: Number.isFinite(baselineScore) && Number.isFinite(counterfactualScore)
      ? Number((counterfactualScore - baselineScore).toFixed(6))
      : null,
    label_reason: "reviewed title product supplies a comparison candidate, but there is no independent NONE label for this familiar row"
  };
}

function aggregateCounterfactual(rows = []) {
  const changed = rows.filter((row) => row.upgrades.length > 0);
  const improved = changed.filter((row) => Number(row.counterfactual_delta) > 0);
  const regressed = changed.filter((row) => Number(row.counterfactual_delta) < 0);
  const baseline = rows.map((row) => row.baseline_policy_fair_token_recall).filter(Number.isFinite);
  const counterfactual = rows.map((row) => row.counterfactual_policy_fair_token_recall).filter(Number.isFinite);
  const average = (values) => values.length
    ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6))
    : null;
  return {
    evaluated_count: rows.length,
    upgraded_count: changed.length,
    improved_count: improved.length,
    regressed_count: regressed.length,
    unchanged_count: rows.length - changed.length,
    baseline_average: average(baseline),
    counterfactual_average: average(counterfactual),
    absolute_delta: baseline.length && counterfactual.length
      ? Number((average(counterfactual) - average(baseline)).toFixed(6))
      : null
  };
}

function markdown(report) {
  const u = report.cohorts.unseen17;
  const f = report.cohorts.familiar60_product_only;
  const pct = (value) => value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
  const count = (value) => value === null ? "n/a" : value;
  const lines = [
    "# Entity alignment offline audit",
    "",
    `Generated ${report.generated_at}. Pure replay only; no database, model, or production behavior.`,
    "",
    "## Operating point",
    "",
    "`NONE` is emitted only when a non-empty claim has no semantic relation to any caller-supplied authoritative candidate. Empty candidate coverage is `UNCHECKED`. Ties return all best candidates and no selected value. This deliberately biases against false `NONE`.",
    "",
    "## NONE calibration",
    "",
    "| cohort | checked | independently labelled | TP | FP | FN | TN | NONE precision | NONE recall | false-NONE rate |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| unseen checklist identity | ${u.metrics.checked}/${u.metrics.total} | ${u.metrics.labelled}/${u.metrics.total} | ${count(u.metrics.true_positive)} | ${count(u.metrics.false_positive)} | ${count(u.metrics.false_negative)} | ${count(u.metrics.true_negative)} | ${pct(u.metrics.none_precision)} | ${pct(u.metrics.none_recall)} | ${pct(u.metrics.false_none_rate)} |`,
    `| familiar reviewed product only | ${f.metrics.checked}/${f.metrics.total} | ${f.metrics.labelled}/${f.metrics.total} | ${count(f.metrics.true_positive)} | ${count(f.metrics.false_positive)} | ${count(f.metrics.false_negative)} | ${count(f.metrics.true_negative)} | ${pct(f.metrics.none_precision)} | ${pct(f.metrics.none_recall)} | ${pct(f.metrics.false_none_rate)} |`,
    "",
    `The familiar cohort has ${f.metrics.checked}/${f.metrics.total} product claims with a comparison candidate and predicted NONE on ${f.predicted_none_card_count}/${f.metrics.checked || 0}, but it has 0/60 independent NONE labels. Its confusion matrix, precision, recall and false-NONE rate are therefore \`UNCHECKED\`, not zero. Familiar set claims are excluded because reviewed titles are not independent field-level set truth.`,
    "",
    "The unseen confusion matrix is calibration, not a generalization estimate: its 17 labels set the operating point. The familiar rows are an unlabelled comparison diagnostic over 20 identities replayed in three rounds. Independent Validation is required before any behavior can be wired in.",
    "",
    "## Counterfactual wiring",
    "",
    `- Unseen cards carrying at least one predicted NONE: ${u.predicted_none_card_count}/${u.metrics.total}; correct against labels: ${u.correct_none_card_count}/${u.predicted_none_card_count || 0}.`,
    `- Unseen PREFIX/HYPERNYM upgrades: ${u.counterfactual.upgraded_count}/${u.metrics.total}; improved ${u.counterfactual.improved_count}, regressed ${u.counterfactual.regressed_count}; policy-fair recall ${u.counterfactual.baseline_average} -> ${u.counterfactual.counterfactual_average} (${u.counterfactual.absolute_delta >= 0 ? "+" : ""}${u.counterfactual.absolute_delta}).`,
    `- Familiar product upgrades: ${f.counterfactual.upgraded_count}/${f.metrics.total}; improved ${f.counterfactual.improved_count}, regressed ${f.counterfactual.regressed_count}; policy-fair recall ${f.counterfactual.baseline_average} -> ${f.counterfactual.counterfactual_average} (${f.counterfactual.absolute_delta >= 0 ? "+" : ""}${f.counterfactual.absolute_delta}).`,
    "",
    "This is a counterfactual report, not a proposed behavior change. The module is not imported by the recognition pipeline.",
    "",
    "## Unseen cases",
    "",
    "| key | expected NONE | predicted NONE | relations | upgrades | delta |",
    "| --- | --- | --- | --- | --- | ---: |"
  ];
  for (const row of u.rows) {
    lines.push(`| ${row.key} | ${row.expected_none} | ${row.predicted_none} | ${row.alignments.map((item) => `${item.claim}:${item.relation || item.status}`).join("; ")} | ${row.upgrades.map((item) => `${item.claim}->${item.published_value}`).join("; ") || "-"} | ${row.counterfactual_delta ?? "n/a"} |`);
  }
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const unseenReportPath = resolve(argValue(argv, "--unseen-report", "/tmp/unseen-baseline.json"));
  const unseenLabelsPath = resolve(argValue(argv, "--unseen-labels", "artifacts/smoke/unseen20-labels.jsonl"));
  const calibrationPath = resolve(argValue(argv, "--calibration", "scripts/fixtures/entity-alignment-unseen17.json"));
  const familiarPaths = String(argValue(argv, "--familiar-reports", ""))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => resolve(value));
  const outPath = resolve(argValue(argv, "--out", "artifacts/offline/entity-alignment-audit.json"));
  const markdownPath = resolve(argValue(argv, "--markdown", "docs/entity-alignment-audit.md"));
  if (!familiarPaths.length) throw new Error("--familiar-reports requires the three recorded familiar report paths");

  const unseenReport = JSON.parse(await readFile(unseenReportPath, "utf8"));
  const unseenLabels = new Map((await readFile(unseenLabelsPath, "utf8"))
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .map((row) => [row.key, row.identity_ground_truth]));
  const calibration = JSON.parse(await readFile(calibrationPath, "utf8"));
  const calibrationLabels = new Map(calibration.cases.map((row) => [row.key, row]));
  const unseenRows = unseenReport.results.map((row) => {
    const truth = unseenLabels.get(row.source_asset_id);
    const label = calibrationLabels.get(row.source_asset_id);
    if (!truth || !label) throw new Error(`unseen_alignment_label_missing:${row.source_asset_id}`);
    return evaluateUnseenRow(row, truth, label);
  });

  const familiarRows = [];
  for (const [index, file] of familiarPaths.entries()) {
    const report = JSON.parse(await readFile(file, "utf8"));
    for (const row of report.results || []) familiarRows.push(evaluateFamiliarProductRow(row, index + 1));
  }
  if (unseenRows.length !== 17) throw new Error(`expected_17_unseen_rows_received_${unseenRows.length}`);
  if (familiarRows.length !== 60) throw new Error(`expected_60_familiar_rows_received_${familiarRows.length}`);

  const unseenMetrics = metrics(unseenRows);
  const familiarMetrics = metrics(familiarRows);
  const report = {
    schema_version: "entity-alignment-offline-audit-v1",
    generated_at: new Date().toISOString(),
    behavior_changed: false,
    sources: {
      unseen_report: unseenReportPath,
      unseen_labels: unseenLabelsPath,
      calibration: calibrationPath,
      familiar_reports: familiarPaths
    },
    operating_point: {
      false_none_is_more_costly_than_missed_none: true,
      no_candidates: "UNCHECKED",
      ambiguity: "candidate_list_with_null_selection",
      none_definition: "no semantic relation to any supplied authoritative candidate"
    },
    cohorts: {
      unseen17: {
        metrics: unseenMetrics,
        predicted_none_card_count: unseenRows.filter((row) => row.predicted_none).length,
        correct_none_card_count: unseenRows.filter((row) => row.predicted_none && row.expected_none).length,
        counterfactual: aggregateCounterfactual(unseenRows),
        rows: unseenRows
      },
      familiar60_product_only: {
        metrics: familiarMetrics,
        predicted_none_card_count: familiarRows.filter((row) => row.predicted_none).length,
        correct_none_card_count: null,
        counterfactual: aggregateCounterfactual(familiarRows),
        rows: familiarRows
      }
    }
  };
  await mkdir(dirname(outPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown(report), "utf8");
  process.stdout.write(`${JSON.stringify({
    out: outPath,
    markdown: markdownPath,
    unseen: unseenMetrics,
    familiar: familiarMetrics,
    unseen_counterfactual: report.cohorts.unseen17.counterfactual,
    familiar_counterfactual: report.cohorts.familiar60_product_only.counterfactual
  }, null, 2)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
