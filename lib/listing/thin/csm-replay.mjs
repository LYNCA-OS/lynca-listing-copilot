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
import { CSM_BRACKETS } from "./csm-persistence.mjs";

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
  const resolved = rows.resolved || [];
  const fields = {
    subjects: [], attributes: [], components: [], unreadable: [], low_confidence: [],
    grammar: rows.resolution?.grammar || "standard", lot_count: ""
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

  const composed = composeFromCanonicalFields(fields);
  return { fields, title: composed.title, grammar: composed.grammar, composed };
}

/**
 * Did the replay reproduce what shipped?
 *
 * Reports the specific disagreement rather than a boolean: "replay failed" is
 * not actionable, "replay lost print_finish" is.
 */
export function verifyReplay(rows, originalTitle) {
  const replayed = replayFromRows(rows);
  const problems = [];

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

  // Every bracket the resolution recorded must come back. A bracket that
  // vanishes between store and replay is persistence losing data, which is the
  // failure this whole exercise exists to make visible.
  const storedBrackets = new Set((rows.resolved || []).map((row) => row.bracket));
  for (const bracket of CSM_BRACKETS) {
    if (!storedBrackets.has(bracket)) problems.push({ kind: "bracket_not_persisted", bracket });
  }

  return { ok: problems.length === 0, problems, replayed };
}
