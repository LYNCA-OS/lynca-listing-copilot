// Rebuild the output from stored rows alone.
//
// COS-25's acceptance criterion is "every downstream layer can be replayed from
// stored evidence and version references". That one cannot be retrofitted: a
// pipeline that persists a summary instead of the inputs is unreplayable
// forever, and you only find out when you need to re-derive something.
//
// So this takes ONLY the rows -- no original provider payload, no in-memory
// fields object -- and reconstructs the canonical object and the composed
// title. If it disagrees with what was shipped, either persistence dropped
// something or composition is not deterministic, and the check says which.
//
// What it deliberately does not do is call the model again. Replay is about
// the layers below recognition; the observation itself is the one thing that
// cannot be replayed, which is exactly why the evidence rows exist.

import { composeFromCanonicalFields } from "./canonical-composer.mjs";
import { MARKETPLACE_PROFILES } from "./marketplace-composer-rules.mjs";
import {
  CSM_BRACKETS,
  COMPOSITION_GRAMMARS,
  EBAY_PROFILE_VERSION,
  THIN_COMPOSER_VERSION,
  computeCsmPacketHashes,
  csmIdentityGrammarForComposition
} from "./csm-persistence.mjs";

export class CsmReplayError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}:${detail}` : code);
    this.name = "CsmReplayError";
    this.code = code;
    this.detail = detail;
  }
}

// A stored version selects executable rules explicitly. Falling through to the
// current implementation would make an old row silently change meaning after
// a deployment, which is the opposite of replay.
const COMPOSER_DISPATCH = Object.freeze({
  [THIN_COMPOSER_VERSION]: Object.freeze({
    [EBAY_PROFILE_VERSION]: (fields) => composeFromCanonicalFields(fields, {
      profile: MARKETPLACE_PROFILES.ebay
    })
  })
});

function replayComposer(output) {
  const byProfile = COMPOSER_DISPATCH[output?.composer_version];
  const compose = byProfile?.[output?.marketplace_profile_version];
  if (!compose) {
    throw new CsmReplayError("unsupported_replay_version",
      `${output?.composer_version || "missing"}/${output?.marketplace_profile_version || "missing"}`);
  }
  if (output?.marketplace !== "EBAY") {
    throw new CsmReplayError("unsupported_marketplace", output?.marketplace || "missing");
  }
  return compose;
}

function replayCompositionGrammar(rows) {
  const identityGrammar = rows?.resolution?.grammar;
  const stored = rows?.output?.structured_output?.composition_grammar;
  let grammar = String(stored || "").trim().toLowerCase();

  if (!grammar) {
    // Backward compatibility for rows written before composition_grammar was
    // persisted. TCG identity is unambiguous. Under composer v1 every Lot title
    // includes the non-droppable `lot` bracket, so the projection ledger safely
    // distinguishes Lot from Standard. Anything less is ambiguous and closed.
    if (identityGrammar === "TCG") grammar = "tcg";
    else if (identityGrammar === "NON_TCG"
      && Array.isArray(rows?.output?.included_brackets)
      && rows.output.included_brackets.length > 0) {
      grammar = rows.output.included_brackets.includes("lot") ? "lot" : "standard";
    } else {
      throw new CsmReplayError("composition_grammar_missing_or_ambiguous", identityGrammar || "missing");
    }
  }

  if (!COMPOSITION_GRAMMARS.includes(grammar)) {
    throw new CsmReplayError("unsupported_composition_grammar", grammar);
  }
  if (csmIdentityGrammarForComposition(grammar) !== identityGrammar) {
    throw new CsmReplayError("identity_composition_grammar_mismatch", `${identityGrammar}/${grammar}`);
  }
  return grammar;
}

// CSM bracket -> the field name the composer reads. The inverse of the map in
// csm-persistence, and it has the same many-to-one problem in reverse: [Print
// Finish] was stored as one bracket and the composer wants the three layers
// back, so the stored value is returned as `parallel_exact` -- the layer that
// renders verbatim. Round-tripping it through colour and family would be
// guessing which parts of "Gold Refractor" were which.
const FIELD_FOR_BRACKET = Object.freeze({
  subject: "subjects",
  grading_info: "grade",
  numerical_rarity: "serial",
  search_optimization: "team"
});

/**
 * @param rows as produced by `buildCsmStageRows`
 * @returns { fields, title, grammar } rebuilt from the rows
 */
export function replayFromRows(rows) {
  const compose = replayComposer(rows?.output);
  const compositionGrammar = replayCompositionGrammar(rows);
  const resolved = rows.resolved || [];
  const fields = {
    subjects: [], attributes: [], components: [], unreadable: [], low_confidence: [],
    grammar: compositionGrammar, lot_count: ""
  };

  for (const row of resolved) {
    const name = FIELD_FOR_BRACKET[row.bracket] || row.bracket;
    if (row.selected_kind === "EMPTY") {
      // The stored reason is what makes the two empties distinguishable on the
      // way back. Losing it here would make a replayed object claim the card
      // lacks a field when the record says it was merely unreadable.
      if (row.empty_reason === "INSUFFICIENT_EVIDENCE") fields.unreadable.push(row.bracket);
      continue;
    }
    const value = row.canonical_value;
    // [Print Finish] is restored from the layers the projection row kept, not
    // from the bracket: the bracket holds the ladder's OUTPUT and the eBay rule
    // needs its inputs. Without this a withheld bare colour replays as a
    // projected exact name.
    if (row.bracket === "print_finish") continue;
    // `grading_info` is an object in SEM ({ card_grade, auto_grade, ... }), and
    // stringifying it produced "[object Object]" in a composed title.
    if (row.bracket === "grading_info") {
      fields.grade = typeof value === "object" && value
        ? [value.grade_company, value.card_grade].filter(Boolean).join(" ") || String(value.card_grade ?? "")
        : String(value);
      continue;
    }
    if (name === "subjects") fields.subjects = Array.isArray(value) ? value : [value];
    else if (name === "team") fields.team = Array.isArray(value) ? value.join(" ") : String(value);
    else fields[name] = Array.isArray(value) ? value.join(" ") : String(value);

    // Low semantic confidence on the way in was a flagged field; restore that
    // so a replayed object carries the same review state as the original.
    if (row.semantic_confidence !== undefined && row.semantic_confidence < 0.8) {
      fields.low_confidence.push(row.bracket);
    }
  }

  // `search_optimization` collapses RC / Auto / Patch / Relic and the team into
  // one bracket, so the components come back out of it rather than from a
  // components column that the schema does not have.
  const search = resolved.find((row) => row.bracket === "search_optimization");
  if (search && Array.isArray(search.canonical_value)) {
    const COMPONENTS = new Set(["RC", "Auto", "Patch", "Relic", "Jersey"]);
    fields.team = search.canonical_value.filter((value) => !COMPONENTS.has(value)).join(" ");
  }
  // Components come from the projection row, not inferred back out of
  // search_optimization: that bracket drops Jersey and fixes the order.
  fields.components = [...(rows.output?.structured_output?.components || [])];
  fields.attributes = [...fields.components];
  // `ip_sport` is the CSM name; the composer's bracket is `ip`.
  const ipRow = resolved.find((row) => row.bracket === "ip_sport" && row.selected_kind === "VALUE");
  if (ipRow) fields.ip = Array.isArray(ipRow.canonical_value) ? ipRow.canonical_value.join(" ") : String(ipRow.canonical_value);

  fields.lot_count = rows.output?.structured_output?.lot_count || "";
  const layers = rows.output?.structured_output?.print_finish_layers;
  if (layers) {
    fields.parallel_exact = layers.parallel_exact || "";
    fields.surface_color = layers.surface_color || "";
    fields.parallel_family = layers.parallel_family || "";
    fields.print_finish = fields.parallel_exact
      || (fields.surface_color && fields.parallel_family
        ? (fields.parallel_family.toLowerCase().includes(fields.surface_color.toLowerCase())
          ? fields.surface_color : `${fields.surface_color} ${fields.parallel_family}`)
        : fields.surface_color || fields.parallel_family || "");
  }

  const composed = compose(fields);
  return { fields, title: composed.title, grammar: composed.grammar, composed };
}

function packetHashProblems(rows) {
  const computed = computeCsmPacketHashes(rows);
  const session = rows?.session_hashes || rows?.session;
  const problems = [];
  const checks = [
    ["recognition", "resolution.recognition_packet_sha256", rows?.resolution?.recognition_packet_sha256,
      computed.csm_recognition_packet_sha256],
    ["resolution", "output.resolution_packet_sha256", rows?.output?.resolution_packet_sha256,
      computed.csm_resolution_packet_sha256]
  ];

  if (!session || typeof session !== "object") {
    problems.push({ kind: "session_packet_hashes_missing" });
  } else {
    checks.push(
      ["recognition", "session.csm_recognition_packet_sha256", session.csm_recognition_packet_sha256,
        computed.csm_recognition_packet_sha256],
      ["resolution", "session.csm_resolution_packet_sha256", session.csm_resolution_packet_sha256,
        computed.csm_resolution_packet_sha256],
      ["marketplace", "session.csm_marketplace_packet_sha256", session.csm_marketplace_packet_sha256,
        computed.csm_marketplace_packet_sha256]
    );
  }

  for (const [packet, source, stored, actual] of checks) {
    if (!stored) problems.push({ kind: "packet_hash_missing", packet, source });
    else if (stored !== actual) problems.push({ kind: "packet_hash_mismatch", packet, source, stored, actual });
  }
  return problems;
}

/**
 * Did the replay reproduce what shipped?
 *
 * Reports the specific disagreement rather than a boolean: "replay failed" is
 * not actionable, "replay lost print_finish" is.
 */
export function verifyReplay(rows, originalTitle) {
  const problems = packetHashProblems(rows);

  // Every bracket the resolution recorded must come back. A bracket that
  // vanishes between store and replay is persistence losing data, which is the
  // failure this whole exercise exists to make visible.
  const storedBrackets = new Set((rows.resolved || []).map((row) => row.bracket));
  for (const bracket of CSM_BRACKETS) {
    if (!storedBrackets.has(bracket)) problems.push({ kind: "bracket_not_persisted", bracket });
  }

  // Never execute a composer over rows whose persisted packet chain is broken.
  // The caller still gets exact hash/bracket diagnostics, but no result that
  // could be mistaken for a trusted replay.
  if (problems.length > 0) return { ok: false, problems, replayed: null };

  let replayed;
  try {
    replayed = replayFromRows(rows);
  } catch (error) {
    if (error instanceof CsmReplayError) {
      problems.push({ kind: error.code, detail: error.detail });
      return { ok: false, problems, replayed: null };
    }
    throw error;
  }

  if (replayed.title !== originalTitle) {
    problems.push({
      kind: "title_mismatch",
      stored: rows.output?.title ?? null,
      original: originalTitle,
      replayed: replayed.title
    });
  }
  if (rows.output && rows.output.title !== originalTitle) {
    problems.push({ kind: "stored_title_mismatch", stored: rows.output.title, original: originalTitle });
  }

  return { ok: problems.length === 0, problems, replayed };
}
