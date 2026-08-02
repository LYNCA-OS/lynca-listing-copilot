#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { titleDerivedSemSuggestion } from "../lib/listing/csm/title-derived-sem.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROWS = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_MANIFEST = "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.manifest.json";
const DEFAULT_EXHAUSTIVE = "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl";
const DEFAULT_JSON = "docs/evaluation/bare-canonical-complementarity-150-2026-08-02.json";
const DEFAULT_MD = "docs/evaluation/bare-canonical-complementarity-150-2026-08-02.md";
const MANIFEST_TITLE_DERIVED_SEM_COMMIT = "a3a5e352b269bb891708b2c2c63b05e8f4a0009d";

const EXPECTED = Object.freeze({
  population: 150,
  rows: 300,
  bare_arm: "thin_budgeted",
  canonical_arm: "thin_canonical_high",
  bare_wins: 44,
  canonical_wins: 95,
  ties: 11,
  selection_role: "accuracy_bundle_confirmatory_150",
  model: "gpt-5.6-luna",
  effort: "none",
  image_detail: "high"
});

const SEM_FIELD_MAP = Object.freeze({
  year: "year",
  ip: "ip_sport",
  language: "language",
  manufacturer: "manufacturer",
  product: "product",
  set: "set",
  subjects: "subject",
  team: "search_optimization",
  card_name: "card_name",
  card_number: "card_number",
  descriptive_rarity: "descriptive_rarity",
  serial: "numerical_rarity",
  release_variant: "release_variant",
  surface_color: "print_finish",
  parallel_family: "print_finish",
  parallel_exact: "print_finish",
  print_finish: "print_finish",
  attributes: "search_optimization",
  components: "search_optimization",
  grade: "grading_info",
  lot_count: "lot"
});

const FIELD_CATEGORY = Object.freeze({
  year: "identity",
  ip_sport: "identity",
  language: "identity",
  manufacturer: "identity",
  product: "identity",
  set: "identity",
  subject: "identity",
  card_name: "identity",
  release_variant: "finish_rarity",
  print_finish: "finish_rarity",
  descriptive_rarity: "finish_rarity",
  card_number: "exact_numeric",
  numerical_rarity: "exact_numeric",
  grading_info: "grading",
  search_optimization: "components",
  special_stamp: "components",
  lot: "lot"
});

const clean = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase();

export const tokens = (value) => clean(value)
  .split(/[^a-z0-9/']+/)
  .filter(Boolean);

const tokenSet = (value) => new Set(tokens(value));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const hasAll = (haystack, needles) => needles.every((token) => haystack.has(token));
const difference = (a, b) => [...a].filter((token) => !b.has(token));
const intersection = (a, b) => [...a].filter((token) => b.has(token));
const union = (a, b) => new Set([...a, ...b]);
const isNumericToken = (token) => /^(?:#?\d+(?:\/\d+)?|\d{2,4})$/.test(token);

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

function abs(path) {
  return resolve(ROOT, path);
}

function readJsonl(path) {
  return readFileSync(abs(path), "utf8").split("\n").filter(Boolean).map(JSON.parse);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(abs(path))).digest("hex");
}

function auditProjectionSource(manifest) {
  const path = "lib/listing/csm/title-derived-sem.mjs";
  const manifestSha = manifest.finisher?.contract?.source_sha256?.[`repo:${path}`];
  const currentSha = sha256(path);
  const historical = execFileSync("git", ["show", `${MANIFEST_TITLE_DERIVED_SEM_COMMIT}:${path}`], {
    cwd: ROOT,
    encoding: "utf8"
  });
  const historicalSha = createHash("sha256").update(historical).digest("hex");
  assertEqual(historicalSha, manifestSha, "historical title-derived-sem sha256");
  const diff = execFileSync("git", ["diff", "--unified=0", MANIFEST_TITLE_DERIVED_SEM_COMMIT, "--", path], {
    cwd: ROOT,
    encoding: "utf8"
  });
  const changedLines = diff.split("\n")
    .filter((line) => /^[+-](?![+-])/.test(line))
    .map((line) => line.slice(1).trim());
  const exportOnly = changedLines.length === 4
    && changedLines.filter((line) => line.startsWith("export function ")).length === 2
    && changedLines.filter((line) => /^function (gradingInfoSuggestion|printFinishSuggestion)\(/.test(line)).length === 2;
  if (!exportOnly) throw new Error("title-derived-sem drift is not export-only");
  return {
    manifest_sha256: manifestSha,
    current_sha256: currentSha,
    exact_manifest_commit: MANIFEST_TITLE_DERIVED_SEM_COMMIT,
    current_diff_from_manifest_version: "EXPORT_ONLY",
    semantic_projection_change: false,
    note: "Only gradingInfoSuggestion and printFinishSuggestion gained export keywords; function bodies and titleDerivedSemSuggestion behavior are unchanged."
  };
}

function scalarValues(value) {
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(scalarValues);
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? [text] : [];
}

function fieldEntries(fields = {}, mapping = null) {
  const ignored = new Set(["grammar", "unreadable", "low_confidence"]);
  return Object.entries(fields || {}).flatMap(([sourceField, value]) => {
    if (ignored.has(sourceField)) return [];
    const field = mapping?.[sourceField] || sourceField;
    return scalarValues(value).map((text) => ({
      source_field: sourceField,
      field,
      value: text,
      tokens: tokens(text)
    }));
  });
}

function scoreSets(referenceTokens, candidateTokens) {
  const hits = intersection(referenceTokens, candidateTokens).length;
  const recall = referenceTokens.size ? hits / referenceTokens.size : 0;
  const precision = candidateTokens.size ? hits / candidateTokens.size : 0;
  return {
    recall,
    precision,
    f1: recall + precision ? (2 * recall * precision) / (recall + precision) : 0
  };
}

export function score(reference, candidate) {
  return scoreSets(tokenSet(reference), tokenSet(candidate));
}

function sign(value, epsilon = 1e-12) {
  return value > epsilon ? "BARE_WIN" : value < -epsilon ? "CANONICAL_WIN" : "TIE";
}

function countBy(values) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
    return counts;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function appearsContiguously(source, phrase) {
  const sourceTokens = tokens(source);
  const phraseTokens = tokens(phrase);
  if (!phraseTokens.length) return false;
  return sourceTokens.some((_, start) => phraseTokens.every((token, offset) => sourceTokens[start + offset] === token));
}

function tokenDisplaySequence(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‘’ʼ]/g, "'")
    .match(/[A-Za-z0-9/']+/g) || [];
}

function usefulReferencePhrases(source, reference, usefulTokens) {
  const sourceDisplay = tokenDisplaySequence(source);
  const sourceTokens = sourceDisplay.map(clean);
  const useful = new Set(usefulTokens);
  const phrases = [];
  const usefulPositions = sourceTokens
    .map((token, index) => useful.has(token) ? index : -1)
    .filter((index) => index >= 0);
  for (let cursor = 0; cursor < usefulPositions.length;) {
    const start = usefulPositions[cursor];
    let end = start;
    let nextCursor = cursor + 1;
    while (nextCursor < usefulPositions.length) {
      const candidateEnd = usefulPositions[nextCursor];
      if (candidateEnd - end > 2) break;
      const candidate = sourceDisplay.slice(start, candidateEnd + 1).join(" ");
      if (!appearsContiguously(reference, candidate)) break;
      end = candidateEnd;
      nextCursor += 1;
    }
    const phrase = sourceDisplay.slice(start, end + 1).join(" ");
    if (appearsContiguously(reference, phrase)) phrases.push(phrase);
    cursor = Math.max(cursor + 1, nextCursor);
  }
  return [...new Map(phrases.map((phrase) => [clean(phrase), phrase])).values()];
}

function parsedCandidateEntries(title) {
  const parsed = titleDerivedSemSuggestion(title);
  return fieldEntries(parsed).filter((entry) => appearsContiguously(title, entry.value));
}

function rawBareOnlySpans(title, canonicalTokens) {
  const display = tokenDisplaySequence(title);
  const normalized = display.map(clean);
  const spans = [];
  let start = null;
  for (let index = 0; index <= normalized.length; index += 1) {
    const bareOnly = index < normalized.length && !canonicalTokens.has(normalized[index]);
    if (bareOnly && start === null) start = index;
    if (!bareOnly && start !== null) {
      spans.push(display.slice(start, index).join(" "));
      start = null;
    }
  }
  return spans.filter(Boolean);
}

function buildPhraseCandidates(bareTitle, canonicalFields, canonicalTitle) {
  const canonicalTokens = tokenSet(canonicalTitle);
  const parsed = parsedCandidateEntries(bareTitle)
    .filter((entry) => entry.tokens.some((token) => !canonicalTokens.has(token)))
    .map((entry) => ({
      phrase: entry.value,
      field: entry.field,
      provenance: "title_derived_sem"
    }));
  const rawSpans = rawBareOnlySpans(bareTitle, canonicalTokens).map((phrase) => ({
    phrase,
    field: null,
    provenance: "bare_only_span"
  }));
  const canonicalEntries = fieldEntries(canonicalFields, SEM_FIELD_MAP);
  const deduped = new Map();
  for (const candidate of [...parsed, ...rawSpans]) {
    const phraseTokens = tokens(candidate.phrase);
    if (!phraseTokens.length || phraseTokens.every((token) => canonicalTokens.has(token))) continue;
    const key = clean(candidate.phrase).replace(/\s+/g, " ").trim();
    if (!deduped.has(key) || candidate.provenance === "title_derived_sem") deduped.set(key, candidate);
  }
  return [...deduped.values()].map((candidate) => {
    const candidateTokens = tokens(candidate.phrase);
    const identityConflict = candidate.field && FIELD_CATEGORY[candidate.field] === "identity"
      ? canonicalEntries.some((entry) => entry.field === candidate.field
        && entry.tokens.length
        && !hasAll(new Set(entry.tokens), candidateTokens)
        && !hasAll(new Set(candidateTokens), entry.tokens))
      : false;
    return { ...candidate, tokens: candidateTokens, identity_conflict: identityConflict };
  });
}

function phraseSupport(candidate, reference) {
  const referenceTokens = tokenSet(reference);
  const supported = candidate.tokens.filter((token) => referenceTokens.has(token));
  return {
    exact_contiguous: appearsContiguously(reference, candidate.phrase),
    supported_tokens: supported,
    unsupported_tokens: candidate.tokens.filter((token) => !referenceTokens.has(token)),
    support: supported.length === candidate.tokens.length
      ? (appearsContiguously(reference, candidate.phrase) ? "FULL_EXACT" : "FULL_TOKEN")
      : supported.length ? "PARTIAL" : "UNSUPPORTED"
  };
}

function candidateTitleLength(canonicalTitle, selected) {
  return [canonicalTitle, ...selected.map((candidate) => candidate.phrase)].filter(Boolean).join(" ").length;
}

function phraseOracle(canonicalTitle, candidates, reference, maxLength = 80) {
  const usable = candidates.filter((candidate) => candidate.phrase && candidateTitleLength(canonicalTitle, [candidate]) <= maxLength);
  if (usable.length > 20) {
    return {
      exact: false,
      reason: "more_than_20_candidates",
      candidate_count: usable.length,
      selected: [],
      score: score(reference, canonicalTitle)
    };
  }
  let best = { score: score(reference, canonicalTitle), selected: [] };
  const visit = (index, selected) => {
    if (candidateTitleLength(canonicalTitle, selected) > maxLength) return;
    if (index === usable.length) {
      const title = [canonicalTitle, ...selected.map((candidate) => candidate.phrase)].join(" ");
      const current = score(reference, title);
      if (current.f1 > best.score.f1 + 1e-12
        || (Math.abs(current.f1 - best.score.f1) <= 1e-12 && selected.length < best.selected.length)) {
        best = { score: current, selected: [...selected] };
      }
      return;
    }
    visit(index + 1, selected);
    selected.push(usable[index]);
    visit(index + 1, selected);
    selected.pop();
  };
  visit(0, []);
  return {
    exact: true,
    candidate_count: usable.length,
    selected: best.selected.map(({ phrase, field, provenance }) => ({ phrase, field, provenance })),
    score: best.score
  };
}

function exhaustiveText(row) {
  return (row?.observations || []).map((observation) => observation.evidence).join(" ");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

export function validateCohort(rows, manifest, exhaustiveRows = []) {
  assertEqual(rows.length, EXPECTED.rows, "checkpoint row count");
  assertEqual(manifest.checkpoint_rows, EXPECTED.rows, "manifest checkpoint_rows");
  assertEqual(manifest.paired_cards, EXPECTED.population, "manifest paired_cards");
  assertEqual(manifest.contract?.cohort?.selection_role, EXPECTED.selection_role, "selection role");
  assertEqual(manifest.contract?.model, EXPECTED.model, "model");
  assertEqual(manifest.contract?.effort, EXPECTED.effort, "effort");
  assertEqual(manifest.contract?.image_detail, EXPECTED.image_detail, "image detail");
  const arms = countBy(rows.map((row) => row.arm));
  assertEqual(arms[EXPECTED.bare_arm], EXPECTED.population, "bare arm rows");
  assertEqual(arms[EXPECTED.canonical_arm], EXPECTED.population, "canonical arm rows");
  const fingerprints = new Set(rows.map((row) => row.run_fingerprint));
  assertEqual(fingerprints.size, 1, "run fingerprint count");
  assertEqual([...fingerprints][0], manifest.fingerprint, "manifest fingerprint");
  const byArm = (arm) => new Map(rows.filter((row) => row.arm === arm).map((row) => [row.asset_id, row]));
  const bare = byArm(EXPECTED.bare_arm);
  const canonical = byArm(EXPECTED.canonical_arm);
  assertEqual(bare.size, EXPECTED.population, "unique bare assets");
  assertEqual(canonical.size, EXPECTED.population, "unique canonical assets");
  for (const [assetId, bareRow] of bare) {
    const canonicalRow = canonical.get(assetId);
    if (!canonicalRow) throw new Error(`canonical pair missing for ${assetId}`);
    assertEqual(bareRow.reference, canonicalRow.reference, `reference mismatch ${assetId}`);
    assertEqual(bareRow.image_set_sha256, canonicalRow.image_set_sha256, `image mismatch ${assetId}`);
    assertEqual(bareRow.image_count, canonicalRow.image_count, `image count mismatch ${assetId}`);
    assertEqual(bareRow.model, EXPECTED.model, `bare model ${assetId}`);
    assertEqual(canonicalRow.model, EXPECTED.model, `canonical model ${assetId}`);
    assertEqual(bareRow.image_detail, EXPECTED.image_detail, `bare detail ${assetId}`);
    assertEqual(canonicalRow.image_detail, EXPECTED.image_detail, `canonical detail ${assetId}`);
    assertEqual(bareRow.request_attempt_count, 1, `bare attempts ${assetId}`);
    assertEqual(canonicalRow.request_attempt_count, 1, `canonical attempts ${assetId}`);
  }
  if (exhaustiveRows.length) {
    assertEqual(exhaustiveRows.length, EXPECTED.population, "exhaustive row count");
    assertEqual(new Set(exhaustiveRows.map((row) => row.asset_id)).size, EXPECTED.population, "unique exhaustive assets");
    for (const row of exhaustiveRows) {
      if (!bare.has(row.asset_id)) throw new Error(`exhaustive asset outside paired cohort: ${row.asset_id}`);
      assertEqual(row.reference, bare.get(row.asset_id).reference, `exhaustive reference mismatch ${row.asset_id}`);
    }
  }
  return { bare, canonical };
}

function classifyHelpfulBareToken(token, canonicalEntries, parsedEntries) {
  const rawMatches = canonicalEntries.filter((entry) => entry.tokens.includes(token));
  if (rawMatches.length) {
    return {
      cause: "CANONICAL_VALUE_PRESENT_TITLE_MISSING",
      fields: [...new Set(rawMatches.map((entry) => entry.field))]
    };
  }
  const parsedMatches = parsedEntries.filter((entry) => entry.tokens.includes(token));
  if (parsedMatches.length) {
    return {
      cause: "CANONICAL_VALUE_ABSENT_KNOWN_FIELD",
      fields: [...new Set(parsedMatches.map((entry) => entry.field))]
    };
  }
  return { cause: "PARSER_UNASSIGNED_RESIDUAL_PHRASE", fields: [] };
}

function canonicalTokenFields(token, canonicalEntries) {
  return [...new Set(canonicalEntries.filter((entry) => entry.tokens.includes(token)).map((entry) => entry.field))];
}

export function analyzeComplementarity(rows, exhaustiveRows = []) {
  const bareById = new Map(rows.filter((row) => row.arm === EXPECTED.bare_arm).map((row) => [row.asset_id, row]));
  const canonicalById = new Map(rows.filter((row) => row.arm === EXPECTED.canonical_arm).map((row) => [row.asset_id, row]));
  const exhaustiveById = new Map(exhaustiveRows.map((row) => [row.asset_id, row]));
  const ledger = [];

  for (const assetId of [...bareById.keys()].sort()) {
    const bare = bareById.get(assetId);
    const canonical = canonicalById.get(assetId);
    const referenceTokens = tokenSet(bare.reference);
    const bareTokens = tokenSet(bare.title);
    const canonicalTokens = tokenSet(canonical.title);
    const bareScore = scoreSets(referenceTokens, bareTokens);
    const canonicalScore = scoreSets(referenceTokens, canonicalTokens);
    const verdict = sign(bareScore.f1 - canonicalScore.f1);
    const canonicalEntries = fieldEntries(canonical.fields, SEM_FIELD_MAP);
    const parsedEntries = parsedCandidateEntries(bare.title);
    const exhaustive = exhaustiveById.get(assetId);
    const exhaustiveTokens = tokenSet(exhaustiveText(exhaustive));

    const helpfulBareTokens = intersection(bareTokens, referenceTokens).filter((token) => !canonicalTokens.has(token));
    const harmfulBareOnlyTokens = difference(bareTokens, union(referenceTokens, canonicalTokens));
    const helpfulCanonicalTokens = intersection(canonicalTokens, referenceTokens).filter((token) => !bareTokens.has(token));
    const harmfulCanonicalOnlyTokens = difference(canonicalTokens, union(referenceTokens, bareTokens));

    const helpfulBareDetails = helpfulBareTokens.map((token) => {
      const classified = classifyHelpfulBareToken(token, canonicalEntries, parsedEntries);
      return {
        token,
        ...classified,
        exhaustive_separate_call_support: exhaustive ? exhaustiveTokens.has(token) : null
      };
    });
    const helpfulCanonicalDetails = helpfulCanonicalTokens.map((token) => {
      const fields = canonicalTokenFields(token, canonicalEntries);
      return {
        token,
        fields,
        categories: [...new Set(fields.map((field) => FIELD_CATEGORY[field] || "other"))]
      };
    });
    const barePhrases = usefulReferencePhrases(bare.title, bare.reference, helpfulBareTokens);
    const canonicalPhrases = usefulReferencePhrases(canonical.title, bare.reference, helpfulCanonicalTokens);
    const phraseCandidates = buildPhraseCandidates(bare.title, canonical.fields || {}, canonical.title)
      .map((candidate) => ({ ...candidate, ...phraseSupport(candidate, bare.reference) }));
    const phraseCandidateTokenSet = phraseCandidates.reduce((set, candidate) => {
      candidate.tokens.forEach((token) => set.add(token));
      return set;
    }, new Set(canonicalTokens));
    const phraseOracleResult = phraseOracle(canonical.title, phraseCandidates, bare.reference);
    const rawUnionTokens = union(bareTokens, canonicalTokens);
    const labelFilteredUnion = new Set(intersection(rawUnionTokens, referenceTokens));
    const bareOnlyDisplay = difference(bareTokens, canonicalTokens);
    const unionEstimatedTitle = [canonical.title, ...bareOnlyDisplay].join(" ").trim();
    const identityConflicts = phraseCandidates.filter((candidate) => candidate.identity_conflict);
    const numericRisks = difference(bareTokens, canonicalTokens)
      .filter((token) => isNumericToken(token) && !referenceTokens.has(token));
    const reasons = [];
    for (const detail of helpfulCanonicalDetails) {
      reasons.push(...detail.categories);
    }
    if (harmfulBareOnlyTokens.length) reasons.push("bare_precision_noise");
    if (canonicalPhrases.some((phrase) => tokens(phrase).length > 1)) reasons.push("phrase_completeness");
    const categoryCounts = countBy(helpfulCanonicalDetails.flatMap((detail) => detail.categories));
    const primaryCanonicalReason = helpfulCanonicalDetails.length
      ? Object.entries(categoryCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
      : "bare_precision_only";

    ledger.push({
      asset_id: assetId,
      reference: bare.reference,
      bare_title: bare.title,
      canonical_title: canonical.title,
      verdict,
      delta_bare_minus_canonical_f1: round(bareScore.f1 - canonicalScore.f1),
      scores: { bare: bareScore, canonical: canonicalScore },
      bare_win_diagnosis: {
        helpful_bare_only_tokens: helpfulBareDetails,
        harmful_bare_only_tokens: harmfulBareOnlyTokens,
        reference_supported_complete_phrases: barePhrases,
        zero_new_helpful_tokens: helpfulBareTokens.length === 0
      },
      canonical_win_diagnosis: {
        helpful_canonical_only_tokens: helpfulCanonicalDetails,
        harmful_canonical_only_tokens: harmfulCanonicalOnlyTokens,
        bare_unsupported_tokens: difference(bareTokens, referenceTokens),
        reference_supported_complete_phrases: canonicalPhrases,
        primary_reason: primaryCanonicalReason,
        reasons: [...new Set(reasons)]
      },
      unions: {
        token_union: {
          score: scoreSets(referenceTokens, rawUnionTokens),
          added_bare_only_tokens: bareOnlyDisplay,
          added_unsupported_tokens: bareOnlyDisplay.filter((token) => !referenceTokens.has(token)),
          estimated_title_length: unionEstimatedTitle.length,
          over_80: unionEstimatedTitle.length > 80,
          numeric_risk_tokens: numericRisks
        },
        label_oracle_token_union: {
          nondeployable: true,
          score: scoreSets(referenceTokens, labelFilteredUnion)
        },
        phrase_candidate_lane: {
          production_authority: "NONE",
          candidates: phraseCandidates,
          score_if_all_candidate_tokens_admitted: scoreSets(referenceTokens, phraseCandidateTokenSet),
          identity_conflicts: identityConflicts.length,
          numeric_risk_tokens: [...new Set(phraseCandidates.flatMap((candidate) => candidate.unsupported_tokens.filter(isNumericToken)))]
        },
        label_oracle_phrase_subset_under_80: {
          nondeployable: true,
          ...phraseOracleResult
        }
      }
    });
  }

  const bareWins = ledger.filter((row) => row.verdict === "BARE_WIN");
  const canonicalWins = ledger.filter((row) => row.verdict === "CANONICAL_WIN");
  const ties = ledger.filter((row) => row.verdict === "TIE");
  assertEqual(bareWins.length, EXPECTED.bare_wins, "bare wins");
  assertEqual(canonicalWins.length, EXPECTED.canonical_wins, "canonical wins");
  assertEqual(ties.length, EXPECTED.ties, "ties");

  const bareScores = ledger.map((row) => row.scores.bare.f1);
  const canonicalScores = ledger.map((row) => row.scores.canonical.f1);
  const labelOracleScores = ledger.map((row) => Math.max(row.scores.bare.f1, row.scores.canonical.f1));
  const tokenUnionScores = ledger.map((row) => row.unions.token_union.score.f1);
  const labelUnionScores = ledger.map((row) => row.unions.label_oracle_token_union.score.f1);
  const phraseUnionScores = ledger.map((row) => row.unions.phrase_candidate_lane.score_if_all_candidate_tokens_admitted.f1);
  const phraseOracleScores = ledger.map((row) => row.unions.label_oracle_phrase_subset_under_80.score.f1);

  const helpfulBareDetails = bareWins.flatMap((row) => row.bare_win_diagnosis.helpful_bare_only_tokens);
  const helpfulCanonicalDetails = canonicalWins.flatMap((row) => row.canonical_win_diagnosis.helpful_canonical_only_tokens);
  const phraseCandidates = ledger.flatMap((row) => row.unions.phrase_candidate_lane.candidates);
  const exactPhraseOracle = ledger.every((row) => row.unions.label_oracle_phrase_subset_under_80.exact);

  const causeCardCounts = Object.fromEntries([...new Set(helpfulBareDetails.map((detail) => detail.cause))].map((cause) => [
    cause,
    bareWins.filter((row) => row.bare_win_diagnosis.helpful_bare_only_tokens.some((detail) => detail.cause === cause)).length
  ]));
  const causeOccurrenceCounts = countBy(helpfulBareDetails.map((detail) => detail.cause));
  const exhaustiveSupported = helpfulBareDetails.filter((detail) => detail.exhaustive_separate_call_support === true).length;
  const exhaustiveMeasured = helpfulBareDetails.filter((detail) => detail.exhaustive_separate_call_support !== null).length;
  const exhaustiveByCause = Object.fromEntries([...new Set(helpfulBareDetails.map((detail) => detail.cause))].map((cause) => {
    const items = helpfulBareDetails.filter((detail) => detail.cause === cause
      && detail.exhaustive_separate_call_support !== null);
    const supported = items.filter((detail) => detail.exhaustive_separate_call_support).length;
    return [cause, {
      supported_occurrences: supported,
      measured_occurrences: items.length,
      rate: items.length ? round(supported / items.length) : null
    }];
  }));

  return {
    schema_version: "bare-canonical-complementarity-audit-v1",
    generated_at: new Date().toISOString(),
    deployment_boundary: {
      production_selector: false,
      reference_used_only_for_offline_diagnosis: true,
      provider_calls: 0,
      production_changes: 0,
      note: "All oracle selections and support labels use the reviewed reference and are nondeployable. Candidate phrases have no CSM, Composer, persistence, or production authority."
    },
    cohort: {
      cards: ledger.length,
      bare_arm: EXPECTED.bare_arm,
      canonical_arm: EXPECTED.canonical_arm,
      model: EXPECTED.model,
      effort: EXPECTED.effort,
      image_detail: EXPECTED.image_detail,
      independent_response_draws: true,
      exhaustive_is_separate_open_prompt_call: Boolean(exhaustiveRows.length)
    },
    headline: {
      bare: { macro_f1: round(mean(bareScores)) },
      canonical: { macro_f1: round(mean(canonicalScores)) },
      pair_signs: { bare_wins: bareWins.length, canonical_wins: canonicalWins.length, ties: ties.length },
      label_oracle_between_two_independent_draws: {
        macro_f1: round(mean(labelOracleScores)),
        gain_over_canonical: round(mean(labelOracleScores) - mean(canonicalScores)),
        gain_over_bare: round(mean(labelOracleScores) - mean(bareScores)),
        nondeployable: true
      }
    },
    bare_win_44: {
      helpful_token_occurrences: helpfulBareDetails.length,
      cards_with_zero_new_helpful_tokens: bareWins.filter((row) => row.bare_win_diagnosis.zero_new_helpful_tokens).length,
      cause_occurrences: causeOccurrenceCounts,
      cause_cards: causeCardCounts,
      field_occurrences: countBy(helpfulBareDetails.flatMap((detail) => detail.fields.length ? detail.fields : ["residual_unassigned"])),
      complete_phrase_occurrences: bareWins.reduce((sum, row) => sum + row.bare_win_diagnosis.reference_supported_complete_phrases.length, 0),
      exhaustive_separate_call_support: {
        supported_occurrences: exhaustiveSupported,
        measured_occurrences: exhaustiveMeasured,
        rate: exhaustiveMeasured ? round(exhaustiveSupported / exhaustiveMeasured) : null,
        by_cause: exhaustiveByCause,
        same_call_proof: false
      }
    },
    canonical_win_95: {
      helpful_token_occurrences: helpfulCanonicalDetails.length,
      field_occurrences: countBy(helpfulCanonicalDetails.flatMap((detail) => detail.fields.length ? detail.fields : ["composition_only"])),
      reason_cards: countBy(canonicalWins.flatMap((row) => row.canonical_win_diagnosis.reasons)),
      primary_reason_cards: countBy(canonicalWins.map((row) => row.canonical_win_diagnosis.primary_reason)),
      cards_with_zero_new_helpful_tokens: canonicalWins.filter((row) => !row.canonical_win_diagnosis.helpful_canonical_only_tokens.length).length,
      cards_with_bare_precision_noise: canonicalWins.filter((row) => row.canonical_win_diagnosis.bare_unsupported_tokens.length).length,
      bare_unsupported_token_occurrences: canonicalWins.reduce((sum, row) => sum + row.canonical_win_diagnosis.bare_unsupported_tokens.length, 0)
    },
    unions: {
      token_union: {
        macro_f1: round(mean(tokenUnionScores)),
        delta_vs_canonical: round(mean(tokenUnionScores) - mean(canonicalScores)),
        wins_losses_ties_vs_canonical: countBy(ledger.map((row) => sign(row.unions.token_union.score.f1 - row.scores.canonical.f1))),
        cards_over_80_estimate: ledger.filter((row) => row.unions.token_union.over_80).length,
        cards_with_added_unsupported_tokens: ledger.filter((row) => row.unions.token_union.added_unsupported_tokens.length).length,
        added_unsupported_token_occurrences: ledger.reduce((sum, row) => sum + row.unions.token_union.added_unsupported_tokens.length, 0),
        cards_with_numeric_risk: ledger.filter((row) => row.unions.token_union.numeric_risk_tokens.length).length,
        deployable: false
      },
      label_oracle_token_union: {
        macro_f1: round(mean(labelUnionScores)),
        delta_vs_canonical: round(mean(labelUnionScores) - mean(canonicalScores)),
        nondeployable: true
      },
      raw_phrase_candidate_union: {
        macro_f1: round(mean(phraseUnionScores)),
        delta_vs_canonical: round(mean(phraseUnionScores) - mean(canonicalScores)),
        candidate_occurrences: phraseCandidates.length,
        support_occurrences: countBy(phraseCandidates.map((candidate) => candidate.support)),
        cards_with_identity_conflicts: ledger.filter((row) => row.unions.phrase_candidate_lane.identity_conflicts).length,
        cards_with_numeric_risk: ledger.filter((row) => row.unions.phrase_candidate_lane.numeric_risk_tokens.length).length,
        production_authority: "NONE"
      },
      label_oracle_phrase_subset_under_80: {
        macro_f1: round(mean(phraseOracleScores)),
        delta_vs_canonical: round(mean(phraseOracleScores) - mean(canonicalScores)),
        exact_for_all_cards: exactPhraseOracle,
        nondeployable: true
      }
    },
    same_call_residual_slot: {
      verdict: "TESTABLE_NOT_PROVEN",
      cards_with_composer_only_recovery: causeCardCounts.CANONICAL_VALUE_PRESENT_TITLE_MISSING || 0,
      cards_with_known_field_capture_target: causeCardCounts.CANONICAL_VALUE_ABSENT_KNOWN_FIELD || 0,
      cards_with_parser_unassigned_phrase_target: causeCardCounts.PARSER_UNASSIGNED_RESIDUAL_PHRASE || 0,
      cards_with_no_new_helpful_token: bareWins.filter((row) => row.bare_win_diagnosis.zero_new_helpful_tokens).length,
      reason: "The two arms are independent response draws with different output contracts. They prove complement exists, not that an added slot in the canonical response preserves either arm. A same-response, no-authority residual slot is the minimum paid experiment."
    },
    ledger
  };
}

function pct(value) {
  return `${(100 * value).toFixed(1)}%`;
}

function tableRows(object) {
  return Object.entries(object || {}).map(([key, value]) => `| ${key} | ${value} |`).join("\n") || "| none | 0 |";
}

function mdCell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ") || "—";
}

function causeLabel(cause) {
  return ({
    CANONICAL_VALUE_PRESENT_TITLE_MISSING: "field→Composer",
    CANONICAL_VALUE_ABSENT_KNOWN_FIELD: "known-field miss",
    PARSER_UNASSIGNED_RESIDUAL_PHRASE: "parser-unassigned"
  })[cause] || cause;
}

function bareWinRows(result) {
  return result.ledger.filter((row) => row.verdict === "BARE_WIN").map((row) => {
    const helpful = row.bare_win_diagnosis.helpful_bare_only_tokens.map((item) => {
      const fields = item.fields.length ? ` [${item.fields.join("+")}]` : "";
      return `${item.token}→${causeLabel(item.cause)}${fields}`;
    }).join("; ") || "无新增正确词";
    return `| ${mdCell(row.asset_id.replace(/^reviewed_blind_/, ""))} | ${row.delta_bare_minus_canonical_f1 >= 0 ? "+" : ""}${row.delta_bare_minus_canonical_f1} | ${mdCell(row.bare_win_diagnosis.reference_supported_complete_phrases.join("; "))} | ${mdCell(helpful)} | ${mdCell(row.bare_win_diagnosis.harmful_bare_only_tokens.join(" "))} |`;
  }).join("\n");
}

function canonicalWinRows(result) {
  return result.ledger.filter((row) => row.verdict === "CANONICAL_WIN").map((row) => {
    const helpful = row.canonical_win_diagnosis.helpful_canonical_only_tokens.map((item) => {
      const fields = item.fields.length ? ` [${item.fields.join("+")}]` : "";
      return `${item.token}${fields}`;
    }).join("; ") || "—";
    return `| ${mdCell(row.asset_id.replace(/^reviewed_blind_/, ""))} | ${row.delta_bare_minus_canonical_f1} | ${mdCell(row.canonical_win_diagnosis.reference_supported_complete_phrases.join("; "))} | ${mdCell(helpful)} | ${mdCell(row.canonical_win_diagnosis.reasons.join("; "))} | ${row.canonical_win_diagnosis.bare_unsupported_tokens.length} |`;
  }).join("\n");
}

export function renderMarkdown(result, sources) {
  const h = result.headline;
  const b = result.bare_win_44;
  const c = result.canonical_win_95;
  const u = result.unions;
  return `# Bare 与 canonical 互补性审计（fresh150）

## 结论

反方假设先成立：\`44\` 张 bare 胜利不能直接说明“放开输出就会更准”，因为这是两个独立模型响应，里面混有采样波动；raw token union 还会把错误数字和身份一起带入。审计后的高置信结论是：**互补信息真实存在，但只能先进入无生产权限的候选槽，不能自动并入 CSM。**

canonical 的宏 F1 为 **${h.canonical.macro_f1}**，bare 为 **${h.bare.macro_f1}**。逐卡使用 reference 在两者之间选优的理论上限为 **${h.label_oracle_between_two_independent_draws.macro_f1}**（较 canonical +${h.label_oracle_between_two_independent_draws.gain_over_canonical}），但这是不可部署的 label oracle。

## 口径与范围

- cohort 是同一批 150 张卡、同一图像集合、同一 \`gpt-5.6-luna / reasoning none / high\` 配置的两个 arm；每张都只有 1 次 provider attempt。
- bare 与 canonical 是两次独立响应，不是同一响应的两个投影。F1 是 reference 与标题的去重 token precision/recall 调和均值；44/95/11 是逐卡 F1 符号。
- “正确新增词”定义为 \`(bare ∩ reference) \\ canonical\`；“错误新增词”定义为 \`bare \\ (reference ∪ canonical)\`。字段归因先查 canonical raw fields，再查 title-derived SEM；后者只是候选，不是语义真值。
- manifest 对应的 \`title-derived-sem\` 已从 git history 找回并核对；当前版本只给两个既有 helper 增加 \`export\`，函数体与 projection 行为未变。哈希与 diff 结论保存在 ledger 的 \`source_compatibility\`。
- 没画汇总图：本任务的核心是多标签归因和逐卡异常，精确审计表比单轴图更不容易掩盖数字/身份冲突。

## 44 张 bare 胜在什么

44 张里共有 **${b.helpful_token_occurrences}** 个“bare 命中 reference、canonical 标题没有”的词次；其中 **${b.cards_with_zero_new_helpful_tokens}** 张没有新增正确词，只是精度、顺序或复数差异，不属于 residual recall。

| 最早丢失边界 | 正确词次 |
|---|---:|
${tableRows(b.cause_occurrences)}

| 候选 CSM/SEM 字段 | 正确词次 |
|---|---:|
${tableRows(b.field_occurrences)}

另一次 exhaustive/open prompt 对这些正确词次的复现率是 **${b.exhaustive_separate_call_support.rate == null ? "未测" : pct(b.exhaustive_separate_call_support.rate)}**（${b.exhaustive_separate_call_support.supported_occurrences}/${b.exhaustive_separate_call_support.measured_occurrences}）。这只能证明“不同提示下可重复看见”，不能证明 canonical 同次调用加槽后仍会看见。

| 最早边界 | exhaustive 再现 | 再现率 |
|---|---:|---:|
${Object.entries(b.exhaustive_separate_call_support.by_cause).map(([cause, item]) => `| ${cause} | ${item.supported_occurrences}/${item.measured_occurrences} | ${item.rate == null ? "—" : pct(item.rate)} |`).join("\n")}

## 95 张 canonical 胜在什么

canonical 独有且命中 reference 的词次共 **${c.helpful_token_occurrences}**；与此同时，bare 在这 95 张中有 **${c.bare_unsupported_token_occurrences}** 个 reference 不支持的词，涉及 **${c.cards_with_bare_precision_noise}** 张。也就是说 canonical 的优势不是单纯“更保守”，而是结构化字段补全与抑制自由表达噪声同时发生。

其中 **${c.cards_with_zero_new_helpful_tokens}** 张 canonical 没增加任何正确 token，胜利完全来自压掉 bare 噪声；另外 ${95 - c.cards_with_zero_new_helpful_tokens} 张同时有结构化补全。下面第一张表是互斥主因，合计严格等于 95；第二张表是可多选原因。

| 互斥主因 | 卡数 |
|---|---:|
${tableRows(c.primary_reason_cards)}

| 原因（可多选） | 卡数 |
|---|---:|
${tableRows(c.reason_cards)}

| canonical 来源字段 | 正确词次 |
|---|---:|
${tableRows(c.field_occurrences)}

## Union 上限与风险

| 机制 | 宏 F1 | 相对 canonical | 权限 / 风险 |
|---|---:|---:|---|
| raw token union | ${u.token_union.macro_f1} | ${u.token_union.delta_vs_canonical >= 0 ? "+" : ""}${u.token_union.delta_vs_canonical} | 不可部署；${u.token_union.cards_with_added_unsupported_tokens} 张新增错误词，${u.token_union.cards_with_numeric_risk} 张数字风险，${u.token_union.cards_over_80_estimate} 张估算超过 80 字符 |
| label-filtered token union | ${u.label_oracle_token_union.macro_f1} | +${u.label_oracle_token_union.delta_vs_canonical} | reference oracle，仅理论覆盖上限 |
| 全量 phrase candidates 直接并入 | ${u.raw_phrase_candidate_union.macro_f1} | ${u.raw_phrase_candidate_union.delta_vs_canonical >= 0 ? "+" : ""}${u.raw_phrase_candidate_union.delta_vs_canonical} | 禁止；${u.raw_phrase_candidate_union.cards_with_identity_conflicts} 张身份冲突，${u.raw_phrase_candidate_union.cards_with_numeric_risk} 张数字风险 |
| 80 字符内 phrase subset label oracle | ${u.label_oracle_phrase_subset_under_80.macro_f1} | +${u.label_oracle_phrase_subset_under_80.delta_vs_canonical} | reference oracle；全卡精确搜索=${u.label_oracle_phrase_subset_under_80.exact_for_all_cards} |

raw union 的结果给出反证：**“让两边都说，再把词拼起来”不是正资产机制。** 可保留的是 phrase-aware、带字段角色和 provenance 的 candidate lane；它必须默认零权限，再由 SEM/世界模型做证据解析。

## 同次 canonical 调用的自由观察槽

结论：**${result.same_call_residual_slot.verdict}**。

- ${result.same_call_residual_slot.cards_with_composer_only_recovery} 张触及“字段已有、Composer 没发”，应先走零调用 Composer/SEM 修复，根本不需要新模型槽。
- ${result.same_call_residual_slot.cards_with_known_field_capture_target} 张触及“可映射字段但 canonical 没给”，是短语候选槽的主要目标。
- ${result.same_call_residual_slot.cards_with_parser_unassigned_phrase_target} 张触及“当前 parser 没分配角色的 residual phrase”。它们不等于 CSM 外字段：\`Star Wars\`、\`Disney\`、\`Trainer Gallery\` 等正说明 phrase-aware resolver 仍有缺口；在解析前只能进 append-only evidence。
- ${result.same_call_residual_slot.cards_with_no_new_helpful_token} 张 bare 胜利没有新增正确词，新增槽无法保证拿回。

最小可证伪实验不是第二调用，而是 canonical 同一响应增加一个严格有界、独立、无生产权限的 \`residual_phrases[]\`：每项只含完整短语、图像区域、候选角色、可见/推断 provenance 与置信度。先在现有 raw response 上做零调用 resolver replay；只有候选覆盖和冲突门槛通过，才进入 fresh150 的 5–8 机制合并实测。

## 稳健性与未决问题

- exact checkpoint SHA、字节数、manifest fingerprint、配对 asset/reference/image hash、arm 数量和 attempt 数都 fail closed；任何 cohort 漂移都会终止脚本。
- exhaustive 复现率不是 sensitivity control：它来自第三次、且提示更开放的响应，只能说明候选可见性。
- label oracle 选择依赖 reference；真实系统没有这个信息。0.794114 不能作为上线预期，只能作为“两个独立 draw 的样本内天花板”。
- title-derived SEM 会误分角色（例如把相邻介词吞进 subject）；因此本报告只用它做候选归因，绝不自动 admission。

## 建议的下一步

1. 先取回 24 张字段已有但 Composer 没发的卡：这是零调用、低耦合机制。
2. 用完整短语做 phrase-aware resolver 回放，重点覆盖 \`Star Wars\`、\`Disney\`、\`Trainer Gallery\`、球队城市、完整 product/set 层级；数字冲突一律 fail closed。
3. 只有上述回放仍无法触达的 7 张 parser-unassigned 卡，才进入同次响应 \`residual_phrases[]\` 小机制；槽位零生产权限且必须有 region/provenance。
4. 该机制与其他 5–8 个正资产候选攒齐后，再跑 fresh150；独立验证它是否保持 canonical 字段质量，而不是用两个独立 draw 的 oracle 代替实测。

## 44 张 bare 胜利逐卡明细

| asset 后缀 | ΔF1（bare-canonical） | reference 支持的完整短语 | 新增正确词与最早边界 | bare 新增错误词 |
|---|---:|---|---|---|
${bareWinRows(result)}

## 95 张 canonical 胜利逐卡明细

| asset 后缀 | ΔF1（bare-canonical） | canonical 独有完整短语 | canonical 独有正确词与字段 | 原因 | bare 错误词数 |
|---|---:|---|---|---|---:|
${canonicalWinRows(result)}

## 硬边界

- reference 只用于离线诊断和 oracle；没有构造任何可部署 selector。
- phrase candidate 不得写 CSM、Composer、Supabase 或生产标题。
- exhaustive 是另一条 open prompt 调用，只是复现证据，不是 same-call 证据。
- 本次 provider 调用 0，生产改动 0。

## 数据与逐卡账本

- 配对数据：\`${sources.rows}\`
- manifest：\`${sources.manifest}\`
- exhaustive 复现证据：\`${sources.exhaustive}\`
- 逐卡 ledger：\`${sources.output_json}\`（150 张；含 44/95/11 全部明细）
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const rowsPath = argValue(argv, "--rows", DEFAULT_ROWS);
  const manifestPath = argValue(argv, "--manifest", DEFAULT_MANIFEST);
  const exhaustivePath = argValue(argv, "--exhaustive", DEFAULT_EXHAUSTIVE);
  const outputJson = argValue(argv, "--out-json", DEFAULT_JSON);
  const outputMd = argValue(argv, "--out-md", DEFAULT_MD);
  const rows = readJsonl(rowsPath);
  const manifest = JSON.parse(readFileSync(abs(manifestPath), "utf8"));
  const exhaustiveRows = exhaustivePath === "none" ? [] : readJsonl(exhaustivePath);
  assertEqual(sha256(rowsPath), manifest.checkpoint_sha256, "checkpoint sha256");
  assertEqual(readFileSync(abs(rowsPath)).byteLength, manifest.checkpoint_bytes, "checkpoint bytes");
  validateCohort(rows, manifest, exhaustiveRows);
  const result = analyzeComplementarity(rows, exhaustiveRows);
  result.source_compatibility = auditProjectionSource(manifest);
  result.sources = {
    rows: rowsPath,
    rows_sha256: sha256(rowsPath),
    manifest: manifestPath,
    manifest_sha256: sha256(manifestPath),
    exhaustive: exhaustivePath,
    exhaustive_sha256: exhaustivePath === "none" ? null : sha256(exhaustivePath)
  };
  writeFileSync(abs(outputJson), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(abs(outputMd), renderMarkdown(result, {
    rows: rowsPath,
    manifest: manifestPath,
    exhaustive: exhaustivePath,
    output_json: outputJson
  }));
  process.stdout.write(`${JSON.stringify({
    output_json: outputJson,
    output_md: outputMd,
    headline: result.headline,
    bare_win_44: result.bare_win_44,
    canonical_win_95: result.canonical_win_95,
    unions: result.unions,
    same_call_residual_slot: result.same_call_residual_slot
  }, null, 2)}\n`);
}
