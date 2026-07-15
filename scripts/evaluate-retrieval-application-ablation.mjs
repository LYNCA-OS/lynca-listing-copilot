import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGoldenSemAccuracy } from "../lib/listing/evaluation/golden-sem-accuracy.mjs";
import { goldenSemCriticalFields } from "../lib/listing/evaluation/golden-sem-release.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function rowsFromReport(report = {}) {
  for (const key of ["results", "items", "records", "cards"]) {
    if (Array.isArray(report?.[key])) return report[key];
  }
  return [];
}

function rowId(row = {}) {
  return cleanText(
    row.item_id
    || row.query_card_id
    || row.card_id
    || row.asset_id
    || row.source_feedback_id
    || row.candidate_id
  ).toLowerCase();
}

function rowMap(report = {}) {
  return new Map(rowsFromReport(report).map((row) => [rowId(row), row]).filter(([id]) => Boolean(id)));
}

function finalTitle(row = {}) {
  return cleanText(row.final_title || row.title || row.l2_status?.title || row.l2_status?.final_title);
}

function retrievalApplication(row = {}) {
  return row.retrieval_application
    || row.l2_candidate_debug?.retrieval_application
    || row.candidate_control_plane_trace?.retrieval_application
    || row.l2_status?.candidate_control_plane_trace?.retrieval_application
    || null;
}

function rate(correct, total) {
  return total > 0 ? Number((correct / total).toFixed(6)) : null;
}

function criticalAccuracy(accuracyReport = {}) {
  const perField = accuracyReport.metrics?.per_field_exact_accuracy || {};
  const totals = goldenSemCriticalFields.reduce((summary, field) => {
    summary.correct += Number(perField[field]?.correct || 0);
    summary.total += Number(perField[field]?.total || 0);
    return summary;
  }, { correct: 0, total: 0 });
  return {
    ...totals,
    rate: rate(totals.correct, totals.total),
    fields: Object.fromEntries(goldenSemCriticalFields.map((field) => [field, perField[field] || {
      correct: 0,
      total: 0,
      accuracy: null
    }]))
  };
}

function cardExactMap(accuracyReport = {}) {
  return new Map((accuracyReport.cards || []).map((card) => [cleanText(card.item_id).toLowerCase(), card.card_exact]));
}

function roundedDelta(onValue, offValue) {
  if (!Number.isFinite(Number(onValue)) || !Number.isFinite(Number(offValue))) return null;
  return Number((Number(onValue) - Number(offValue)).toFixed(6));
}

export function evaluateRetrievalApplicationAblation({
  dataset = {},
  retrievalDisabledReport = {},
  retrievalEnabledReport = {}
} = {}) {
  const offAccuracy = evaluateGoldenSemAccuracy({ dataset, predictions: retrievalDisabledReport });
  const onAccuracy = evaluateGoldenSemAccuracy({ dataset, predictions: retrievalEnabledReport });
  const offCritical = criticalAccuracy(offAccuracy);
  const onCritical = criticalAccuracy(onAccuracy);
  const offRows = rowMap(retrievalDisabledReport);
  const onRows = rowMap(retrievalEnabledReport);
  const datasetIds = (Array.isArray(dataset.items) ? dataset.items : [])
    .map((item) => rowId(item))
    .filter(Boolean);
  const pairedIds = datasetIds.filter((id) => offRows.has(id) && onRows.has(id));
  const offExact = cardExactMap(offAccuracy);
  const onExact = cardExactMap(onAccuracy);
  const perCard = pairedIds.map((id) => {
    const off = offRows.get(id);
    const on = onRows.get(id);
    const application = retrievalApplication(on);
    const appliedFields = Array.isArray(application?.actual_applied_fields)
      ? application.actual_applied_fields
      : [];
    const offCardExact = offExact.get(id) ?? null;
    const onCardExact = onExact.get(id) ?? null;
    return {
      item_id: id,
      retrieval_disabled_title: finalTitle(off),
      retrieval_enabled_title: finalTitle(on),
      title_changed: finalTitle(off) !== finalTitle(on),
      candidate_application_count: Number(application?.actual_application_count || appliedFields.length || 0),
      applied_fields: appliedFields,
      field_decision_counts: application?.decision_counts || {},
      sem_card_exact_off: offCardExact,
      sem_card_exact_on: onCardExact,
      outcome: offCardExact === false && onCardExact === true
        ? "RECOVERY"
        : offCardExact === true && onCardExact === false
          ? "REGRESSION"
          : "NO_CHANGE"
    };
  });
  const candidateApplicationCount = perCard.reduce((sum, row) => sum + row.candidate_application_count, 0);
  const titleChangeCount = perCard.filter((row) => row.title_changed).length;
  const recoveryCount = perCard.filter((row) => row.outcome === "RECOVERY").length;
  const regressionCount = perCard.filter((row) => row.outcome === "REGRESSION").length;
  const offSemField = offAccuracy.metrics?.sem_field_exact_accuracy || {};
  const onSemField = onAccuracy.metrics?.sem_field_exact_accuracy || {};

  return {
    schema_version: "retrieval-application-ablation-v1",
    generated_at: new Date().toISOString(),
    cohort: {
      dataset_item_count: datasetIds.length,
      retrieval_disabled_result_count: offRows.size,
      retrieval_enabled_result_count: onRows.size,
      paired_card_count: pairedIds.length,
      same_card_cohort_complete: pairedIds.length === datasetIds.length,
      missing_from_disabled: datasetIds.filter((id) => !offRows.has(id)),
      missing_from_enabled: datasetIds.filter((id) => !onRows.has(id))
    },
    metrics: {
      retrieval_disabled: {
        sem_field_accuracy: offSemField,
        critical_field_accuracy: offCritical
      },
      retrieval_enabled: {
        sem_field_accuracy: onSemField,
        critical_field_accuracy: onCritical,
        candidate_application_count: candidateApplicationCount,
        title_change_count: titleChangeCount
      },
      delta: {
        sem_field_accuracy: roundedDelta(onSemField.rate, offSemField.rate),
        critical_field_accuracy: roundedDelta(onCritical.rate, offCritical.rate),
        retrieval_recovery_count: recoveryCount,
        retrieval_regression_count: regressionCount,
        net_benefit: recoveryCount - regressionCount
      }
    },
    per_card: perCard,
    validity: {
      causal_comparison_valid: pairedIds.length > 0 && pairedIds.length === datasetIds.length,
      requirements: [
        "same card cohort",
        "same deployment and model",
        "same prompt core",
        "only retrieval enablement differs"
      ]
    }
  };
}

function parseArgs(argv = []) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    options[value.slice(2)] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dataset || !args.off || !args.on) {
    throw new Error("Usage: node scripts/evaluate-retrieval-application-ablation.mjs --dataset <golden-sem.json> --off <retrieval-off.json> --on <retrieval-on.json> [--out <report.json>]");
  }
  const report = evaluateRetrievalApplicationAblation({
    dataset: await readJson(args.dataset),
    retrievalDisabledReport: await readJson(args.off),
    retrievalEnabledReport: await readJson(args.on)
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    await fs.mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await fs.writeFile(path.resolve(args.out), output);
  }
  process.stdout.write(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
