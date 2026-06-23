import { normalizeResolvedFields } from "../evidence/evidence-schema.mjs";
import { resolveGradeFields } from "./grade-resolver.mjs";
import { resolveNumberFields } from "./number-resolver.mjs";

export function resolveCardFields({
  resolved = {},
  legacyFields = {}
} = {}) {
  let next = normalizeResolvedFields(resolved);
  const notes = [];

  const numberResult = resolveNumberFields({
    resolved: next,
    legacyFields
  });
  next = normalizeResolvedFields(numberResult.resolved);
  notes.push(...numberResult.notes);

  const gradeResult = resolveGradeFields({
    resolved: next,
    legacyFields
  });
  next = normalizeResolvedFields(gradeResult.resolved);
  notes.push(...gradeResult.notes);

  return {
    resolved: next,
    resolution_trace: notes
  };
}
