#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const REQUIRED_FIELDS = [
  "id",
  "generated_title",
  "corrected_title",
  "front_image_url",
  "back_image_url",
  "operator_id",
  "created_at"
];

const CHANGE_TYPES = [
  "product",
  "set",
  "insert",
  "parallel",
  "serial",
  "player_subject",
  "auto_relic_patch",
  "grade",
  "wording_normalization"
];

const DECISION_OPTIONS = [
  "Accept as registry rule",
  "Accept as resolver rule",
  "Accept as prompt rule",
  "Ignore",
  "Needs more evidence"
];

const SAFETY_NOTE = [
  "Offline review candidates only.",
  "No raw feedback mutation.",
  "No automatic approval.",
  "No registry, resolver, prompt, or test writes."
].join(" ");

const args = parseArgs(process.argv.slice(2));

if (!args.inputPath) {
  printUsage();
  process.exit(1);
}

const inputPath = path.resolve(args.inputPath);
const outputDir = path.resolve(args.outputDir || "data/learning");
const runDate = args.date || new Date().toISOString().slice(0, 10);

const rawText = await fs.readFile(inputPath, "utf8");
const feedbackRows = parseFeedbackExport(rawText, inputPath);
const normalizedRows = feedbackRows.map(normalizeFeedbackRow);
const validation = validateRows(normalizedRows);

if (validation.errors.length > 0) {
  console.error("Cannot process feedback export:");
  for (const error of validation.errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const processedRows = normalizedRows
  .filter((row) => row.generated_title.trim() !== row.corrected_title.trim())
  .map(processFeedbackRow);

const candidates = buildReviewCandidates(processedRows);

await fs.mkdir(outputDir, { recursive: true });

const baseName = `review-candidates-${runDate}`;
const jsonPath = path.join(outputDir, `${baseName}.json`);
const mdPath = path.join(outputDir, `${baseName}.md`);

const jsonOutput = {
  schema_version: "learning-review-v2.1",
  generated_at: new Date().toISOString(),
  input_file: inputPath,
  output_date: runDate,
  safety_note: SAFETY_NOTE,
  required_input_fields: REQUIRED_FIELDS,
  supported_change_types: CHANGE_TYPES,
  total_input_rows: normalizedRows.length,
  changed_feedback_rows: processedRows.length,
  skipped_unchanged_rows: normalizedRows.length - processedRows.length,
  candidate_count: candidates.length,
  candidates
};

await fs.writeFile(jsonPath, `${JSON.stringify(jsonOutput, null, 2)}\n`);
await fs.writeFile(mdPath, renderMarkdown(jsonOutput));

console.log(`Processed ${normalizedRows.length} feedback rows.`);
console.log(`Created ${candidates.length} review candidates.`);
console.log(`JSON: ${path.relative(process.cwd(), jsonPath)}`);
console.log(`Markdown: ${path.relative(process.cwd(), mdPath)}`);

function parseArgs(argv) {
  const parsed = {
    inputPath: "",
    outputDir: "",
    date: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--out-dir") {
      parsed.outputDir = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--date") {
      parsed.date = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (!parsed.inputPath) {
      parsed.inputPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.date && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) {
    throw new Error("--date must use YYYY-MM-DD format");
  }

  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  node scripts/v2-learning-review.mjs <supabase-export.csv|json> [--out-dir data/learning] [--date YYYY-MM-DD]

Output:
  data/learning/review-candidates-YYYY-MM-DD.json
  data/learning/review-candidates-YYYY-MM-DD.md

This is an offline admin review tool. It does not mutate feedback, registry, resolver, prompt, or test files.
`.trim());
}

function parseFeedbackExport(text, filePath) {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".json" || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (Array.isArray(parsed.data)) {
      return parsed.data;
    }
    if (Array.isArray(parsed.rows)) {
      return parsed.rows;
    }
    if (Array.isArray(parsed.records)) {
      return parsed.records;
    }
    throw new Error("JSON export must be an array or contain a data, rows, or records array.");
  }

  return parseCsv(trimmed);
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);

  const [headerRow, ...dataRows] = rows.filter((csvRow) => csvRow.some((value) => value.trim() !== ""));
  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map((header) => header.trim());
  return dataRows.map((csvRow) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = csvRow[index] ?? "";
    });
    return record;
  });
}

function normalizeFeedbackRow(row, index) {
  const normalized = {};

  for (const field of REQUIRED_FIELDS) {
    normalized[field] = row[field] == null ? "" : String(row[field]);
  }

  if (!normalized.id) {
    normalized.id = `row-${index + 1}`;
  }

  return normalized;
}

function validateRows(rows) {
  const errors = [];

  rows.forEach((row, index) => {
    for (const field of REQUIRED_FIELDS) {
      if (field === "back_image_url") {
        continue;
      }
      if (!row[field]) {
        errors.push(`row ${index + 1} is missing ${field}`);
      }
    }
  });

  return { errors };
}

function processFeedbackRow(row) {
  const diff = diffTitles(row.generated_title, row.corrected_title);
  const changes = diffToChanges(diff);
  const changedText = [
    ...changes.added_phrases,
    ...changes.removed_phrases,
    ...changes.replacements.map((replacement) => `${replacement.from} ${replacement.to}`)
  ].join(" ");

  return {
    ...row,
    diff,
    changes,
    likely_change_types: detectChangeTypes(row.generated_title, row.corrected_title, changedText)
  };
}

function tokenizeTitle(title) {
  return title.match(/[A-Za-z0-9]+(?:['.-][A-Za-z0-9]+)*|#?\d+\/\d+|\/\d+|[^\s]/g) || [];
}

function normalizeToken(token) {
  return token.toLowerCase().replace(/[^\p{L}\p{N}/#]+/gu, "");
}

function diffTitles(generatedTitle, correctedTitle) {
  const generated = tokenizeTitle(generatedTitle);
  const corrected = tokenizeTitle(correctedTitle);
  const lcs = Array.from({ length: generated.length + 1 }, () => Array(corrected.length + 1).fill(0));

  for (let i = generated.length - 1; i >= 0; i -= 1) {
    for (let j = corrected.length - 1; j >= 0; j -= 1) {
      if (normalizeToken(generated[i]) === normalizeToken(corrected[j])) {
        lcs[i][j] = lcs[i + 1][j + 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
  }

  const operations = [];
  let i = 0;
  let j = 0;

  while (i < generated.length && j < corrected.length) {
    if (normalizeToken(generated[i]) === normalizeToken(corrected[j])) {
      operations.push({ type: "equal", token: generated[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      operations.push({ type: "removed", token: generated[i] });
      i += 1;
    } else {
      operations.push({ type: "added", token: corrected[j] });
      j += 1;
    }
  }

  while (i < generated.length) {
    operations.push({ type: "removed", token: generated[i] });
    i += 1;
  }

  while (j < corrected.length) {
    operations.push({ type: "added", token: corrected[j] });
    j += 1;
  }

  return operations;
}

function diffToChanges(diff) {
  const removedPhrases = [];
  const addedPhrases = [];
  const replacements = [];
  let removed = [];
  let added = [];

  function flush() {
    const removedPhrase = cleanPhrase(removed.join(" "));
    const addedPhrase = cleanPhrase(added.join(" "));

    if (removedPhrase && addedPhrase) {
      replacements.push({ from: removedPhrase, to: addedPhrase });
    } else if (removedPhrase) {
      removedPhrases.push(removedPhrase);
    } else if (addedPhrase) {
      addedPhrases.push(addedPhrase);
    }

    removed = [];
    added = [];
  }

  for (const operation of diff) {
    if (operation.type === "removed") {
      removed.push(operation.token);
    } else if (operation.type === "added") {
      added.push(operation.token);
    } else {
      flush();
    }
  }

  flush();

  return {
    removed_phrases: uniqueStrings(removedPhrases),
    added_phrases: uniqueStrings(addedPhrases),
    replacements,
    normalized_generated_title: normalizeTitleForGrouping(diff.filter((operation) => operation.type !== "added").map((operation) => operation.token).join(" ")),
    normalized_corrected_title: ""
  };
}

function cleanPhrase(value) {
  return value
    .replace(/\s+([,.:;!?])/g, "$1")
    .replace(/([#/])\s+/g, "$1")
    .replace(/\s+([#/])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleForGrouping(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}/#]+/gu, " ").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function detectChangeTypes(generatedTitle, correctedTitle, changedText) {
  const joined = `${generatedTitle} ${correctedTitle} ${changedText}`;
  const changed = changedText.toLowerCase();
  const full = joined.toLowerCase();
  const types = new Set();

  if (/\b(panini|topps|bowman|upper deck|donruss|prizm|select|optic|mosaic|chrome|finest|immaculate|national treasures|flawless|pokemon|one piece|magic|futera)\b/i.test(changedText)) {
    types.add("product");
  }

  if (/\b(19|20)\d{2}(?:[-/]\d{2})?\b/.test(changedText) || /\b(set|series|sapphire|draft|update|heritage|dynasty|merlin|uefa|nba|nfl|mlb|wnba|tcg)\b/i.test(changedText)) {
    types.add("set");
  }

  if (/\b(kaboom|downtown|color blast|stained glass|ultraviolet|manga|case hit|rookie|rc|ssp|insert|die[- ]?cut|case[- ]?hit|black color blast|explosive|helix|shadow etch)\b/i.test(changedText)) {
    types.add("insert");
  }

  if (/\b(refractor|parallel|wave|raywave|mojo|sparkle|shimmer|cracked ice|pulsar|scope|disco|laser|velocity|checkerboard|geometric|gold|silver|orange|red|blue|green|purple|pink|fuchsia|aqua|black|white|zebra|tiger|elephant|genesis|holo|hyper|ice|prizm)\b/i.test(changedText)) {
    types.add("parallel");
  }

  if (/(^|\s)(?:#?\d+\s*)?\/\s*\d+\b|(^|\s)#?\d+\s*\/\s*\d+\b|\b(serial|numbered|s\/n|short print|ssp)\b/i.test(changedText)) {
    types.add("serial");
  }

  if (/\b(auto|autograph|signature|signed|relic|patch|jersey|memorabilia|rpa|logoman|laundry tag|booklet|dual auto|triple auto)\b/i.test(changedText)) {
    types.add("auto_relic_patch");
  }

  if (/\b(psa|bgs|beckett|cgc|sgc|tag|gem mint|mint|pristine|black label|authentic|grade|graded|10|9\.5|9|8\.5|8)\b/i.test(changedText) && /\b(psa|bgs|beckett|cgc|sgc|tag|gem mint|mint|pristine|black label|authentic|grade|graded)\b/i.test(full)) {
    types.add("grade");
  }

  if (looksLikeWordingNormalization(generatedTitle, correctedTitle)) {
    types.add("wording_normalization");
  }

  if (looksLikeSubjectChange(changedText, types)) {
    types.add("player_subject");
  }

  if (types.size === 0) {
    types.add("wording_normalization");
  }

  return CHANGE_TYPES.filter((type) => types.has(type));
}

function looksLikeWordingNormalization(generatedTitle, correctedTitle) {
  const generatedLower = generatedTitle.toLowerCase();
  const correctedLower = correctedTitle.toLowerCase();
  const generatedBag = normalizeTitleForGrouping(generatedTitle).split(" ").sort().join(" ");
  const correctedBag = normalizeTitleForGrouping(correctedTitle).split(" ").sort().join(" ");

  return generatedLower !== correctedLower && (
    generatedBag === correctedBag ||
    normalizeTitleForGrouping(generatedTitle) === normalizeTitleForGrouping(correctedTitle)
  );
}

function looksLikeSubjectChange(changedText, existingTypes) {
  if (!changedText || existingTypes.has("grade")) {
    return false;
  }

  const withoutKnownTerms = changedText.replace(/\b(panini|topps|bowman|upper deck|donruss|prizm|select|optic|mosaic|chrome|refractor|parallel|wave|raywave|mojo|sparkle|gold|silver|orange|red|blue|green|purple|pink|fuchsia|aqua|black|white|auto|autograph|patch|jersey|relic|psa|bgs|cgc|sgc|gem mint|rookie|rc|serial|numbered)\b/gi, "");
  const nameLikeMatches = withoutKnownTerms.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];

  return nameLikeMatches.length > 0;
}

function buildReviewCandidates(rows) {
  const groups = new Map();

  for (const row of rows) {
    addPatternGroups(groups, row);
  }

  return [...groups.values()]
    .map((group) => finalizeCandidate(group))
    .filter((candidate) => candidate.pattern_type !== "repeated_corrected_phrase" || candidate.evidence_count > 1)
    .sort((a, b) => {
      if (b.evidence_count !== a.evidence_count) {
        return b.evidence_count - a.evidence_count;
      }
      return a.pattern_key.localeCompare(b.pattern_key);
    })
    .map((candidate, index) => ({
      candidate_id: `learn-${String(index + 1).padStart(4, "0")}`,
      ...candidate
    }));
}

function addPatternGroups(groups, row) {
  const changes = row.changes;
  const fallbackKey = `single_correction:${row.id}`;
  let addedAny = false;

  for (const phrase of changes.removed_phrases) {
    addToGroup(groups, `same_removed_phrase:${normalizeTitleForGrouping(phrase)}`, "same_removed_phrase", phrase, row);
    addedAny = true;
  }

  for (const phrase of changes.added_phrases) {
    addToGroup(groups, `same_added_phrase:${normalizeTitleForGrouping(phrase)}`, "same_added_phrase", phrase, row);
    addedAny = true;
  }

  for (const replacement of changes.replacements) {
    const label = `${replacement.from} -> ${replacement.to}`;
    const key = `same_replacement_phrase:${normalizeTitleForGrouping(replacement.from)}=>${normalizeTitleForGrouping(replacement.to)}`;
    addToGroup(groups, key, "same_replacement_phrase", label, row);
    addedAny = true;
  }

  if (!addedAny) {
    addToGroup(groups, fallbackKey, "single_correction", `${row.generated_title} -> ${row.corrected_title}`, row);
  }

  const correctedKey = normalizeTitleForGrouping(row.corrected_title);
  if (correctedKey) {
    addToGroup(groups, `repeated_corrected_phrase:${correctedKey}`, "repeated_corrected_phrase", row.corrected_title, row);
  }
}

function addToGroup(groups, key, patternType, patternLabel, row) {
  if (!key || key.endsWith(":")) {
    return;
  }

  if (!groups.has(key)) {
    groups.set(key, {
      pattern_key: key,
      pattern_type: patternType,
      pattern_label: patternLabel,
      rows: []
    });
  }

  groups.get(key).rows.push(row);
}

function finalizeCandidate(group) {
  const rows = dedupeRows(group.rows);
  const example = rows[0];
  const typeSet = new Set(rows.flatMap((row) => row.likely_change_types));
  const likelyTypes = CHANGE_TYPES.filter((type) => typeSet.has(type));

  return {
    pattern_key: group.pattern_key,
    pattern_type: group.pattern_type,
    pattern_label: group.pattern_label,
    feedback_ids: rows.map((row) => row.id),
    evidence_count: rows.length,
    example_generated_title: example.generated_title,
    example_corrected_title: example.corrected_title,
    front_image_url: example.front_image_url,
    back_image_url: example.back_image_url,
    likely_change_types: likelyTypes,
    suggested_decision_options: suggestDecisionOptions(likelyTypes),
    risk_level: assessRisk(likelyTypes, rows.length, group.pattern_type),
    install_recommendation_placeholder: "Admin review required. If approved, convert this candidate into a registry, resolver, prompt, test, or documentation upgrade proposal.",
    safety_status: "not_approved_not_installed",
    examples: rows.slice(0, 5).map((row) => ({
      feedback_id: row.id,
      generated_title: row.generated_title,
      corrected_title: row.corrected_title,
      front_image_url: row.front_image_url,
      back_image_url: row.back_image_url,
      operator_id: row.operator_id,
      created_at: row.created_at,
      likely_change_types: row.likely_change_types
    }))
  };
}

function dedupeRows(rows) {
  const seen = new Set();
  const deduped = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    deduped.push(row);
  }

  return deduped;
}

function suggestDecisionOptions(types) {
  const suggestions = [];

  if (types.some((type) => ["product", "set", "insert", "parallel", "player_subject", "serial", "auto_relic_patch", "grade"].includes(type))) {
    suggestions.push("Accept as registry rule");
  }

  if (types.some((type) => ["parallel", "serial", "auto_relic_patch", "grade"].includes(type))) {
    suggestions.push("Accept as resolver rule");
  }

  if (types.includes("wording_normalization") || types.some((type) => ["serial", "grade", "auto_relic_patch"].includes(type))) {
    suggestions.push("Accept as prompt rule");
  }

  suggestions.push("Needs more evidence", "Ignore");

  return DECISION_OPTIONS.filter((option) => suggestions.includes(option));
}

function assessRisk(types, evidenceCount, patternType) {
  if (evidenceCount <= 1 && types.some((type) => ["product", "set", "insert", "parallel", "player_subject"].includes(type))) {
    return "high";
  }

  if (types.includes("parallel") || types.includes("player_subject") || types.includes("set")) {
    return evidenceCount >= 3 ? "medium" : "high";
  }

  if (types.includes("wording_normalization") && patternType !== "single_correction") {
    return "low";
  }

  return evidenceCount >= 3 ? "medium" : "high";
}

function renderMarkdown(output) {
  const lines = [];

  lines.push("# Listing Copilot V2.1 Learning Review Candidates");
  lines.push("");
  lines.push(`Generated at: ${output.generated_at}`);
  lines.push(`Input file: \`${output.input_file}\``);
  lines.push(`Output date: ${output.output_date}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push(output.safety_note);
  lines.push("");
  lines.push("These candidates are not approved upgrades. Admin review is required before any code, registry, resolver, prompt, test, or documentation change.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Total input rows: ${output.total_input_rows}`);
  lines.push(`- Changed feedback rows: ${output.changed_feedback_rows}`);
  lines.push(`- Skipped unchanged rows: ${output.skipped_unchanged_rows}`);
  lines.push(`- Review candidates: ${output.candidate_count}`);
  lines.push("");
  lines.push("## Candidates");
  lines.push("");

  if (output.candidates.length === 0) {
    lines.push("No review candidates were created.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  for (const candidate of output.candidates) {
    lines.push(`### ${candidate.candidate_id}: ${candidate.pattern_type}`);
    lines.push("");
    lines.push(`Pattern: ${candidate.pattern_label}`);
    lines.push(`Risk level: ${candidate.risk_level}`);
    lines.push(`Evidence count: ${candidate.evidence_count}`);
    lines.push(`Feedback IDs: ${candidate.feedback_ids.join(", ")}`);
    lines.push(`Likely change types: ${candidate.likely_change_types.join(", ") || "none"}`);
    lines.push(`Suggested decision options: ${candidate.suggested_decision_options.join("; ")}`);
    lines.push("");
    lines.push("Example generated title:");
    lines.push("");
    lines.push(`> ${candidate.example_generated_title}`);
    lines.push("");
    lines.push("Example corrected title:");
    lines.push("");
    lines.push(`> ${candidate.example_corrected_title}`);
    lines.push("");
    lines.push(`Front image URL: ${candidate.front_image_url || "Not provided"}`);
    lines.push(`Back image URL: ${candidate.back_image_url || "Not provided"}`);
    lines.push("");
    lines.push(`Install recommendation placeholder: ${candidate.install_recommendation_placeholder}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
