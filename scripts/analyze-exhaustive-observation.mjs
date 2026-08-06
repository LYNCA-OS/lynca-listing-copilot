#!/usr/bin/env node
// Diagnose where a reference-helpful token disappeared in the paired
// canonical versus exhaustive-observation experiment.

import { readFileSync, writeFileSync } from "node:fs";

const clean = (value) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const evidenceTokens = (value) => clean(value).split(/[^a-z0-9/']+/).filter(Boolean);

function flatten(value) {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") return Object.values(value).flatMap(flatten);
  return evidenceTokens(value);
}

const unique = (values) => [...new Set(values)];

export function diagnoseExhaustivePair({ canonical, exhaustive }) {
  const reference = unique(evidenceTokens(canonical.reference));
  const canonicalTitle = new Set(evidenceTokens(canonical.title));
  const canonicalFields = new Set(flatten(canonical.fields || {}));
  const observations = new Set((exhaustive.observations || []).flatMap((row) => evidenceTokens(row.evidence)));
  const missing = reference.filter((token) => !canonicalTitle.has(token));
  const causes = {
    exhaustive_not_expressed: [],
    canonical_schema_compression: [],
    downstream_composition: []
  };
  for (const token of missing) {
    if (!observations.has(token)) causes.exhaustive_not_expressed.push(token);
    else if (!canonicalFields.has(token)) causes.canonical_schema_compression.push(token);
    else causes.downstream_composition.push(token);
  }
  return {
    asset_id: canonical.asset_id,
    reference: canonical.reference,
    canonical_title: canonical.title,
    missing_reference_tokens: missing,
    causes,
    exhaustive_observation_count: (exhaustive.observations || []).length,
    observation_only_nonreference_tokens: unique([...observations]
      .filter((token) => !reference.includes(token) && !canonicalFields.has(token)))
  };
}

export function analyzeExhaustiveRows(rows = [], {
  canonicalArm = "thin_canonical_high",
  exhaustiveArm = "exhaustive_observation_high"
} = {}) {
  const canonical = new Map(rows.filter((row) => row.arm === canonicalArm).map((row) => [row.asset_id, row]));
  const exhaustive = new Map(rows.filter((row) => row.arm === exhaustiveArm).map((row) => [row.asset_id, row]));
  const paired = [...canonical.keys()].filter((id) => exhaustive.has(id))
    .map((id) => diagnoseExhaustivePair({ canonical: canonical.get(id), exhaustive: exhaustive.get(id) }));
  const stageNames = ["exhaustive_not_expressed", "canonical_schema_compression", "downstream_composition"];
  const stages = Object.fromEntries(stageNames.map((stage) => {
    const affected = paired.filter((row) => row.causes[stage].length);
    return [stage, {
      affected_cards: affected.length,
      token_occurrences: affected.reduce((sum, row) => sum + row.causes[stage].length, 0),
      tokens: Object.entries(affected.flatMap((row) => row.causes[stage])
        .reduce((counts, token) => ({ ...counts, [token]: (counts[token] || 0) + 1 }), {}))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([token, count]) => ({ token, count }))
    }];
  }));
  return {
    schema_version: "exhaustive-observation-diagnosis-v1",
    canonical_arm: canonicalArm,
    exhaustive_arm: exhaustiveArm,
    paired_cards: paired.length,
    stages,
    interpretation: {
      exhaustive_not_expressed: "not emitted even when compression and known-field constraints were removed; candidate perception/expression miss, not proof of visual incapability",
      canonical_schema_compression: "emitted by the same model in exhaustive mode but absent from canonical fields",
      downstream_composition: "present in canonical fields but absent from the composed title"
    },
    rows: paired
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const flag = (name, fallback = "") => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
  };
  const canonicalPath = flag("--canonical");
  const exhaustivePath = flag("--exhaustive");
  const outPath = flag("--out");
  const path = process.argv[2];
  if (!canonicalPath && !path) {
    throw new Error("usage: analyze-exhaustive-observation.mjs <checkpoint.jsonl> [canonical-arm] [exhaustive-arm] or --canonical <canonical.jsonl> --exhaustive <exhaustive.jsonl>");
  }
  const rows = canonicalPath && exhaustivePath
    ? `${readFileSync(canonicalPath, "utf8")}\n${readFileSync(exhaustivePath, "utf8")}`
      .split("\n").filter(Boolean).map(JSON.parse)
    : readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const report = analyzeExhaustiveRows(rows, {
    canonicalArm: flag("--canonical-arm", process.argv[3] || "thin_canonical_high"),
    exhaustiveArm: flag("--exhaustive-arm", process.argv[4] || "exhaustive_observation_high")
  });
  if (outPath) writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
