import { claimField, clean, normalizeClaimValue } from "./semantic-publication-contract.mjs";

export function createConceptIndex(concepts = []) {
  const byId = new Map();
  const aliasToId = new Map();
  for (const concept of concepts) {
    const id = clean(concept.id);
    if (!id) throw new Error("concept_id_required");
    if (byId.has(id)) throw new Error(`duplicate_concept_id:${id}`);
    const field = claimField(concept.field);
    const aliases = [...new Set([concept.label, ...(concept.aliases || [])]
      .map(normalizeClaimValue)
      .filter(Boolean))];
    byId.set(id, {
      id,
      field,
      parents: [...new Set((concept.parents || []).map(clean).filter(Boolean))],
      aliases
    });
    for (const alias of aliases) {
      const key = `${field}:${alias}`;
      const existing = aliasToId.get(key);
      if (existing && existing !== id) throw new Error(`ambiguous_concept_alias:${key}`);
      aliasToId.set(key, id);
    }
  }

  for (const concept of byId.values()) {
    for (const parentId of concept.parents) {
      const parent = byId.get(parentId);
      if (!parent) throw new Error(`unknown_parent_concept_id:${concept.id}:${parentId}`);
      if (parent.field !== concept.field) throw new Error(`parent_concept_field_mismatch:${concept.id}:${parentId}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`concept_hierarchy_cycle:${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of byId.get(id)?.parents || []) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  return { byId, aliasToId };
}

export function prepareClaimIdentity(claim = {}, index, {
  identity_error = "claim_field_and_identity_required"
} = {}) {
  const field = claimField(claim.field);
  const explicit = clean(claim.concept_id);
  const normalizedValue = normalizeClaimValue(claim.value);
  let conceptId = "";
  if (explicit) {
    const concept = index.byId.get(explicit);
    if (!concept) throw new Error(`unknown_concept_id:${explicit}`);
    if (concept.field !== field) throw new Error(`concept_field_mismatch:${explicit}`);
    if (!normalizedValue) throw new Error(`concept_value_required:${explicit}`);
    if (!concept.aliases.includes(normalizedValue)) throw new Error(`concept_value_mismatch:${explicit}`);
    conceptId = explicit;
  } else {
    conceptId = index.aliasToId.get(`${field}:${normalizedValue}`) || "";
  }
  const identity = conceptId || normalizedValue;
  if (!identity) throw new Error(identity_error);
  return {
    ...claim,
    field,
    concept_id: conceptId,
    key: `${field}:${identity}`
  };
}

export function isDescendant(childId, ancestorId, index) {
  if (!childId || !ancestorId) return false;
  if (childId === ancestorId) return true;
  const pending = [childId];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const parent of index.byId.get(current)?.parents || []) {
      if (parent === ancestorId) return true;
      pending.push(parent);
    }
  }
  return false;
}
