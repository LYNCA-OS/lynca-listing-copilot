// Pure derivation packet for knowledge/retrieval consumers. It never mutates
// resolved fields and never renders a title. Every derived value is typed and
// versioned; Identity Resolver remains the sole field-application owner.

import {
  buildForwardEnumerationCandidatePacket,
  outcomes
} from "./constraint-enumerator.mjs";
import { normalizeSubject } from "./subject-normalizer.mjs";

export const derivedFieldsVersion = "derived-fields-v2";
export const derivedFieldsSchemaVersion = "derived-fields-packet-v1";

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const present = (value) => Array.isArray(value)
  ? value.some((item) => cleanText(item))
  : Boolean(cleanText(value));

function provenance(ruleId, { source = "DETERMINISTIC_NORMALIZATION", trust = "HEURISTIC_FACT" } = {}) {
  return Object.freeze({
    source,
    trust,
    version: derivedFieldsVersion,
    rule_id: ruleId,
    permissions: Object.freeze(["QUERY_EXPANSION"])
  });
}

function typed(status, {
  field,
  value = null,
  candidates = [],
  reason,
  ruleId = reason,
  source,
  trust
} = {}) {
  return Object.freeze({
    field,
    status,
    value,
    candidates: Object.freeze([...new Set(candidates.map(cleanText).filter(Boolean))]),
    reason,
    provenance: provenance(ruleId, { source, trust })
  });
}

const tcgProductPattern = /\b(lorcana|magic|mtg|pok[eé]mon|yu-?gi-?oh|weiss schwarz|one piece|dragon ball|flesh and blood|digimon|metazoo)\b/i;
const entertainmentProductPattern = /\b(disney|star wars|marvel|dc comics|game of thrones|garbage pail|veefriends|dune|topps now star wars)\b/i;
const explicitSportProductHints = Object.freeze([
  [/\bbaseball\b/i, "baseball"],
  [/\bbasketball\b/i, "basketball"],
  [/\bfootball\b/i, "football"],
  [/\b(hockey|nhl)\b/i, "hockey"],
  [/\b(soccer|uefa|fifa|champions league|la liga|futera|road to fifa)\b/i, "soccer"],
  [/\b(wwe|aew)\b/i, "wwe"],
  [/\bufc\b/i, "ufc"],
  [/\btennis\b/i, "tennis"],
  [/\bgolf\b/i, "golf"],
  [/\b(racing|formula 1|f1|nascar)\b/i, "racing"]
]);

// Cross-sport brands (Bowman, Topps Chrome, Prizm, Donruss, Select) are
// intentionally absent. A generic brand cannot safely determine a sport.
export function deriveCardType(fields = {}) {
  const haystack = [fields.product, fields.brand, fields.manufacturer, fields.set, fields.card_name]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  if (!haystack) {
    return typed(outcomes.UNKNOWN, { field: "sport", reason: "no_product_context" });
  }
  if (tcgProductPattern.test(haystack)) {
    return Object.freeze({
      ...typed(outcomes.VALUE, { field: "sport", value: "tcg", candidates: ["tcg"], reason: "tcg_product_line" }),
      category: "TCG"
    });
  }
  if (entertainmentProductPattern.test(haystack)) {
    return Object.freeze({
      ...typed(outcomes.VALUE, {
        field: "sport",
        value: "entertainment",
        candidates: ["entertainment"],
        reason: "entertainment_licence"
      }),
      category: "NON_TCG_ENTERTAINMENT"
    });
  }
  const match = explicitSportProductHints.find(([pattern]) => pattern.test(haystack));
  if (match) {
    return Object.freeze({
      ...typed(outcomes.VALUE, { field: "sport", value: match[1], candidates: [match[1]], reason: "explicit_sport_product_line" }),
      category: "SPORT"
    });
  }
  return typed(outcomes.UNKNOWN, { field: "sport", reason: "product_not_in_type_map" });
}

function subjectDerivation(fields = {}) {
  const normalized = normalizeSubject(fields);
  if (!normalized.subjects.length) {
    return typed(outcomes.UNKNOWN, { field: "players", reason: "no_subject_read" });
  }
  return typed(outcomes.VALUE, {
    field: "players",
    value: normalized.subjects,
    candidates: normalized.subjects,
    reason: normalized.changed ? "subject_query_normalized" : "subject_already_canonical",
    source: "CURRENT_OBSERVATION_NORMALIZATION",
    trust: "HEURISTIC_FACT"
  });
}

export function deriveFields(fields = {}, model = null) {
  const subject = subjectDerivation(fields);
  const sport = present(fields.sport)
    ? typed(outcomes.UNKNOWN, { field: "sport", reason: "observed_sport_already_present" })
    : deriveCardType(fields);
  const queryExpansionFields = {};
  if (subject.status === outcomes.VALUE && subject.reason === "subject_query_normalized") {
    queryExpansionFields.players = subject.value;
    queryExpansionFields.player = subject.value[0] || null;
  }
  if (sport.status === outcomes.VALUE) queryExpansionFields.sport = sport.value;

  // Heuristic query expansions are intentionally not fed into the constraint
  // packet here. Promotion from query expansion to candidate support is a policy
  // decision, and must not happen implicitly inside a convenience wrapper.
  const candidatePacket = buildForwardEnumerationCandidatePacket(fields, model);
  return Object.freeze({
    schema_version: derivedFieldsSchemaVersion,
    derivation_version: derivedFieldsVersion,
    query_expansion_fields: Object.freeze(queryExpansionFields),
    query_expansion_candidates: Object.freeze([subject, sport]),
    forward_enumeration_candidate_packet: candidatePacket,
    trace: Object.freeze({
      subject,
      sport,
      constraints: candidatePacket.trace
    }),
    field_application_owner: "IDENTITY_RESOLVER",
    title_application_allowed: false,
    title_changed: false
  });
}

export function summariseDerivation(packets = []) {
  const summary = { VALUE: 0, EMPTY: 0, UNKNOWN: 0, by_field: {} };
  for (const packet of packets) {
    const trace = packet?.trace || packet || {};
    const entries = [trace.subject, trace.sport, ...(Array.isArray(trace.constraints) ? trace.constraints : [])]
      .filter(Boolean);
    for (const entry of entries) {
      if (!Object.hasOwn(summary, entry.status)) continue;
      summary[entry.status] += 1;
      const field = cleanText(entry.field) || "unknown";
      summary.by_field[field] ||= { VALUE: 0, EMPTY: 0, UNKNOWN: 0 };
      summary.by_field[field][entry.status] += 1;
    }
  }
  return summary;
}
