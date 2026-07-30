// Query-only cleanup for subject identity. This module never writes resolved
// fields: it only removes within-observation duplication/noise before retrieval
// or constraint lookup. Identity Resolver remains the field owner.

import {
  canonicalSubjectComparable,
  collapseDescriptorExtendedSubjectIdentities,
  foldLatinDiacritics
} from "../pipeline/subject-identity.mjs";

export const subjectNormalizerVersion = "subject-normalizer-v2";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const folded = (value) => foldLatinDiacritics(value).toLowerCase();

function subjectValues(claim = {}) {
  const plural = claim.players ?? claim.subjects;
  if (Array.isArray(plural) && plural.length) return plural.map(cleanText).filter(Boolean);
  const singular = claim.player ?? claim.subject ?? claim.character;
  return cleanText(singular) ? [cleanText(singular)] : [];
}

export function isTruncationOf(shorter, longer) {
  const left = folded(shorter);
  const right = folded(longer);
  if (!left || !right || left === right) return false;
  if (left.split(/\s+/).length !== right.split(/\s+/).length) return false;
  return right.startsWith(left) && right.length - left.length <= 2;
}

export function mergeTruncatedSubjects(subjects = []) {
  const input = Array.isArray(subjects) ? subjects : [subjects];
  const list = collapseDescriptorExtendedSubjectIdentities(input.map(cleanText).filter(Boolean));
  return list.filter((candidate) => !list.some((other) => isTruncationOf(candidate, other)));
}

const neverStripped = new Set([
  "jr", "sr", "ii", "iii", "iv", "de", "la", "van", "von", "da", "di", "del"
]);

function scalarValues(value) {
  return Array.isArray(value) ? value : [value];
}

function otherFieldTokens(claim = {}) {
  const values = [
    claim.product,
    claim.brand,
    claim.manufacturer,
    claim.set,
    claim.card_name,
    claim.insert,
    claim.parallel,
    claim.parallel_exact,
    claim.parallel_family,
    claim.surface_color,
    claim.team,
    claim.sport,
    claim.variation,
    claim.subset
  ].flatMap(scalarValues);
  return new Set(values.flatMap((value) => canonicalSubjectComparable(value).split(/\s+/)).filter(Boolean));
}

export function stripForeignTokens(subject = "", claim = {}) {
  const text = cleanText(subject);
  if (!text) return "";
  const elsewhere = otherFieldTokens(claim);
  if (!elsewhere.size) return text;

  const words = text.split(/\s+/);
  const survivors = words.filter((word) => {
    const tokens = canonicalSubjectComparable(word).split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens.some((token) => neverStripped.has(token))) return true;
    return !tokens.every((token) => elsewhere.has(token));
  });

  // Removing an entire identity, or reducing a multi-token identity to one
  // fragment, would create a different person rather than clean this reading.
  if (!survivors.length || (words.length >= 2 && survivors.length < 2)) return text;
  return survivors.join(" ");
}

export function normalizeSubject(claim = {}) {
  const raw = subjectValues(claim);
  const merged = mergeTruncatedSubjects(raw);
  const cleaned = merged.map((subject) => stripForeignTokens(subject, claim)).filter(Boolean);
  const subjects = cleaned.length ? cleaned : merged;
  return Object.freeze({
    subject: subjects[0] || "",
    subjects: Object.freeze(subjects),
    changed: subjects.join(" / ") !== raw.join(" / "),
    version: subjectNormalizerVersion
  });
}

// The lookup is deliberately unique-or-null. Accent folding and a one/two
// character tail repair may expand a query, but ambiguity never becomes an
// identity assertion.
export function resolveAgainstIndex(subject = "", indexKeys = []) {
  const wanted = cleanText(subject);
  if (!wanted) return null;
  const keys = [...(Array.isArray(indexKeys) ? indexKeys : indexKeys || [])]
    .map(cleanText)
    .filter(Boolean);
  const wantedCanonical = canonicalSubjectComparable(wanted);
  const exact = keys.filter((key) => canonicalSubjectComparable(key) === wantedCanonical);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const tail = keys.filter((key) => isTruncationOf(wanted, key));
  return tail.length === 1 ? tail[0] : null;
}
