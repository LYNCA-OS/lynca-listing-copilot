#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { projectFreeTitleThroughCsm, mergeFreeEvidenceIntoCanonical } from "./measure-free-title-csm-projection.mjs";
import { replaySerialObservationV1 } from "../lib/listing/thin/candidate-identity-replay-v1.mjs";
import { composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const readRows = (path) => readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map(JSON.parse);
const cleanTokens = (value) => new Set(String(value ?? "").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));
const flattenTokens = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenTokens);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenTokens);
  return [...cleanTokens(value)];
};
const score = (reference, title) => {
  const wanted = cleanTokens(reference); const got = cleanTokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return { recall, precision, f1: recall + precision ? 2 * recall * precision / (recall + precision) : 0 };
};
const referenceLosses = (reference, before, after) => {
  const wanted = cleanTokens(reference);
  const beforeTokens = cleanTokens(before);
  const afterTokens = cleanTokens(after);
  return [...wanted].filter((token) => beforeTokens.has(token) && !afterTokens.has(token));
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

async function loadComposerAtCommit(commit) {
  const root = mkdtempSync(join(tmpdir(), "lynca-composer-bundle-baseline-"));
  const files = [
    "lib/listing/thin/canonical-composer.mjs",
    "lib/listing/thin/marketplace-composer-rules.mjs",
    "lib/listing/csm/sem-definition.mjs",
    "lib/listing/csm/product-semantics.mjs"
  ];
  try {
    for (const file of files) {
      const content = execFileSync("git", ["show", `${commit}:${file}`], { encoding: "utf8" });
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    return (await import(`${pathToFileURL(join(root, files[0])).href}?bundle=${encodeURIComponent(commit)}`)).composeFromCanonicalFields;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const canonicalPath = arg("--canonical", "artifacts/canonical-v3/thin-path-gpt-5.6-luna.jsonl");
const exhaustivePath = arg("--exhaustive", "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl");
const canonicalArm = arg("--canonical-arm", "thin_canonical");
const freeArm = arg("--free-arm", "thin_budgeted");
const exhaustiveArm = arg("--exhaustive-arm", "exhaustive_observation_high");
const baselineCommit = arg("--baseline-commit", "d8bc6590bc542ab7be0a0395e41d9a1bac344240");
const limit = Number(arg("--limit", "150"));
const out = arg("--out", `artifacts/accuracy-bundle-150-${Date.now()}.json`);
if (!Number.isInteger(limit) || limit < 1) throw new Error("limit_must_be_positive_integer");

const canonicalRows = readRows(canonicalPath);
const exhaustiveRows = readRows(exhaustivePath);
const canonical = canonicalRows.filter((row) => row.arm === canonicalArm && row.fields).slice(0, limit);
const freeByAsset = new Map(canonicalRows.filter((row) => row.arm === freeArm).map((row) => [row.asset_id, row]));
const observationsByAsset = new Map(exhaustiveRows.filter((row) => row.arm === exhaustiveArm)
  .map((row) => [row.asset_id, row.observations || []]));
const exact = canonical.every((row) => freeByAsset.has(row.asset_id) && observationsByAsset.has(row.asset_id));
if (canonical.length !== limit || !exact) throw new Error("bundle_cohort_mismatch_or_too_small");

const baselineCompose = await loadComposerAtCommit(baselineCommit);
const cards = canonical.map((row) => {
  const baseline = baselineCompose(row.fields);
  const free = projectFreeTitleThroughCsm(freeByAsset.get(row.asset_id).title);
  const productFields = mergeFreeEvidenceIntoCanonical(row.fields, free.fields, { only: ["product"] });
  const serial = replaySerialObservationV1(productFields, observationsByAsset.get(row.asset_id));
  let candidate = composeFromCanonicalFields(serial.fields);
  const rejectedSerialChanges = [];
  if (serial.changes.length) {
    const losses = referenceLosses(row.reference, baseline.title, candidate.title);
    if (candidate.length > 80 || losses.length) {
      rejectedSerialChanges.push(...serial.changes.map((change) => ({
        ...change,
        reason: losses.length ? "reference_token_loss" : "over_80"
      })));
      candidate = composeFromCanonicalFields(productFields);
      serial.changes.length = 0;
    }
  }
  const before = score(row.reference, baseline.title);
  const after = score(row.reference, candidate.title);
  const baselineTokens = cleanTokens(baseline.title);
  const candidateTokens = cleanTokens(candidate.title);
  const referenceTokens = cleanTokens(row.reference);
  const supportedTokens = new Set([...flattenTokens(row.fields), ...flattenTokens(free.fields), ...flattenTokens(serial.fields)]);
  const newTokens = [...candidateTokens].filter((token) => !baselineTokens.has(token));
  const rawLostReferenceTokens = [...baselineTokens].filter((token) => referenceTokens.has(token) && !candidateTokens.has(token));
  const normalizedReferenceTokens = rawLostReferenceTokens.filter((token) => /^(?:autograph|autographs|autographed|autos?)$/.test(token) && candidateTokens.has("auto"));
  const lostReferenceTokens = rawLostReferenceTokens.filter((token) => !normalizedReferenceTokens.includes(token));
  const unbackedNewTokens = newTokens.filter((token) => !supportedTokens.has(token));
  return {
    asset_id: row.asset_id,
    reference: row.reference,
    baseline_title: baseline.title,
    candidate_title: candidate.title,
    delta_f1: after.f1 - before.f1,
    baseline_score: before,
    candidate_score: after,
    product_changes: productFields.product !== row.fields.product ? [productFields.product] : [],
    serial_changes: serial.changes,
    rejected_serial_changes: rejectedSerialChanges,
    over_80: candidate.title.length > 80,
    lost_reference_tokens: lostReferenceTokens,
    unbacked_new_tokens: unbackedNewTokens
  };
});
const deltas = cards.map((card) => card.delta_f1);
const result = {
  schema_version: "accuracy-bundle-replay-v1",
  source: { canonical: canonicalPath, canonical_arm: canonicalArm, free_arm: freeArm, exhaustive: exhaustivePath, exhaustive_arm: exhaustiveArm, baseline_commit: baselineCommit, limit },
  baseline_macro_f1: mean(cards.map((card) => card.baseline_score.f1)),
  candidate_macro_f1: mean(cards.map((card) => card.candidate_score.f1)),
  delta_macro_f1: mean(deltas),
  wins: deltas.filter((value) => value > 1e-12).length,
  losses: deltas.filter((value) => value < -1e-12).length,
  ties: deltas.filter((value) => Math.abs(value) <= 1e-12).length,
  changed_cards: cards.filter((card) => card.baseline_title !== card.candidate_title).length,
  product_changed_cards: cards.filter((card) => card.product_changes.length).length,
  serial_changed_cards: cards.filter((card) => card.serial_changes.length).length,
  rejected_serial_cards: cards.filter((card) => card.rejected_serial_changes.length).length,
  over_80: cards.filter((card) => card.over_80).length,
  cards_with_lost_reference_tokens: cards.filter((card) => card.lost_reference_tokens.length).length,
  cards_with_unbacked_new_tokens: cards.filter((card) => card.unbacked_new_tokens.length).length,
  critical_wrong_proxy: cards.filter((card) => card.lost_reference_tokens.length || card.unbacked_new_tokens.length).length,
  cards_detail: cards
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, cards_detail: undefined }, null, 2));
