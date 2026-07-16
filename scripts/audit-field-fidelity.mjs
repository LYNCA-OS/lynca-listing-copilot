import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const schemaVersion = "field-fidelity-audit-v1";
const humanReviewedFieldGroundTruth = "HUMAN_REVIEWED_FIELD_GROUND_TRUTH";

const fieldAliases = Object.freeze({
  year: ["year", "season_year", "product_year"],
  ip_sport: ["ip_sport", "ip", "sport", "category"],
  language: ["language"],
  manufacturer: ["manufacturer", "brand", "publisher"],
  product: ["product", "product_name", "product_line", "product_hierarchy", "product_or_set"],
  set: ["set", "subset"],
  subject: ["subject", "subjects", "players", "player", "character", "artist"],
  card_name: ["card_name", "official_card_type", "card_type", "insert"],
  card_number: ["card_number", "tcg_card_number", "checklist_code", "collector_number"],
  descriptive_rarity: ["descriptive_rarity", "rarity", "ssp", "case_hit"],
  numerical_rarity: [
    "numerical_rarity",
    "print_run_number",
    "serial_number",
    "print_run_numerator",
    "print_run_denominator",
    "serial_numerator",
    "serial_denominator",
    "numbered_to",
    "one_of_one"
  ],
  release_variant: ["release_variant", "variant", "variation"],
  print_finish: [
    "print_finish",
    "product_finish",
    "variant_or_parallel",
    "parallel_exact",
    "parallel_family",
    "parallel",
    "surface_color"
  ],
  special_stamp: ["special_stamp", "first_bowman"],
  grading_info: ["grading_info", "grade_company", "card_grade", "grade", "auto_grade", "grade_type"],
  description: ["description"],
  search_optimization: [
    "search_optimization",
    "observable_components",
    "rc",
    "auto",
    "patch",
    "relic",
    "jersey",
    "sketch",
    "redemption",
    "team"
  ]
});

const canonicalFieldOrder = Object.freeze(Object.keys(fieldAliases));
const titleObservableFields = new Set([
  "year",
  "manufacturer",
  "product",
  "set",
  "subject",
  "card_name",
  "card_number",
  "descriptive_rarity",
  "numerical_rarity",
  "release_variant",
  "print_finish",
  "special_stamp",
  "grading_info",
  "search_optimization"
]);

const structuralKeys = new Set([
  "title",
  "final_title",
  "rendered_title",
  "modules",
  "module_order",
  "renderer",
  "renderer_version",
  "title_length_policy",
  "title_render_source",
  "fields",
  "resolved",
  "resolved_fields",
  "identity",
  "status",
  "confidence",
  "reason",
  "unresolved",
  "evidence",
  "sources",
  "metadata"
]);

const reviewMetadataKeys = new Set([
  "fields",
  "reviewed_fields",
  "field_statuses",
  "statuses",
  "reviewed_by",
  "reviewer",
  "reviewer_id",
  "reviewed_at",
  "review_status",
  "reviewed_sem",
  "feedback_layer",
  "field_ground_truth_class",
  "evidence_sources",
  "notes"
]);

const countKeys = Object.freeze([
  "loss",
  "recovery",
  "pollution",
  "provider_unread",
  "resolver_loss",
  "resolver_projection_loss",
  "presentation_loss",
  "renderer_input_loss",
  "renderer_title_loss",
  "resolver_recovery",
  "resolver_projection_recovery",
  "renderer_input_recovery",
  "renderer_title_recovery",
  "resolver_pollution",
  "resolver_projection_pollution",
  "renderer_input_pollution",
  "renderer_title_pollution"
]);

const correctnessStages = Object.freeze([
  "raw_provider_fields",
  "identity_resolution_identity",
  "resolved_fields",
  "resolver_output",
  "renderer_input",
  "final_title"
]);

const aliasToCanonical = new Map();
for (const [canonical, aliases] of Object.entries(fieldAliases)) {
  aliases.forEach((alias) => aliasToCanonical.set(alias, canonical));
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function canonicalFieldName(value) {
  const key = normalizeKey(value);
  return aliasToCanonical.get(key) || key;
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return cleanText(value) !== "";
  if (Array.isArray(value)) return value.some(hasValue);
  if (isPlainObject(value)) return Object.values(value).some(hasValue);
  return true;
}

function unwrapFieldValue(value) {
  if (!isPlainObject(value)) return value;
  for (const key of ["reviewed_value", "resolved_value", "field_value"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  }
  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    const wrapperKeys = new Set([
      "value",
      "confidence",
      "status",
      "reviewed_status",
      "sources",
      "evidence",
      "evidence_sources",
      "reason"
    ]);
    if (Object.keys(value).every((key) => wrapperKeys.has(key))) return value.value;
  }
  return value;
}

function asValues(value) {
  const unwrapped = unwrapFieldValue(value);
  return (Array.isArray(unwrapped) ? unwrapped : [unwrapped]).filter(hasValue);
}

function normalizedScalar(value) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .toLowerCase()
    .replace(/\bprofessional sports authenticator\b/g, "psa")
    .replace(/\bbeckett\b/g, "bgs")
    .replace(/\bautograph\b/g, "auto")
    .replace(/\brookie card\b/g, "rc")
    .replace(/[^a-z0-9/#+&.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValues(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values.flatMap(asValues)) {
    const key = isPlainObject(value)
      ? JSON.stringify(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
      : normalizedScalar(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function entryMap(record = {}) {
  const entries = new Map();
  for (const [sourceKey, rawValue] of Object.entries(plainObject(record))) {
    const key = normalizeKey(sourceKey);
    if (!key) continue;
    const value = unwrapFieldValue(rawValue);
    if (!entries.has(key)) entries.set(key, []);
    entries.get(key).push({ source_key: sourceKey, value });
  }
  return entries;
}

function aliasEntries(entries, field) {
  return fieldAliases[field].flatMap((alias) => entries.get(alias) || []);
}

function firstAliasValue(entries, field) {
  return aliasEntries(entries, field).find((entry) => hasValue(entry.value))?.value;
}

function combinedAliasValues(entries, field) {
  return uniqueValues(aliasEntries(entries, field).flatMap((entry) => asValues(entry.value)));
}

function compactValue(values = []) {
  const unique = uniqueValues(values);
  if (!unique.length) return null;
  return unique.length === 1 ? unique[0] : unique;
}

function numericText(value) {
  const text = cleanText(value);
  const number = Number(text);
  return Number.isFinite(number) ? String(number) : text;
}

function numericalRarityValue(entries) {
  for (const key of ["numerical_rarity", "print_run_number", "serial_number"]) {
    const value = entries.get(key)?.find((entry) => hasValue(entry.value))?.value;
    if (hasValue(value)) return value;
  }
  const numerator = entries.get("print_run_numerator")?.[0]?.value ?? entries.get("serial_numerator")?.[0]?.value;
  const denominator = entries.get("print_run_denominator")?.[0]?.value
    ?? entries.get("serial_denominator")?.[0]?.value
    ?? entries.get("numbered_to")?.[0]?.value;
  if (hasValue(numerator) && hasValue(denominator)) return `${numericText(numerator)}/${numericText(denominator)}`;
  if (hasValue(denominator)) return `#/${numericText(denominator)}`;
  if (entries.get("one_of_one")?.some((entry) => entry.value === true)) return "1/1";
  return null;
}

function gradingValue(entries) {
  const direct = entries.get("grading_info")?.find((entry) => hasValue(entry.value))?.value;
  if (hasValue(direct)) return direct;
  const grade = {
    company: firstAliasEntryValue(entries, ["grade_company"]),
    card_grade: firstAliasEntryValue(entries, ["card_grade", "grade"]),
    auto_grade: firstAliasEntryValue(entries, ["auto_grade"]),
    grade_type: firstAliasEntryValue(entries, ["grade_type"])
  };
  return Object.values(grade).some(hasValue)
    ? Object.fromEntries(Object.entries(grade).filter(([, value]) => hasValue(value)))
    : null;
}

function firstAliasEntryValue(entries, keys = []) {
  for (const key of keys) {
    const value = entries.get(key)?.find((entry) => hasValue(entry.value))?.value;
    if (hasValue(value)) return value;
  }
  return null;
}

function booleanTokens(entries, pairs = []) {
  return pairs.flatMap(([key, label]) => entries.get(key)?.some((entry) => entry.value === true) ? [label] : []);
}

function knownFieldValue(entries, field) {
  if (field === "subject" || field === "print_finish") return compactValue(combinedAliasValues(entries, field));
  if (field === "numerical_rarity") return numericalRarityValue(entries);
  if (field === "grading_info") return gradingValue(entries);
  if (field === "descriptive_rarity") {
    const direct = firstAliasEntryValue(entries, ["descriptive_rarity", "rarity"]);
    return hasValue(direct)
      ? direct
      : compactValue(booleanTokens(entries, [["ssp", "SSP"], ["case_hit", "Case Hit"]]));
  }
  if (field === "special_stamp") {
    const direct = firstAliasEntryValue(entries, ["special_stamp"]);
    return hasValue(direct) ? direct : entries.get("first_bowman")?.some((entry) => entry.value === true) ? "1st Bowman" : null;
  }
  if (field === "search_optimization") {
    const direct = firstAliasEntryValue(entries, ["search_optimization", "observable_components"]);
    if (hasValue(direct)) return direct;
    return compactValue([
      ...booleanTokens(entries, [
        ["rc", "RC"],
        ["auto", "Auto"],
        ["patch", "Patch"],
        ["relic", "Relic"],
        ["jersey", "Jersey"],
        ["sketch", "Sketch"],
        ["redemption", "Redemption"]
      ]),
      firstAliasEntryValue(entries, ["team"])
    ]);
  }
  return firstAliasValue(entries, field);
}

function dynamicFieldAllowed(key) {
  if (!key || structuralKeys.has(key) || aliasToCanonical.has(key)) return false;
  return !/(?:^|_)(?:confidence|status|reason|source|sources|evidence|metadata|trace|diagnostics)$/.test(key)
    && !/(?:_confidence|_status|_reason|_source|_sources|_evidence|_trace|_diagnostics)$/.test(key);
}

function canonicalizeFields(record = {}) {
  const entries = entryMap(record);
  const fields = {};
  for (const field of canonicalFieldOrder) {
    const value = knownFieldValue(entries, field);
    if (!hasValue(value)) continue;
    fields[field] = {
      value,
      source_keys: [...new Set(aliasEntries(entries, field).filter((entry) => hasValue(entry.value)).map((entry) => entry.source_key))]
    };
  }
  for (const [key, rows] of entries) {
    if (!dynamicFieldAllowed(key)) continue;
    const value = compactValue(rows.map((entry) => entry.value));
    if (!hasValue(value)) continue;
    fields[key] = { value, source_keys: rows.map((entry) => entry.source_key) };
  }
  return fields;
}

function getPath(object, path) {
  let current = object;
  for (const part of path) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      return { exists: false, value: undefined };
    }
    current = current[part];
  }
  return { exists: true, value: current };
}

function selectObjectLayer(item, candidates) {
  const hits = candidates.map((candidate) => ({ ...candidate, ...getPath(item, candidate.path) }));
  const selected = hits.find((hit) => hit.exists && isPlainObject(hit.value))
    || hits.find((hit) => hit.exists)
    || null;
  if (!selected) {
    return {
      available: false,
      source_path: null,
      inferred: false,
      invalid_type: false,
      fields: {}
    };
  }
  return {
    available: true,
    source_path: selected.path.join("."),
    inferred: selected.inferred === true,
    invalid_type: selected.value !== null && !isPlainObject(selected.value),
    fields: canonicalizeFields(isPlainObject(selected.value) ? selected.value : {})
  };
}

function selectTextLayer(item, candidates) {
  const hits = candidates.map((candidate) => ({ ...candidate, ...getPath(item, candidate.path) }));
  const selected = hits.find((hit) => hit.exists && cleanText(hit.value))
    || hits.find((hit) => hit.exists)
    || null;
  return selected
    ? { available: true, source_path: selected.path.join("."), value: cleanText(selected.value) }
    : { available: false, source_path: null, value: "" };
}

function rawProviderLayer(item) {
  return selectObjectLayer(item, [
    { path: ["raw_provider_fields"] },
    { path: ["breakpoints", "raw_provider_fields"] },
    { path: ["result", "raw_provider_fields"] },
    { path: ["data", "raw_provider_fields"] },
    { path: ["provider_fields"], inferred: true }
  ]);
}

function identityLayer(item) {
  return selectObjectLayer(item, [
    { path: ["identity_resolution", "identity"] },
    { path: ["identity_resolution", "resolved_identity"] },
    { path: ["result", "identity_resolution", "identity"] },
    { path: ["data", "identity_resolution", "identity"] }
  ]);
}

function resolvedLayer(item) {
  return selectObjectLayer(item, [
    { path: ["resolved_fields"] },
    { path: ["breakpoints", "resolved_fields"] },
    { path: ["result", "resolved_fields"] },
    { path: ["data", "resolved_fields"] },
    { path: ["resolved"], inferred: true }
  ]);
}

function rendererInputLayer(item) {
  return selectObjectLayer(item, [
    { path: ["renderer_input", "fields"] },
    { path: ["renderer_input", "resolved_fields"] },
    { path: ["renderer_input", "resolved"] },
    { path: ["renderer_input", "identity"] },
    { path: ["presentation", "renderer_input", "fields"] },
    { path: ["presentation", "renderer_input"] },
    { path: ["render_input", "fields"] },
    { path: ["render_input"] },
    { path: ["renderer_input"] },
    { path: ["rendered_fields", "fields"], inferred: true },
    { path: ["breakpoints", "rendered_fields", "fields"], inferred: true },
    { path: ["rendered_fields"], inferred: true },
    { path: ["breakpoints", "rendered_fields"], inferred: true }
  ]);
}

function finalTitleLayer(item) {
  return selectTextLayer(item, [
    { path: ["rendered_fields", "rendered_title"] },
    { path: ["rendered_fields", "title"] },
    { path: ["breakpoints", "rendered_fields", "rendered_title"] },
    { path: ["breakpoints", "rendered_fields", "title"] },
    { path: ["renderer_output", "final_title"] },
    { path: ["renderer_output", "rendered_title"] },
    { path: ["raw_model_title"] },
    { path: ["title"] },
    { path: ["final_title"] },
    { path: ["l2_status", "title"] }
  ]);
}

function finalExplicitFieldsLayer(item) {
  return selectObjectLayer(item, [
    { path: ["final_title_fields"] },
    { path: ["observable_fields"] },
    { path: ["renderer_output", "observable_fields"] },
    { path: ["presentation", "observable_fields"] }
  ]);
}

function modulesLayer(item) {
  const selected = [
    ["rendered_fields", "modules"],
    ["breakpoints", "rendered_fields", "modules"],
    ["renderer_output", "modules"],
    ["modules"]
  ].map((path) => ({ path, ...getPath(item, path) })).find((candidate) => candidate.exists && isPlainObject(candidate.value));
  return selected
    ? { available: true, source_path: selected.path.join("."), value: selected.value }
    : { available: false, source_path: null, value: {} };
}

function effectiveResolverLayer(identity, resolved) {
  if (resolved.available) return { ...resolved, source_kind: "resolved_fields" };
  if (identity.available) return { ...identity, source_kind: "identity_resolution.identity" };
  return { available: false, source_path: null, inferred: false, invalid_type: false, fields: {}, source_kind: null };
}

function normalizeNumerical(value) {
  const text = cleanText(value).replace(/\s+/g, "");
  const full = text.match(/#?0*(\d+)\/0*(\d+)/);
  if (full) return `${Number(full[1])}/${Number(full[2])}`;
  const denominator = text.match(/#?\/0*(\d+)/);
  if (denominator) return `#/${Number(denominator[1])}`;
  const numberedTo = text.match(/(?:numberedto|to)0*(\d+)/i);
  return numberedTo ? `#/${Number(numberedTo[1])}` : normalizedScalar(value);
}

function objectAtoms(value = {}) {
  return Object.entries(value)
    .filter(([, child]) => hasValue(child))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, child]) => asValues(child).map((entry) => `${normalizeKey(key)}:${normalizedScalar(entry)}`));
}

function gradingAtoms(value) {
  if (!isPlainObject(value)) return asValues(value).map(normalizedScalar).filter(Boolean).sort();
  const company = value.company || value.grade_company;
  const cardGrade = value.card_grade || value.grade;
  const autoGrade = value.auto_grade;
  const gradeType = cleanText(value.grade_type).toUpperCase();
  return [
    hasValue(company) ? `company:${normalizedScalar(company)}` : "",
    hasValue(cardGrade) ? `card:${normalizedScalar(cardGrade)}` : "",
    hasValue(autoGrade) ? `auto:${normalizedScalar(autoGrade)}` : "",
    gradeType && gradeType !== "UNKNOWN" ? `type:${normalizedScalar(gradeType)}` : ""
  ].filter(Boolean).sort();
}

function comparisonAtoms(field, value) {
  if (!hasValue(value)) return [];
  if (field === "grading_info") return gradingAtoms(value);
  if (field === "numerical_rarity") return [normalizeNumerical(Array.isArray(value) ? value[0] : value)];
  if (["print_finish", "release_variant", "search_optimization", "special_stamp", "descriptive_rarity"].includes(field)) {
    return [...new Set(asValues(value).flatMap((entry) => normalizedScalar(entry).split(" ")).filter(Boolean))].sort();
  }
  if (isPlainObject(value)) return objectAtoms(value);
  return [...new Set(asValues(value).map((entry) => {
    const normalized = normalizedScalar(entry);
    return field === "card_number" ? normalized.replace(/^#+/, "") : normalized;
  }).filter(Boolean))].sort();
}

function valuesEquivalent(field, left, right) {
  const leftAtoms = comparisonAtoms(field, left);
  const rightAtoms = comparisonAtoms(field, right);
  return leftAtoms.length > 0
    && leftAtoms.length === rightAtoms.length
    && leftAtoms.every((value, index) => value === rightAtoms[index]);
}

function normalizedPhrase(value) {
  return normalizedScalar(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function phraseVisible(title, value) {
  const needle = normalizedPhrase(value);
  const haystack = normalizedPhrase(title);
  return Boolean(needle && haystack && (` ${haystack} `).includes(` ${needle} `));
}

function displayParts(field, value) {
  if (!hasValue(value)) return [];
  if (field === "grading_info" && isPlainObject(value)) {
    const company = value.company || value.grade_company;
    const cardGrade = value.card_grade || value.grade;
    const autoGrade = value.auto_grade;
    return [
      [company, cardGrade].filter(hasValue).join(" "),
      hasValue(autoGrade) ? `${company || ""} Auto ${autoGrade}`.trim() : ""
    ].filter(Boolean);
  }
  if (field === "numerical_rarity") return [normalizeNumerical(Array.isArray(value) ? value[0] : value)];
  if (typeof value === "boolean") return value ? [field.replace(/_/g, " ")] : [];
  if (isPlainObject(value)) return Object.values(value).flatMap((child) => displayParts(field, child));
  return asValues(value).map(cleanText).filter(Boolean);
}

function valueVisibleInTitle(field, value, title) {
  const parts = displayParts(field, value);
  if (!parts.length) return false;
  if (field === "numerical_rarity") {
    const titleSerials = cleanText(title).match(/#?\s*\/?\s*\d+\s*\/\s*\d+|#\s*\/\s*\d+/g) || [];
    return parts.every((part) => titleSerials.some((serial) => normalizeNumerical(serial) === normalizeNumerical(part)));
  }
  return parts.every((part) => phraseVisible(title, part));
}

function compatibleObservedValue(field, expected, observed) {
  if (valuesEquivalent(field, expected, observed)) return true;
  const expectedParts = displayParts(field, expected);
  const observedText = Array.isArray(observed)
    ? observed.map(cleanText).join(" ")
    : isPlainObject(observed)
      ? Object.values(observed).map(cleanText).join(" ")
      : cleanText(observed);
  return expectedParts.length > 0 && expectedParts.every((part) => phraseVisible(observedText, part));
}

function visibleModuleFieldMap(modules, title, rendererFields = {}) {
  const output = new Map();
  for (const module of Object.values(plainObject(modules))) {
    if (!isPlainObject(module)) continue;
    const rows = Array.isArray(module.tokens) && module.tokens.length
      ? module.tokens
      : [{ text: module.text, fields: module.fields }];
    for (const row of rows) {
      const text = cleanText(row?.text);
      if (!text || !phraseVisible(title, text)) continue;
      const canonicalFields = [...new Set(
        (Array.isArray(row?.fields) ? row.fields : []).map(canonicalFieldName).filter(Boolean)
      )];
      const attributableFields = canonicalFields.filter((field) => rendererFields[field]);
      const selectedFields = attributableFields.length
        ? attributableFields
        : canonicalFields.length === 1 ? canonicalFields : [];
      for (const field of selectedFields) {
        if (!field) continue;
        if (!output.has(field)) output.set(field, []);
        output.get(field).push(text);
      }
    }
  }
  return new Map([...output.entries()].map(([field, values]) => [field, compactValue(values)]));
}

function moduleFieldNames(modules) {
  const fields = new Set();
  for (const module of Object.values(plainObject(modules))) {
    if (!isPlainObject(module)) continue;
    const rows = Array.isArray(module.tokens) && module.tokens.length
      ? module.tokens
      : [{ fields: module.fields }];
    rows.flatMap((row) => Array.isArray(row?.fields) ? row.fields : []).forEach((field) => fields.add(canonicalFieldName(field)));
  }
  return fields;
}

function inferredTitleValue(field, title) {
  if (field === "year") return cleanText(title).match(/\b((?:19|20)\d{2}(?:-\d{2})?)\b/)?.[1] || null;
  if (field === "numerical_rarity") {
    const matches = [...cleanText(title).matchAll(/(?:^|[\s#])0*(\d+)\s*\/\s*0*(\d+)\b/g)];
    if (matches.length) return `${Number(matches.at(-1)[1])}/${Number(matches.at(-1)[2])}`;
    const denominator = cleanText(title).match(/#\s*\/\s*0*(\d+)\b/);
    return denominator ? `#/${Number(denominator[1])}` : null;
  }
  if (field === "grading_info") {
    const match = cleanText(title).match(/\b(PSA|BGS|SGC|CGC|Beckett)\s+(?:Gem\s+Mint\s+)?(AUTO\s+)?(\d+(?:\.\d+)?)\b/i);
    if (!match) return null;
    return match[2]
      ? { company: match[1], auto_grade: match[3] }
      : { company: match[1], card_grade: match[3] };
  }
  if (field === "descriptive_rarity") {
    return compactValue([
      /\bSSP\b/i.test(title) ? "SSP" : null,
      /\bCase\s+Hit\b/i.test(title) ? "Case Hit" : null
    ]);
  }
  if (field === "special_stamp") return /\b1st\s+Bowman\b/i.test(title) ? "1st Bowman" : null;
  if (field === "search_optimization") {
    return compactValue([
      /\bRC\b/i.test(title) ? "RC" : null,
      /\bAuto\b/i.test(title) ? "Auto" : null,
      /\bPatch\b/i.test(title) ? "Patch" : null,
      /\bRelic\b/i.test(title) ? "Relic" : null
    ]);
  }
  return null;
}

function fieldSnapshot(layer, field) {
  const row = layer.fields[field];
  return {
    available: layer.available,
    present: layer.available ? Boolean(row) : null,
    value: row?.value ?? null,
    source_keys: row?.source_keys || []
  };
}

function finalFieldSnapshot({
  field,
  finalTitle,
  explicitFields,
  visibleModules,
  moduleFields,
  candidateValues
}) {
  const observable = titleObservableFields.has(field)
    || moduleFields.has(field)
    || Boolean(explicitFields.fields[field]);
  if (!finalTitle.available || !observable) {
    return {
      available: finalTitle.available && observable,
      observable,
      present: finalTitle.available && observable ? false : null,
      value: null,
      method: observable ? "title_unavailable" : "not_title_observable"
    };
  }
  if (explicitFields.available && explicitFields.fields[field]) {
    return {
      available: true,
      observable: true,
      present: true,
      value: explicitFields.fields[field].value,
      method: "explicit_final_title_fields"
    };
  }
  if (visibleModules.has(field)) {
    return {
      available: true,
      observable: true,
      present: true,
      value: visibleModules.get(field),
      method: "visible_renderer_module"
    };
  }
  const inferred = inferredTitleValue(field, finalTitle.value);
  if (hasValue(inferred)) {
    return { available: true, observable: true, present: true, value: inferred, method: "title_pattern" };
  }
  for (const candidate of candidateValues) {
    if (hasValue(candidate) && valueVisibleInTitle(field, candidate, finalTitle.value)) {
      return { available: true, observable: true, present: true, value: candidate, method: "candidate_token_match" };
    }
  }
  return { available: true, observable: true, present: false, value: null, method: "not_observed_in_title" };
}

function truthClass(report, item, review) {
  return cleanText(
    item.evaluation_truth_policy?.field_ground_truth_class
    || review.field_ground_truth_class
    || report.evaluation_truth_policy?.field_ground_truth_class
    || report.source?.field_ground_truth_class
    || report.report?.evaluation_truth_policy?.field_ground_truth_class
  ).toUpperCase();
}

function directReviewedFields(review) {
  return Object.fromEntries(Object.entries(review).filter(([key]) => {
    const normalized = normalizeKey(key);
    return !reviewMetadataKeys.has(normalized)
      && (aliasToCanonical.has(normalized) || dynamicFieldAllowed(normalized));
  }));
}

function reviewedSemTruth(report, item) {
  const review = plainObject(item.reviewed_ground_truth || item.reviewed_sem || item.ground_truth?.reviewed_sem);
  const nestedFields = plainObject(review.fields || review.reviewed_fields);
  const fields = Object.keys(nestedFields).length ? nestedFields : directReviewedFields(review);
  const statuses = plainObject(review.field_statuses || review.statuses);
  const reviewer = cleanText(review.reviewed_by || review.reviewer || review.reviewer_id);
  const reviewedAt = cleanText(review.reviewed_at);
  const explicitHumanClass = truthClass(report, item, review) === humanReviewedFieldGroundTruth;
  const explicitReviewedSem = item.reviewed_sem === true
    || item.reviewed_field_ground_truth === true
    || review.reviewed_sem === true
    || cleanText(review.feedback_layer).toUpperCase() === "REVIEWED_SEMANTIC_TRUTH";
  const metadataReviewed = Boolean(reviewer && reviewedAt && Number.isFinite(Date.parse(reviewedAt)));
  const eligible = explicitHumanClass || explicitReviewedSem || metadataReviewed;
  if (!eligible || !Object.keys(fields).length) {
    return {
      eligible: false,
      reason: !eligible ? "human_reviewed_sem_not_proven" : "reviewed_sem_fields_missing",
      fields: {}
    };
  }

  const confirmedRecord = {};
  for (const [field, raw] of Object.entries(fields)) {
    const record = plainObject(raw);
    const explicitStatus = cleanText(
      statuses[field]
      || record.reviewed_status
      || record.status
      || (explicitHumanClass || explicitReviewedSem ? "CONFIRMED" : "")
    ).toUpperCase();
    if (explicitStatus !== "CONFIRMED") continue;
    const value = isPlainObject(raw)
      ? (record.reviewed_value ?? record.value)
      : raw;
    if (hasValue(value)) confirmedRecord[field] = value;
  }
  const confirmedFields = canonicalizeFields(confirmedRecord);
  return {
    eligible: Object.keys(confirmedFields).length > 0,
    reason: Object.keys(confirmedFields).length ? "human_reviewed_sem" : "no_confirmed_reviewed_sem_fields",
    fields: confirmedFields
  };
}

function resultRows(report) {
  for (const candidate of [report.results, report.report?.results, report.items, report.records, report.cards]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function cardId(item, index) {
  return cleanText(
    item.candidate_id
    || item.asset_id
    || item.item_id
    || item.card_id
    || item.source_feedback_id
    || item.job_id
    || `card-${index + 1}`
  );
}

function emptyCounts() {
  return Object.fromEntries(countKeys.map((key) => [key, 0]));
}

function emptyCorrectness() {
  return Object.fromEntries(correctnessStages.map((stage) => [stage, {
    evaluated_count: 0,
    correct_count: 0,
    incorrect_count: 0,
    missing_count: 0
  }]));
}

function exampleFromEvent(card, field, event, truthValue) {
  return {
    card_id: card.card_id,
    field,
    event: event.type,
    from_stage: event.from_stage,
    to_stage: event.to_stage,
    from_value: event.from_value ?? null,
    to_value: event.to_value ?? null,
    reviewed_sem_value: truthValue ?? null,
    final_title: card.final_title
  };
}

function addExample(target, key, value, limit) {
  if (!target[key]) target[key] = [];
  if (target[key].length < limit) target[key].push(value);
}

function stageCorrectness(snapshot, truthValue, field, { compatible = false } = {}) {
  if (!snapshot.available) return "UNOBSERVABLE";
  if (!snapshot.present) return "MISSING";
  return (compatible
    ? compatibleObservedValue(field, truthValue, snapshot.value)
    : valuesEquivalent(field, truthValue, snapshot.value))
    ? "CORRECT"
    : "INCORRECT";
}

function updateCorrectness(stats, stage, status) {
  if (!["CORRECT", "INCORRECT", "MISSING"].includes(status)) return;
  stats[stage].evaluated_count += 1;
  if (status === "CORRECT") stats[stage].correct_count += 1;
  if (status === "INCORRECT") stats[stage].incorrect_count += 1;
  if (status === "MISSING") stats[stage].missing_count += 1;
}

function event(type, fromStage, toStage, fromSnapshot, toSnapshot) {
  return {
    type,
    from_stage: fromStage,
    to_stage: toStage,
    from_value: fromSnapshot?.value ?? null,
    to_value: toSnapshot?.value ?? null
  };
}

function auditCard(report, item, index) {
  const raw = rawProviderLayer(item);
  const identity = identityLayer(item);
  const resolved = resolvedLayer(item);
  const resolver = effectiveResolverLayer(identity, resolved);
  const rendererInput = rendererInputLayer(item);
  const finalTitle = finalTitleLayer(item);
  const explicitFinalFields = finalExplicitFieldsLayer(item);
  const modules = modulesLayer(item);
  const visibleModules = visibleModuleFieldMap(modules.value, finalTitle.value, rendererInput.fields);
  const moduleFields = moduleFieldNames(modules.value);
  const truth = reviewedSemTruth(report, item);
  const fieldNames = new Set([
    ...Object.keys(raw.fields),
    ...Object.keys(identity.fields),
    ...Object.keys(resolved.fields),
    ...Object.keys(rendererInput.fields),
    ...Object.keys(explicitFinalFields.fields),
    ...visibleModules.keys(),
    ...Object.keys(truth.fields)
  ]);
  const card = {
    card_id: cardId(item, index),
    ordinal: index + 1,
    correctness_mode: truth.eligible ? "reviewed_sem" : "fidelity_only",
    final_title: finalTitle.value,
    layers: {
      raw_provider_fields: { ...raw, fields: undefined },
      identity_resolution_identity: { ...identity, fields: undefined },
      resolved_fields: { ...resolved, fields: undefined },
      resolver_output: { ...resolver, fields: undefined },
      renderer_input: { ...rendererInput, fields: undefined },
      final_title: {
        available: finalTitle.available,
        source_path: finalTitle.source_path,
        module_mapping_available: modules.available,
        module_source_path: modules.source_path,
        explicit_field_mapping_available: explicitFinalFields.available
      }
    },
    counts: emptyCounts(),
    fields: {},
    data_quality: {
      unavailable_layers: [
        !raw.available ? "raw_provider_fields" : null,
        !identity.available ? "identity_resolution.identity" : null,
        !resolved.available ? "resolved_fields" : null,
        !rendererInput.available ? "renderer_input" : null,
        !finalTitle.available ? "final_title" : null
      ].filter(Boolean),
      renderer_input_inferred: rendererInput.inferred,
      reviewed_sem: truth.eligible,
      reviewed_sem_reason: truth.reason
    }
  };

  const fieldRank = (field) => {
    const index = canonicalFieldOrder.indexOf(field);
    return index === -1 ? canonicalFieldOrder.length : index;
  };
  const sortedFields = [...fieldNames].filter(Boolean).sort((left, right) => fieldRank(left) - fieldRank(right) || left.localeCompare(right));

  for (const field of sortedFields) {
    const rawField = fieldSnapshot(raw, field);
    const identityField = fieldSnapshot(identity, field);
    const resolvedField = fieldSnapshot(resolved, field);
    const resolverField = fieldSnapshot(resolver, field);
    const rendererField = fieldSnapshot(rendererInput, field);
    const truthValue = truth.fields[field]?.value ?? null;
    const finalField = finalFieldSnapshot({
      field,
      finalTitle,
      explicitFields: explicitFinalFields,
      visibleModules,
      moduleFields,
      candidateValues: [rendererField.value, resolverField.value, identityField.value, rawField.value, truthValue]
    });
    const events = [];
    const flags = new Set();
    const laterPresent = [identityField, resolvedField, rendererField, finalField].some((snapshot) => snapshot.present === true);

    if (rawField.available && !rawField.present && (laterPresent || hasValue(truthValue))) {
      events.push(event("provider_unread", "raw_provider_fields", "downstream_expectation", rawField, {
        value: truthValue ?? resolverField.value ?? rendererField.value ?? finalField.value
      }));
      flags.add("provider_unread");
      flags.add("loss");
    }
    if (rawField.available && resolverField.available) {
      if (rawField.present && !resolverField.present) {
        events.push(event("resolver_loss", "raw_provider_fields", "resolver_output", rawField, resolverField));
        flags.add("resolver_loss");
        flags.add("loss");
      } else if (!rawField.present && resolverField.present) {
        events.push(event("resolver_recovery", "raw_provider_fields", "resolver_output", rawField, resolverField));
        flags.add("resolver_recovery");
        flags.add("recovery");
      } else if (rawField.present && resolverField.present && !valuesEquivalent(field, rawField.value, resolverField.value)) {
        events.push(event("resolver_pollution", "raw_provider_fields", "resolver_output", rawField, resolverField));
        flags.add("resolver_pollution");
        flags.add("pollution");
      }
    }
    if (identityField.available && resolvedField.available) {
      if (identityField.present && !resolvedField.present) {
        events.push(event("resolver_projection_loss", "identity_resolution.identity", "resolved_fields", identityField, resolvedField));
        flags.add("resolver_projection_loss");
        flags.add("resolver_loss");
        flags.add("loss");
      } else if (!identityField.present && resolvedField.present) {
        events.push(event("resolver_projection_recovery", "identity_resolution.identity", "resolved_fields", identityField, resolvedField));
        flags.add("resolver_projection_recovery");
        flags.add("recovery");
      } else if (identityField.present && resolvedField.present && !valuesEquivalent(field, identityField.value, resolvedField.value)) {
        events.push(event("resolver_projection_pollution", "identity_resolution.identity", "resolved_fields", identityField, resolvedField));
        flags.add("resolver_projection_pollution");
        flags.add("pollution");
      }
    }
    if (resolverField.available && rendererField.available) {
      if (resolverField.present && !rendererField.present) {
        events.push(event("renderer_input_loss", "resolver_output", "renderer_input", resolverField, rendererField));
        flags.add("renderer_input_loss");
        flags.add("presentation_loss");
        flags.add("loss");
      } else if (!resolverField.present && rendererField.present) {
        events.push(event("renderer_input_recovery", "resolver_output", "renderer_input", resolverField, rendererField));
        flags.add("renderer_input_recovery");
        flags.add("recovery");
      } else if (resolverField.present && rendererField.present && !valuesEquivalent(field, resolverField.value, rendererField.value)) {
        events.push(event("renderer_input_pollution", "resolver_output", "renderer_input", resolverField, rendererField));
        flags.add("renderer_input_pollution");
        flags.add("pollution");
      }
    }
    if (rendererField.available && finalField.available) {
      const displayable = displayParts(field, rendererField.value).length > 0;
      if (rendererField.present && displayable && !finalField.present) {
        events.push(event("renderer_title_loss", "renderer_input", "final_title", rendererField, finalField));
        flags.add("renderer_title_loss");
        flags.add("presentation_loss");
        flags.add("loss");
      } else if (!rendererField.present && finalField.present) {
        events.push(event("renderer_title_recovery", "renderer_input", "final_title", rendererField, finalField));
        flags.add("renderer_title_recovery");
        flags.add("recovery");
      } else if (
        rendererField.present
        && finalField.present
        && ["explicit_final_title_fields", "visible_renderer_module", "title_pattern"].includes(finalField.method)
        && !compatibleObservedValue(field, rendererField.value, finalField.value)
      ) {
        events.push(event("renderer_title_pollution", "renderer_input", "final_title", rendererField, finalField));
        flags.add("renderer_title_pollution");
        flags.add("pollution");
      }
    }

    for (const flag of flags) {
      if (Object.prototype.hasOwnProperty.call(card.counts, flag)) card.counts[flag] += 1;
    }

    const correctness = truth.fields[field]
      ? {
        reviewed_sem_value: truthValue,
        reviewed_status: "CONFIRMED",
        stages: {
          raw_provider_fields: stageCorrectness(rawField, truthValue, field),
          identity_resolution_identity: stageCorrectness(identityField, truthValue, field),
          resolved_fields: stageCorrectness(resolvedField, truthValue, field),
          resolver_output: stageCorrectness(resolverField, truthValue, field),
          renderer_input: stageCorrectness(rendererField, truthValue, field),
          final_title: stageCorrectness(finalField, truthValue, field, { compatible: true })
        }
      }
      : null;

    card.fields[field] = {
      stages: {
        raw_provider_fields: rawField,
        identity_resolution_identity: identityField,
        resolved_fields: resolvedField,
        resolver_output: resolverField,
        renderer_input: rendererField,
        final_title: finalField
      },
      events,
      correctness
    };
  }

  return card;
}

function fieldSummaryRecord() {
  return {
    card_count: 0,
    counts: emptyCounts(),
    correctness: emptyCorrectness(),
    examples: {}
  };
}

function summarizeCards(cards, exampleLimit) {
  const fields = {};
  const totals = emptyCounts();
  const correctness = emptyCorrectness();

  for (const card of cards) {
    for (const key of countKeys) totals[key] += card.counts[key];
    for (const [field, detail] of Object.entries(card.fields)) {
      if (!fields[field]) fields[field] = fieldSummaryRecord();
      const target = fields[field];
      target.card_count += 1;
      const eventTypes = new Set(detail.events.map((entry) => entry.type));
      const flags = new Set();
      eventTypes.forEach((type) => {
        flags.add(type);
        if (type === "provider_unread" || type.endsWith("_loss")) flags.add("loss");
        if (type.endsWith("_recovery")) flags.add("recovery");
        if (type.endsWith("_pollution")) flags.add("pollution");
        if (type === "renderer_input_loss" || type === "renderer_title_loss") flags.add("presentation_loss");
        if (type === "resolver_projection_loss") flags.add("resolver_loss");
      });
      for (const flag of flags) {
        if (!Object.prototype.hasOwnProperty.call(target.counts, flag)) continue;
        target.counts[flag] += 1;
        const matching = detail.events.find((entry) => entry.type === flag)
          || detail.events.find((entry) => flag === "loss" && (entry.type === "provider_unread" || entry.type.endsWith("_loss")))
          || detail.events.find((entry) => flag === "recovery" && entry.type.endsWith("_recovery"))
          || detail.events.find((entry) => flag === "pollution" && entry.type.endsWith("_pollution"))
          || detail.events.find((entry) => flag === "presentation_loss" && entry.type.startsWith("renderer_"));
        if (matching) addExample(target.examples, flag, exampleFromEvent(card, field, matching, detail.correctness?.reviewed_sem_value), exampleLimit);
      }
      if (detail.correctness) {
        for (const [stage, status] of Object.entries(detail.correctness.stages)) {
          updateCorrectness(target.correctness, stage, status);
          updateCorrectness(correctness, stage, status);
        }
      }
    }
  }

  return { fields, totals, correctness };
}

function layerCount(cards, layer, predicate = () => true) {
  return cards.filter((card) => card.layers[layer]?.available && predicate(card.layers[layer])).length;
}

export function buildFieldFidelityAudit(report = {}, {
  exampleLimit = 3,
  now = () => new Date()
} = {}) {
  const rows = resultRows(report);
  const cards = rows.map((item, index) => auditCard(report, plainObject(item), index));
  const summary = summarizeCards(cards, Math.max(0, Math.trunc(Number(exampleLimit) || 0)));
  const reviewedSemCardCount = cards.filter((card) => card.correctness_mode === "reviewed_sem").length;
  const rendererInputInferredCount = cards.filter((card) => card.layers.renderer_input.inferred === true).length;
  const finalModuleMappingCount = cards.filter((card) => card.layers.final_title.module_mapping_available === true).length;

  return {
    schema_version: schemaVersion,
    status: cards.length ? "completed" : "no_results",
    generated_at: now().toISOString(),
    source_report: {
      schema_version: report.schema_version || report.report?.schema_version || null,
      generated_at: report.generated_at || report.report?.generated_at || null,
      result_count: rows.length
    },
    policy: {
      mode: "reviewed_sem_when_available_otherwise_fidelity_only",
      corrected_title_is_direct_fact: false,
      corrected_title_used_for_fidelity: false,
      corrected_title_used_for_correctness: false,
      correctness_requirement: "human reviewed SEM with CONFIRMED field values",
      loss_definition: "a field expected from reviewed SEM or observed downstream is absent at provider, resolver, renderer input, or final-title observability",
      recovery_definition: "a field absent at an observable upstream layer appears at a downstream layer",
      pollution_definition: "an observable downstream layer replaces an upstream value with a non-equivalent value; this is structural mutation, not a factual error claim"
    },
    summary: {
      card_count: cards.length,
      field_count: Object.keys(summary.fields).length,
      reviewed_sem_card_count: reviewedSemCardCount,
      fidelity_only_card_count: cards.length - reviewedSemCardCount,
      counts: summary.totals,
      correctness: {
        status: reviewedSemCardCount ? "reviewed_sem_available" : "not_evaluated",
        stages: summary.correctness
      },
      stage_observability: {
        raw_provider_fields_card_count: layerCount(cards, "raw_provider_fields"),
        identity_resolution_identity_card_count: layerCount(cards, "identity_resolution_identity"),
        resolved_fields_card_count: layerCount(cards, "resolved_fields"),
        renderer_input_card_count: layerCount(cards, "renderer_input"),
        renderer_input_inferred_card_count: rendererInputInferredCount,
        final_title_card_count: layerCount(cards, "final_title"),
        final_title_module_mapping_card_count: finalModuleMappingCount
      }
    },
    fields: summary.fields,
    cards,
    data_quality: {
      missing_raw_provider_layer_card_count: cards.length - layerCount(cards, "raw_provider_fields"),
      missing_identity_layer_card_count: cards.length - layerCount(cards, "identity_resolution_identity"),
      missing_resolved_fields_layer_card_count: cards.length - layerCount(cards, "resolved_fields"),
      missing_renderer_input_layer_card_count: cards.length - layerCount(cards, "renderer_input"),
      missing_final_title_layer_card_count: cards.length - layerCount(cards, "final_title"),
      renderer_input_compatibility_projection_card_count: rendererInputInferredCount,
      final_title_without_module_mapping_card_count: cards.length - finalModuleMappingCount,
      limitations: [
        "A wholly absent report layer is unobservable and is never counted as a field loss.",
        "When explicit renderer input is absent, rendered_fields is used only as a marked compatibility projection.",
        "Final-title field pollution is detectable only from explicit observable fields, visible renderer modules, or supported title patterns.",
        "corrected_title and title-only review markers are never treated as field truth."
      ]
    }
  };
}

async function readJson(path) {
  const resolved = resolve(path);
  try {
    return JSON.parse(await readFile(resolved, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read cloud eval report ${resolved}: ${error.message}`);
  }
}

async function writeJson(path, value) {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`);
  return resolved;
}

export async function auditFieldFidelityFile({
  inputPath,
  outPath = "",
  exampleLimit = 3,
  now = () => new Date()
} = {}) {
  if (!cleanText(inputPath)) throw new Error("Cloud eval report path is required.");
  const audit = buildFieldFidelityAudit(await readJson(inputPath), { exampleLimit, now });
  const outputPath = outPath ? await writeJson(outPath, audit) : null;
  return { audit, output_path: outputPath };
}

function parseArgs(argv) {
  const options = { inputPath: "", outPath: "", exampleLimit: 3, help: false };
  const positional = [];
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (["--input", "--out", "--examples"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === "--input") options.inputPath = value;
      if (arg === "--out") options.outPath = value;
      if (arg === "--examples") options.exampleLimit = Number(value);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (!options.inputPath) options.inputPath = positional[0] || "";
  if (!Number.isFinite(options.exampleLimit) || options.exampleLimit < 0) {
    throw new Error("--examples must be a non-negative number.");
  }
  return options;
}

function usage() {
  return [
    "Usage: node scripts/audit-field-fidelity.mjs --input <cloud-eval-report.json> [--out <audit.json>] [--examples 3]",
    "       node scripts/audit-field-fidelity.mjs <cloud-eval-report.json> [--out <audit.json>]"
  ].join("\n");
}

export async function main(argv = process.argv) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!options.inputPath) throw new Error(`${usage()}\nCloud eval report path is required.`);
  const { audit, output_path: outputPath } = await auditFieldFidelityFile(options);
  if (!outputPath) {
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  } else {
    process.stdout.write([
      `field fidelity audit ${audit.status}`,
      `output: ${outputPath}`,
      `cards: ${audit.summary.card_count}`,
      `fields: ${audit.summary.field_count}`,
      `loss: ${audit.summary.counts.loss}`,
      `recovery: ${audit.summary.counts.recovery}`,
      `pollution: ${audit.summary.counts.pollution}`,
      `provider_unread: ${audit.summary.counts.provider_unread}`,
      `resolver_loss: ${audit.summary.counts.resolver_loss}`,
      `presentation_loss: ${audit.summary.counts.presentation_loss}`,
      `reviewed_sem_cards: ${audit.summary.reviewed_sem_card_count}`
    ].join("\n") + "\n");
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Field fidelity audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
