import {
  classifyAnchorText,
  collectAnchors,
  normalizeGrader
} from "./anchor-classifier.mjs";

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  return value !== null && value !== undefined && cleanText(value) !== "";
}

function clamp01(value, fallback = 0.78) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function list(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  return hasValue(value) ? [cleanText(value)] : [];
}

function resolvedFromPayload(payload = {}) {
  return [payload.resolved, payload.resolvedHint, payload.resolved_hint]
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .reduce((merged, entry) => ({ ...merged, ...entry }), {});
}

function patchValue(patch = {}) {
  return patch.value ?? patch.normalized_value ?? patch.normalizedValue ?? patch.raw_text ?? patch.rawText ?? null;
}

function patchList(payload = {}) {
  const initial = payload.preingestion_initial_evidence && typeof payload.preingestion_initial_evidence === "object"
    ? Object.values(payload.preingestion_initial_evidence)
    : [];
  return [
    ...initial,
    ...(Array.isArray(payload.preingestion_evidence_patches) ? payload.preingestion_evidence_patches : [])
  ].filter((patch) => patch && typeof patch === "object" && !Array.isArray(patch));
}

function directPatch(patch = {}) {
  const source = cleanText(patch.source_type || patch.sourceType).toUpperCase();
  return /OCR|PADDLE|CARD_FRONT|CARD_BACK|SLAB|PRINTED|OPERATOR/.test(source);
}

function yearFromText(value = "") {
  const text = cleanText(value);
  return text.match(/\b(?:19|20)\d{2}(?:\s*[-/]\s*\d{2})?\b/)?.[0]?.replace(/\s+/g, "") || "";
}

function addCandidate(target, value, patch = {}, fallbackConfidence = 0.78) {
  const normalized = cleanText(value);
  if (!normalized) return;
  target.push({
    value: normalized,
    confidence: clamp01(patch.confidence, fallbackConfidence),
    source_type: cleanText(patch.source_type || patch.sourceType) || "PAYLOAD_HINT",
    source_field: cleanText(patch.field || patch.evidence_field),
    source_image_id: cleanText(patch.source_image_id || patch.sourceImageId),
    crop_type: cleanText(patch.provenance?.crop_type || patch.crop_type || patch.cropType),
    direct: directPatch(patch)
  });
}

function best(candidates = []) {
  return [...candidates].sort((left, right) => (
    Number(right.direct === true) - Number(left.direct === true)
    || Number(right.confidence || 0) - Number(left.confidence || 0)
  ))[0] || null;
}

function dedupeAnchors(anchors = []) {
  const seen = new Set();
  return anchors.filter((anchor) => {
    const key = `${anchor.anchor_type}:${anchor.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function anchorCandidateBuckets(anchors = []) {
  const rows = (type) => anchors
    .filter((anchor) => anchor.anchor_type === type)
    .map((anchor) => ({
      value: anchor.normalized,
      confidence: anchor.confidence,
      direct: anchor.direct === true,
      source_type: anchor.source_type,
      source_field: anchor.source_field,
      grader: anchor.grader || undefined
    }));
  return {
    tcg_code: rows("tcg_card_code"),
    card_number: [...rows("checklist_code"), ...rows("collector_number")],
    checklist_code: rows("checklist_code"),
    collector_number: rows("collector_number"),
    product_code: rows("product_code"),
    barcode: rows("barcode_candidate"),
    cert_number: rows("cert_number"),
    numerical_rarity: rows("numerical_rarity")
  };
}

export function extractAnchorDossier(payload = {}) {
  const resolved = resolvedFromPayload(payload);
  const patches = patchList(payload);
  const contextCandidates = {
    year: [],
    product: [],
    subjects: [],
    grader: []
  };

  addCandidate(contextCandidates.year, resolved.year, {}, 0.72);
  addCandidate(contextCandidates.product, resolved.product_family || resolved.product || resolved.set, {}, 0.72);
  list(resolved.players || resolved.subject || resolved.character).forEach((value) => (
    addCandidate(contextCandidates.subjects, value, {}, 0.72)
  ));
  addCandidate(contextCandidates.grader, normalizeGrader(resolved.grade_company), {}, 0.8);

  const patchAnchors = [];
  for (const patch of patches) {
    const field = cleanText(patch.field || patch.evidence_field).toLowerCase();
    const value = patchValue(patch);
    const confidence = clamp01(patch.confidence, 0.78);
    const cropHint = cleanText(patch.provenance?.crop_type || patch.crop_type || patch.cropType);
    if (!hasValue(value)) continue;

    if (/^(?:year|year_candidate)$/.test(field)) addCandidate(contextCandidates.year, value, patch);
    if (/product|set/.test(field)) {
      addCandidate(contextCandidates.product, value, patch);
      const year = yearFromText(value);
      if (year) addCandidate(contextCandidates.year, year, patch);
    }
    if (/player|subject|character/.test(field)) {
      list(value).forEach((entry) => addCandidate(contextCandidates.subjects, entry, patch));
    }
    if (/grade_company/.test(field)) addCandidate(contextCandidates.grader, normalizeGrader(value), patch);

    const anchor = classifyAnchorText(value, {
      graderHint: normalizeGrader(resolved.grade_company || best(contextCandidates.grader)?.value),
      fieldHint: field,
      cropHint
    });
    if (!anchor || anchor.anchor_type === "unknown") continue;
    patchAnchors.push({
      ...anchor,
      confidence,
      source_field: field,
      source_type: cleanText(patch.source_type || patch.sourceType) || "PREINGESTION",
      source_image_id: cleanText(patch.source_image_id || patch.sourceImageId),
      crop_type: cropHint,
      direct: directPatch(patch)
    });
  }

  const resolvedAnchors = collectAnchors({ resolved }).map((anchor) => ({
    ...anchor,
    confidence: 0.72,
    source_type: "RESOLVED_HINT",
    direct: false
  }));
  const resolvedGrader = normalizeGrader(best(contextCandidates.grader)?.value || resolved.grade_company);
  const anchors = dedupeAnchors([...patchAnchors, ...resolvedAnchors]).map((anchor) => (
    anchor.anchor_type === "cert_number" && !anchor.grader && resolvedGrader
      ? { ...anchor, grader: resolvedGrader }
      : anchor
  ));
  const year = best(contextCandidates.year);
  const product = best(contextCandidates.product);
  const subjects = contextCandidates.subjects
    .sort((left, right) => Number(right.direct === true) - Number(left.direct === true) || right.confidence - left.confidence)
    .filter((entry, index, all) => all.findIndex((other) => other.value.toLowerCase() === entry.value.toLowerCase()) === index)
    .slice(0, 4);
  const grader = best(contextCandidates.grader);

  return {
    schema_version: "v4-anchor-dossier-v1",
    anchors,
    anchor_candidates: anchorCandidateBuckets(anchors),
    context: {
      year: year?.value || "",
      year_confidence: year?.confidence ?? null,
      year_direct: year?.direct === true,
      manufacturer: cleanText(resolved.manufacturer || resolved.brand),
      product: product?.value || "",
      product_confidence: product?.confidence ?? null,
      product_direct: product?.direct === true,
      set: cleanText(resolved.set),
      subjects: subjects.map((entry) => entry.value),
      subject_confidence: subjects[0]?.confidence ?? null,
      subject_direct: subjects.some((entry) => entry.direct === true),
      grader: normalizeGrader(grader?.value || resolved.grade_company)
    },
    patch_count: patches.length,
    direct_anchor_count: anchors.filter((anchor) => anchor.direct === true).length
  };
}

export function resolvedHintFromAnchorDossier(dossier = {}) {
  const context = dossier.context || {};
  const tcg = dossier.anchors?.find((anchor) => anchor.anchor_type === "tcg_card_code");
  const checklist = dossier.anchors?.find((anchor) => anchor.anchor_type === "checklist_code");
  const collector = dossier.anchors?.find((anchor) => anchor.anchor_type === "collector_number");
  return Object.fromEntries(Object.entries({
    year: context.year,
    manufacturer: context.manufacturer,
    product: context.product,
    set: context.set,
    players: context.subjects?.length ? context.subjects : undefined,
    tcg_card_number: tcg?.normalized,
    checklist_code: checklist?.normalized,
    collector_number: collector?.normalized
  }).filter(([, value]) => hasValue(value)));
}
