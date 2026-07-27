#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  classifyToken,
  documentFrequency,
  multisetDiff,
  tokens
} from "./writer-acceptance-eval.mjs";

const serialToken = /^(?:\d{1,4}|#)\/(\d{1,4})$/;
const semanticPrintRunPath = /(print_run|serial|numbered|numerical_rarity|expected_serial_denominator)/i;

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function primitiveStrings(value, path = "", filter = () => true, out = []) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => primitiveStrings(item, `${path}[${index}]`, filter, out));
    return out;
  }
  if (typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => primitiveStrings(item, path ? `${path}.${key}` : key, filter, out));
    return out;
  }
  if (filter(path, value)) out.push({ path, value: text(value) });
  return out;
}

function fieldFlowStrings(row = {}) {
  const fields = row?.pipeline_node_ledger?.field_flow?.fields
    || row?.l2_status?.pipeline_node_ledger?.field_flow?.fields
    || [];
  return fields.flatMap((field, index) => {
    const group = text(field?.field_group);
    return ["raw_values", "normalized_values", "resolved_values", "values"].flatMap((key) => (
      primitiveStrings(field?.[key], `field_flow.fields[${index}].${group}.${key}`)
    ));
  });
}

function decisionStrings(row = {}) {
  const decisions = row?.l2_candidate_debug?.retrieval_application?.decisions
    || row?.retrieval_application?.decisions
    || [];
  return decisions.flatMap((decision, index) => [
    "candidate_value", "resolver_value", "final_value", "old_value"
  ].flatMap((key) => primitiveStrings(decision?.[key], `retrieval_application.decisions[${index}].${key}`)));
}

function sourceGroups(row = {}) {
  return {
    resolver: [
      ...primitiveStrings(row.resolved_fields, "resolved_fields"),
      ...primitiveStrings(row.rendered_fields, "rendered_fields"),
      ...primitiveStrings(row.field_states, "field_states"),
      ...primitiveStrings(row?.l2_status?.resolved_fields, "l2_status.resolved_fields"),
      ...primitiveStrings(row?.l2_status?.field_states, "l2_status.field_states")
    ],
    evidence: [
      ...primitiveStrings(row.candidate_observation_snapshot, "candidate_observation_snapshot"),
      ...primitiveStrings(row?.l2_status?.candidate_observation_snapshot, "l2_status.candidate_observation_snapshot"),
      ...fieldFlowStrings(row)
    ],
    candidate: decisionStrings(row)
  };
}

function valuesContainToken(values = [], wanted = "") {
  const normalized = text(wanted).toLowerCase();
  return values.some(({ value }) => tokens(value).includes(normalized));
}

function printRunValues(values = []) {
  return values.filter(({ path }) => semanticPrintRunPath.test(path));
}

function valuesContainDenominator(values = [], denominator = "") {
  const wanted = text(denominator);
  return printRunValues(values).some(({ value }) => {
    const normalized = text(value);
    if (normalized === wanted) return true;
    return tokens(normalized).some((token) => serialToken.exec(token)?.[1] === wanted);
  });
}

function titleContainsDenominator(title = "", denominator = "") {
  const escaped = text(denominator).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)(?:\\d{1,4}|#)/${escaped}(?=\\s|$)`, "i").test(text(title));
}

function firstEvidence(values = [], predicate = () => false) {
  const hit = values.find(predicate);
  return hit ? { path: hit.path, value: hit.value } : null;
}

export function auditRows(rows = []) {
  const scored = rows.filter((row) => text(row.reviewed_title) && text(row.final_title));
  const df = documentFrequency(scored.map((row) => row.reviewed_title));
  const context = { df, corpusSize: scored.length };
  const denominatorMissing = [];
  const structuralMissing = [];

  scored.forEach((row) => {
    const groups = sourceGroups(row);
    const missing = multisetDiff(tokens(row.reviewed_title), tokens(row.final_title)).missing;

    for (const serial of missing.filter((token) => serialToken.test(token))) {
      const denominator = serialToken.exec(serial)?.[1] || "";
      // The writer tokenizer deliberately strips a leading #. Inspect the
      // title itself so the safe denominator-only form (#/25) remains visible.
      const generatedHasDenominator = titleContainsDenominator(row.final_title, denominator);
      if (generatedHasDenominator) continue;

      let disposition = "NEVER_HELD";
      let evidence = null;
      for (const [name, values] of Object.entries(groups)) {
        if (!valuesContainDenominator(values, denominator)) continue;
        disposition = name === "resolver"
          ? "RESOLVER_HELD_NOT_RENDERED"
          : name === "evidence"
            ? "EVIDENCE_HELD_NOT_RESOLVED"
            : "CANDIDATE_HELD_NOT_APPLIED";
        evidence = firstEvidence(printRunValues(values), ({ value }) => (
          text(value) === denominator
          || tokens(value).some((token) => serialToken.exec(token)?.[1] === denominator)
        ));
        break;
      }
      denominatorMissing.push({
        asset_id: row.asset_id,
        reviewed_title: row.reviewed_title,
        final_title: row.final_title,
        missing_serial: serial,
        denominator,
        disposition,
        evidence
      });
    }

    for (const token of missing.filter((item) => classifyToken(item, context) === "structural")) {
      let disposition = "NEVER_HELD";
      let evidence = null;
      for (const [name, values] of Object.entries(groups)) {
        if (!valuesContainToken(values, token)) continue;
        disposition = name === "resolver"
          ? "RESOLVER_HELD_NOT_RENDERED"
          : name === "evidence"
            ? "EVIDENCE_HELD_NOT_RESOLVED"
            : "CANDIDATE_HELD_NOT_APPLIED";
        evidence = firstEvidence(values, ({ value }) => tokens(value).includes(token));
        break;
      }
      structuralMissing.push({
        asset_id: row.asset_id,
        token,
        reviewed_title: row.reviewed_title,
        final_title: row.final_title,
        disposition,
        evidence
      });
    }
  });

  const countBy = (items, key) => Object.fromEntries([...items.reduce((map, item) => (
    map.set(item[key], (map.get(item[key]) || 0) + 1)
  ), new Map())].sort((a, b) => b[1] - a[1]));

  const serialMissingTotal = scored.reduce((sum, row) => {
    const missing = multisetDiff(tokens(row.reviewed_title), tokens(row.final_title)).missing;
    return sum + missing.filter((token) => serialToken.test(token)).length;
  }, 0);

  return {
    schema_version: "offline-benchmark-loss-audit-v1",
    cards: scored.length,
    serial: {
      missing_total: serialMissingTotal,
      denominator_preserved_numerator_missing: serialMissingTotal - denominatorMissing.length,
      denominator_missing: denominatorMissing.length,
      denominator_missing_by_disposition: countBy(denominatorMissing, "disposition"),
      rows: denominatorMissing
    },
    structural: {
      missing_total: structuralMissing.length,
      missing_by_disposition: countBy(structuralMissing, "disposition"),
      missing_by_token: countBy(structuralMissing, "token"),
      rows: structuralMissing
    }
  };
}

export async function main(argv = process.argv.slice(2)) {
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : "";
  const inputs = argv.filter((arg, index) => !arg.startsWith("--") && index !== outIndex + 1);
  if (!inputs.length) throw new Error("usage: audit-offline-benchmark-losses.mjs <report.json...> [--out report.json]");
  const rows = [];
  for (const input of inputs) {
    const report = JSON.parse(await readFile(resolve(input), "utf8"));
    rows.push(...(report.results || []));
  }
  const audit = auditRows(rows);
  const serialized = `${JSON.stringify(audit, null, 2)}\n`;
  if (outPath) await writeFile(resolve(outPath), serialized, "utf8");
  console.log(JSON.stringify({
    cards: audit.cards,
    serial: {
      missing_total: audit.serial.missing_total,
      denominator_preserved_numerator_missing: audit.serial.denominator_preserved_numerator_missing,
      denominator_missing: audit.serial.denominator_missing,
      denominator_missing_by_disposition: audit.serial.denominator_missing_by_disposition
    },
    structural: {
      missing_total: audit.structural.missing_total,
      missing_by_disposition: audit.structural.missing_by_disposition,
      missing_by_token: audit.structural.missing_by_token
    },
    out: outPath || null
  }, null, 2));
  return 0;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
