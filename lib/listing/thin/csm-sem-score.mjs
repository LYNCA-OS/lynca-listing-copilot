// CSM's own SEM ruler, applied to a composed title.
//
// `validateTitleDerivedSem` was written for the writer feedback loop: it parses
// a title into a SEM candidate, checks it against the standard's structural
// rules, and returns per-field confidence plus warnings. It has no stake in
// which arm of this evaluation wins, and I did not choose its fields or its
// weights -- which is the property every metric I hand-built lacked, and the
// reason three of the four lost blind calibration to plain token recall.
//
// It measures something different from F1 against the reviewed title, and the
// difference is the point:
//
//   F1 vs reference  -- did we produce the title the writer wanted?
//   SEM confidence   -- is what we produced a well-formed CSM object at all?
//
// A title can score well on the first and badly on the second (right words,
// unparseable structure) or the reverse (clean structure, wrong card). Both are
// needed, and reporting only one is how a structural regression stays invisible
// -- exactly what happened when Deterministic Ordering turned out to cost
// nothing under a scorer that ignores word order.
//
// Field confidence is anchoring-based: a field whose value is literally present
// in the title scores 0.8, a derived or unanchored one 0.4. So this rewards
// titles whose every bracket is traceable to text, which is CSM's
// "output must be traceable to the canonical object that produced it".

import { titleDerivedSemSuggestion, validateTitleDerivedSem } from "../csm/title-derived-sem.mjs";

export function scoreSemQuality(title) {
  const text = String(title ?? "");
  if (!text) return { confidence: 0, structurally_valid: false, errors: ["empty title"], warnings: [], fields: {} };
  const sem = titleDerivedSemSuggestion(text) || {};
  const validation = validateTitleDerivedSem(text, sem);
  return {
    confidence: validation.confidence ?? 0,
    structurally_valid: validation.structurally_valid !== false,
    errors: validation.errors || [],
    warnings: validation.warnings || [],
    fields: validation.confidence_detail?.field_confidence || {},
    field_count: Object.keys(validation.confidence_detail?.field_confidence || {}).length
  };
}

export function summariseSemQuality(rows) {
  const scored = rows.map((row) => scoreSemQuality(row.title));
  const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const warnings = {};
  const errors = {};
  for (const entry of scored) {
    for (const warning of entry.warnings) {
      // Collapse the field list so the counter is about the KIND of warning.
      const key = warning.replace(/:.*$/, "");
      warnings[key] = (warnings[key] ?? 0) + 1;
    }
    for (const error of entry.errors) errors[error] = (errors[error] ?? 0) + 1;
  }
  return {
    n: rows.length,
    sem_confidence: mean(scored.map((entry) => entry.confidence)),
    // How many CSM brackets the parser can recover from the title. A title the
    // parser cannot decompose is not a canonical object, whatever it scores.
    mean_field_count: mean(scored.map((entry) => entry.field_count)),
    structurally_valid: scored.filter((entry) => entry.structurally_valid).length,
    warnings,
    errors
  };
}
