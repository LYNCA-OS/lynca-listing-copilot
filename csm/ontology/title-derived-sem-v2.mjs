// Lossless title -> SEM observation envelope.
//
// V1 is a typed extractor. Its failure mode is irreversible: text it cannot
// classify disappears, so a later Registry or world model never gets the
// chance to recover it. V2 keeps V1's conservative typed fields and adds an
// ordered token ledger. Unknown spans remain evidence, never canonical truth.

import { titleDerivedSemSuggestion } from "./title-derived-sem.mjs";

export const LOSSLESS_TITLE_SEM_PARSER_VERSION = "lossless-title-sem-v2";

const tokenPattern = /\d+\s*\/\s*\d+|#?\s*\/\s*\d+|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const normalizedToken = (value) => clean(value).toLowerCase().replace(/\s*\/\s*/g, "/");

function tokensWithOffsets(text = "") {
  return [...String(text).matchAll(tokenPattern)].map((match, index) => ({
    index,
    text: match[0],
    normalized: normalizedToken(match[0]),
    start: match.index,
    end: match.index + match[0].length
  }));
}
function typedValues(value, path = []) {
  if (Array.isArray(value)) return value.flatMap((item) => typedValues(item, path));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => typedValues(item, [...path, key]));
  }
  const text = clean(value);
  return text ? [{ field: path[0] || "unknown", path: path.join("."), text }] : [];
}

function markTypedTokens(tokens, typed) {
  const owners = tokens.map(() => new Set());
  for (const value of typed) {
    const needle = tokensWithOffsets(value.text).map((token) => token.normalized);
    if (!needle.length) continue;
    for (let start = 0; start <= tokens.length - needle.length; start += 1) {
      if (!needle.every((token, offset) => tokens[start + offset].normalized === token)) continue;
      for (let offset = 0; offset < needle.length; offset += 1) owners[start + offset].add(value.field);
    }
  }
  return owners;
}

function candidateBrackets(spanTokens = []) {
  const text = spanTokens.map((token) => token.normalized).join(" ");
  if (/^(?:#?\/\d+|\d+\/\d+)$/.test(text)) return ["numerical_rarity", "card_number"];
  if (/^(?:rc|rookie|auto|autograph|patch|relic|jersey|ssp|sp|case hit)$/.test(text)) {
    return ["search_optimization", "descriptive_rarity"];
  }
  return ["product", "set", "card_name", "subject", "search_optimization", "description"];
}

function unassignedSpans(source, tokens, owners) {
  const spans = [];
  let start = 0;
  while (start < tokens.length) {
    if (owners[start].size) { start += 1; continue; }
    let end = start + 1;
    while (end < tokens.length && !owners[end].size) end += 1;
    const slice = tokens.slice(start, end);
    spans.push({
      text: source.slice(slice[0].start, slice.at(-1).end),
      start: slice[0].start,
      end: slice.at(-1).end,
      token_indexes: slice.map((token) => token.index),
      candidate_brackets: candidateBrackets(slice),
      status: "UNASSIGNED",
      permission: "EVIDENCE_ONLY"
    });
    start = end;
  }
  return spans;
}

export function losslessTitleDerivedSem(title = "") {
  const rawTitle = clean(title);
  const sem = titleDerivedSemSuggestion(rawTitle);
  const tokens = tokensWithOffsets(rawTitle);
  const typed = typedValues(sem);
  const owners = markTypedTokens(tokens, typed);
  const ledger = tokens.map((token, index) => ({
    ...token,
    status: owners[index].size ? "TYPED" : "UNASSIGNED",
    typed_fields: [...owners[index]].sort()
  }));
  return Object.freeze({
    parser_version: LOSSLESS_TITLE_SEM_PARSER_VERSION,
    raw_title: rawTitle,
    typed_sem: sem,
    token_ledger: Object.freeze(ledger),
    unassigned_spans: Object.freeze(unassignedSpans(rawTitle, tokens, owners)),
    coverage: Object.freeze({
      total_tokens: ledger.length,
      typed_tokens: ledger.filter((token) => token.status === "TYPED").length,
      preserved_unassigned_tokens: ledger.filter((token) => token.status === "UNASSIGNED").length,
      silently_dropped_tokens: 0
    })
  });
}
