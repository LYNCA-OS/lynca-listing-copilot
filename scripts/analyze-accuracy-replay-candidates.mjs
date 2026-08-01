#!/usr/bin/env node

// Zero-cost, evaluation-only replay of narrowly scoped evidence resolvers.
// It never calls a provider and never mutates the canonical production fields.

import { readFileSync, writeFileSync } from "node:fs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import {
  replayLanguageObservationV1,
  replayPrintedSetObservationV1,
  replaySerialObservationSingleDigitV1
} from "../lib/listing/thin/candidate-identity-replay-v1.mjs";
import { resolveKnowledgeEntry } from "../lib/listing-knowledge-registry.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const rows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const cleanTokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const score = (reference, title) => {
  const wanted = cleanTokens(reference); const got = cleanTokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const sign = (deltas) => ({
  wins: deltas.filter((value) => value > 1e-12).length,
  losses: deltas.filter((value) => value < -1e-12).length,
  ties: deltas.filter((value) => Math.abs(value) <= 1e-12).length
});
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const languageCode = (value) => {
  const text = clean(value).toLocaleLowerCase("en-US");
  const direct = text.match(/\b(en|jp|cn|kr)\b/i);
  if (direct) return direct[1].toUpperCase();
  if (/\bjapanese\b/.test(text)) return "JP";
  if (/\b(?:chinese|中文)\b/.test(text)) return "CN";
  if (/\bkorean\b/.test(text)) return "KR";
  if (/\benglish\b/.test(text)) return "EN";
  return "";
};
const replayLanguageMarker = (fields, observations, { namedText = false } = {}) => {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  if (String(next.grammar || "").toLowerCase() !== "tcg" || clean(next.language)) {
    return { fields: next, changes };
  }
  const candidate = observations
    .filter((observation) => ["language_and_year", "language_code", "language", "language_text"].includes(observation?.label))
    .filter((observation) => namedText || observation.label === "language_and_year" || observation.label === "language_code")
    .map((observation) => ({ ...observation, value: languageCode(observation.evidence) }))
    .find((observation) => observation.value);
  if (candidate) {
    next.language = candidate.value;
    changes.push({ field: "language", value: candidate.value, source: candidate });
  }
  return { fields: next, changes };
};
const replayAttestedInsert = (fields, observations) => {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  if (clean(next.card_name)) return { fields: next, changes };
  const candidate = observations
    .filter((observation) => observation?.label === "insert_name")
    .filter((observation) => observation?.kind === "printed_text" && observation?.confidence === "high")
    .map((observation) => ({ ...observation, value: clean(observation.evidence), entry: resolveKnowledgeEntry(observation.evidence) }))
    .find((observation) => observation.entry && observation.value.length <= 48);
  if (candidate) {
    next.card_name = candidate.value;
    changes.push({ field: "card_name", value: candidate.value, source: candidate });
  }
  return { fields: next, changes };
};
const replayPrintedJersey = (fields, observations) => {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  const hasJersey = [...(next.attributes || []), ...(next.components || [])].some((value) => /^jersey$/i.test(value));
  const candidate = observations.find((observation) => observation?.label === "card_type"
    && observation?.kind === "printed_text" && observation?.confidence === "high"
    && /^jersey(?: card)?$/i.test(clean(observation.evidence)));
  if (!hasJersey && candidate) {
    next.attributes = [...(next.attributes || []), "Jersey"];
    next.components = [...(next.components || []), "Jersey"];
    changes.push({ field: "components", value: "Jersey", source: candidate });
  }
  return { fields: next, changes };
};
const replayPrintedParallel = (fields, observations) => {
  const original = structuredClone(fields || {});
  const next = structuredClone(original);
  const changes = [];
  if (clean(next.print_finish) || clean(next.parallel_exact)) return { fields: next, changes };
  const candidate = observations
    .filter((observation) => observation?.label === "parallel")
    .filter((observation) => observation?.kind === "printed_text" && observation?.confidence === "high")
    .map((observation) => ({ ...observation, value: clean(observation.evidence) }))
    .find((observation) => observation.value.length >= 3 && observation.value.length <= 48);
  if (candidate) {
    next.parallel_exact = candidate.value;
    next.print_finish = candidate.value;
    changes.push({ field: "parallel_exact", value: candidate.value, source: candidate });
  }
  return { fields: next, changes };
};
const referenceLosses = (reference, before, after) => {
  const wanted = cleanTokens(reference); const beforeTokens = cleanTokens(before); const afterTokens = cleanTokens(after);
  return [...wanted].filter((token) => beforeTokens.has(token) && !afterTokens.has(token));
};

const inputPath = arg("--input", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const canonicalArm = arg("--canonical-arm", "thin_canonical_high");
const limit = Number(arg("--limit", "150"));
const out = arg("--out", "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/replay-candidate-mechanisms.json");
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const input = rows(inputPath);
const canonical = input.filter((row) => row.arm === canonicalArm && row.fields).slice(0, limit);
const observationsByAsset = new Map(
  rows(exhaustivePath).filter((row) => row.arm === "exhaustive_observation_high")
    .map((row) => [row.asset_id, row.observations || []])
);
if (canonical.length !== limit || canonical.some((row) => !observationsByAsset.has(row.asset_id))) {
  throw new Error("paired_cohort_mismatch_or_too_small");
}

const resolvers = {
  serial_single_digit: (fields, observations) => replaySerialObservationSingleDigitV1(fields, observations),
  printed_set: (fields, observations) => replayPrintedSetObservationV1(fields, observations),
  language: (fields, observations) => replayLanguageObservationV1(fields, observations),
  language_marker: (fields, observations) => replayLanguageMarker(fields, observations),
  language_named_text: (fields, observations) => replayLanguageMarker(fields, observations, { namedText: true }),
  attested_insert: (fields, observations) => replayAttestedInsert(fields, observations),
  printed_jersey: (fields, observations) => replayPrintedJersey(fields, observations),
  printed_parallel: (fields, observations) => replayPrintedParallel(fields, observations)
};
const bundles = {
  serial_single_digit: ["serial_single_digit"],
  printed_set: ["printed_set"],
  language: ["language"],
  language_marker: ["language_marker"],
  language_named_text: ["language_named_text"],
  attested_insert: ["attested_insert"],
  printed_jersey: ["printed_jersey"],
  printed_parallel: ["printed_parallel"],
  serial_single_digit_printed_set: ["serial_single_digit", "printed_set"],
  serial_single_digit_language: ["serial_single_digit", "language"],
  serial_single_digit_language_marker: ["serial_single_digit", "language_marker"],
  serial_single_digit_language_named_text: ["serial_single_digit", "language_named_text"],
  serial_single_digit_attested_insert: ["serial_single_digit", "attested_insert"],
  serial_single_digit_printed_jersey: ["serial_single_digit", "printed_jersey"],
  serial_single_digit_printed_parallel: ["serial_single_digit", "printed_parallel"],
  serial_single_digit_printed_set_language: ["serial_single_digit", "printed_set", "language"]
};

const cards = canonical.map((row) => {
  const baseline = composeFromCanonicalFields(row.fields);
  const observations = observationsByAsset.get(row.asset_id);
  const make = (title) => score(row.reference, title);
  const variants = {};
  for (const [name, sequence] of Object.entries(bundles)) {
    let fields = structuredClone(row.fields);
    const changes = [];
    for (const resolverName of sequence) {
      const result = resolvers[resolverName](fields, observations);
      fields = result.fields;
      changes.push(...result.changes.map((change) => ({ ...change, resolver: resolverName })));
    }
    const title = composeFromCanonicalFields(fields);
    variants[name] = {
      title: title.title,
      score: make(title.title),
      changes,
      reference_losses: referenceLosses(row.reference, baseline.title, title.title),
      over_80: title.title.length > 80
    };
  }
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    baseline_score: make(baseline.title),
    variants
  };
});

const summary = Object.fromEntries(Object.keys(bundles).map((name) => {
  const deltas = cards.map((card) => card.variants[name].score.f1 - card.baseline_score.f1);
  const rowsForVariant = cards.map((card) => card.variants[name]);
  return [name, {
    baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
    candidate_macro_f1: mean(cards.map((card) => card.variants[name].score.f1)),
    delta_macro_f1: mean(deltas),
    ...sign(deltas),
    changed_cards: rowsForVariant.filter((row) => row.changes.length).length,
    reference_loss_cards: rowsForVariant.filter((row) => row.reference_losses.length).length,
    over_80: rowsForVariant.filter((row) => row.over_80).length,
    status: deltas.some((value) => value < -1e-12) || rowsForVariant.some((row) => row.reference_losses.length || row.over_80)
      ? "STOP" : "candidate"
  }];
}));

const result = {
  schema_version: "accuracy-replay-candidate-mechanisms-v1",
  source: { inputPath, exhaustivePath, canonicalArm, limit },
  summary,
  cards
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ schema_version: result.schema_version, out, summary }, null, 2));
