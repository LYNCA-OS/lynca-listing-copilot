import {
  createEvidenceField,
  createVisionSource
} from "../evidence/evidence-schema.mjs";
import { parsePrintRunValue } from "../print-run/print-run-fields.mjs";
import {
  normalizeAutoGradeValue,
  normalizeGradeValue,
  sanitizeGradeFields
} from "../grade/grade-value.mjs";
import { normalizePrintedCardCodeForFields } from "../pipeline/field-normalization.mjs";

export const ocrContractVersion = "paddle-ocr-field-verifier-v1";

export const ocrCropTypes = Object.freeze([
  "print_run_number",
  "print_run_denominator",
  "numbered",
  "serial_number",
  "serial_denominator",
  "collector_number",
  "checklist_code",
  "slab_cert",
  "grade_label",
  "tcg_code",
  "product_text",
  "player_name",
  "serial_crop",
  "card_code_crop",
  "grade_label_crop",
  "year_product_crop",
  "subject_crop"
]);

export const ocrFieldTaskIds = Object.freeze([
  "ocr_serial_verifier",
  "ocr_collector_number_verifier",
  "ocr_slab_label_verifier",
  "ocr_tcg_code_verifier"
]);

const cropTypeAliases = Object.freeze({
  print_run: "print_run_number",
  print_run_crop: "print_run_number",
  print_run_number_crop: "print_run_number",
  print_run_denominator_crop: "print_run_denominator",
  numbered: "print_run_number",
  numbered_crop: "print_run_number",
  serial: "serial_number",
  serial_crop: "serial_number",
  serial_number_crop: "serial_number",
  denominator: "serial_denominator",
  serial_denominator_crop: "serial_denominator",
  card_number: "collector_number",
  card_code: "collector_number",
  card_code_crop: "collector_number",
  collector_number_crop: "collector_number",
  checklist: "checklist_code",
  checklist_code_crop: "checklist_code",
  slab: "grade_label",
  slab_label: "grade_label",
  slab_label_crop: "grade_label",
  grade: "grade_label",
  grade_label_crop: "grade_label",
  tcg: "tcg_code",
  tcg_code_crop: "tcg_code",
  tcg_card_number: "tcg_code",
  year_product: "product_text",
  year_product_crop: "product_text",
  product: "product_text",
  subject: "player_name",
  subject_name: "player_name",
  subject_crop: "player_name",
  player: "player_name",
  player_name_crop: "player_name"
});

const evidenceFieldsByNormalizedField = Object.freeze({
  print_run_number: "print_run_number",
  print_run_numerator: "print_run_numerator",
  print_run_denominator: "print_run_denominator",
  numbered_to: "numbered_to",
  serial_number: "serial_number",
  serial_denominator: "serial_denominator",
  collector_number: "collector_number",
  checklist_code: "checklist_code",
  grade_company: "grade_company",
  card_grade: "card_grade",
  auto_grade: "auto_grade",
  grade_type: "grade_type",
  product_text: "product",
  year: "year",
  player_names: "players",
  tcg_card_number: "tcg_card_number",
  tcg_set_code: "checklist_code"
});

const normalizedFieldsByCropType = Object.freeze({
  print_run_number: new Set([
    "print_run_number",
    "print_run_numerator",
    "print_run_denominator",
    "numbered_to",
    "serial_number",
    "serial_denominator"
  ]),
  serial_number: new Set([
    "print_run_number",
    "print_run_numerator",
    "print_run_denominator",
    "numbered_to",
    "serial_number",
    "serial_denominator"
  ]),
  serial_denominator: new Set([
    "print_run_number",
    "print_run_numerator",
    "print_run_denominator",
    "numbered_to",
    "serial_number",
    "serial_denominator"
  ]),
  collector_number: new Set(["collector_number", "checklist_code"]),
  checklist_code: new Set(["collector_number", "checklist_code"]),
  grade_label: new Set(["grade_company", "card_grade", "auto_grade", "grade_type", "cert_number"]),
  slab_cert: new Set(["grade_company", "card_grade", "auto_grade", "grade_type", "cert_number"]),
  tcg_code: new Set(["tcg_card_number", "tcg_set_code", "rarity"]),
  product_text: new Set(["product_text", "year"]),
  player_name: new Set(["player_names"])
});

const directlyVerifiedGradeFields = new Set(["grade_company", "card_grade", "auto_grade", "grade_type"]);

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  return value !== null && value !== undefined && normalizeText(value) !== "";
}

function validationError(path, message) {
  return { path, message };
}

export function normalizeOcrCropType(cropType = "") {
  const key = normalizeKey(cropType);
  return cropTypeAliases[key] || (ocrCropTypes.includes(key) ? key : "");
}

function normalizeCropBox(cropBox = null) {
  if (!cropBox || typeof cropBox !== "object" || Array.isArray(cropBox)) return null;
  const x = Number(cropBox.x ?? cropBox.left);
  const y = Number(cropBox.y ?? cropBox.top);
  const width = Number(cropBox.width ?? cropBox.w);
  const height = Number(cropBox.height ?? cropBox.h);
  if ([x, y, width, height].some((value) => !Number.isFinite(value))) return null;
  return { x, y, width, height };
}

export function normalizeOcrRequest(input = {}) {
  const requestId = normalizeText(input.request_id || input.requestId);
  const imageUrl = normalizeText(input.image_url || input.imageUrl || input.url);
  const cropType = normalizeOcrCropType(input.crop_type || input.cropType);
  const requestedBackend = normalizeKey(input.ocr_backend || input.ocrBackend);
  return {
    request_id: requestId,
    image_url: imageUrl,
    crop_type: cropType,
    expected_pattern: normalizeText(input.expected_pattern || input.expectedPattern),
    crop_box: normalizeCropBox(input.crop_box || input.cropBox),
    ...(requestedBackend ? { ocr_backend: requestedBackend } : {}),
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? { ...input.metadata }
      : {}
  };
}

export function validateOcrRequest(input = {}) {
  const request = normalizeOcrRequest(input);
  const errors = [];
  if (!request.request_id) errors.push(validationError("request_id", "request_id is required."));
  if (!request.image_url) errors.push(validationError("image_url", "image_url is required."));
  if (!request.crop_type) errors.push(validationError("crop_type", "crop_type is invalid or unsupported."));
  if (request.crop_box) {
    ["x", "y", "width", "height"].forEach((key) => {
      if (!Number.isFinite(request.crop_box[key])) {
        errors.push(validationError(`crop_box.${key}`, "crop_box values must be finite numbers."));
      }
    });
  }
  return errors;
}

function confidenceFromCandidate(candidate = {}, fallback = 0) {
  return clamp01(candidate.confidence ?? candidate.score ?? candidate.probability ?? candidate.ocr_confidence, fallback);
}

function textFromCandidate(candidate) {
  if (typeof candidate === "string") return normalizeText(candidate);
  if (!candidate || typeof candidate !== "object") return "";
  return normalizeText(candidate.text || candidate.raw_text || candidate.rawText || candidate.value || candidate.label || candidate.transcription);
}

function candidateArrays(payload = {}) {
  return [
    payload.text_candidates,
    payload.textCandidates,
    payload.candidates,
    payload.results,
    payload.boxes,
    payload.lines,
    payload.data,
    payload.ocr
  ].filter(Array.isArray);
}

function normalizeTextCandidates(payload = {}) {
  const candidates = candidateArrays(payload)
    .flat()
    .map((candidate) => {
      const text = textFromCandidate(candidate);
      if (!text) return null;
      return {
        text,
        normalized_text: normalizeOcrText(text),
        confidence: confidenceFromCandidate(candidate, confidenceFromCandidate(payload, 0.5)),
        source_kind: "detected_region",
        ocr_pass: candidate && typeof candidate === "object"
          ? normalizeText(candidate.ocr_pass || candidate.ocrPass) || null
          : null,
        box: candidate && typeof candidate === "object"
          ? candidate.box || candidate.bbox || candidate.bounding_box || candidate.boundingBox || candidate.points || candidate.polygon || null
          : null
      };
    })
    .filter(Boolean);

  const rawText = normalizeText(payload.raw_text || payload.rawText || payload.text);
  if (rawText && !candidates.some((candidate) => candidate.text === rawText)) {
    candidates.unshift({
      text: rawText,
      normalized_text: normalizeOcrText(rawText),
      confidence: confidenceFromCandidate(payload, 0.5),
      source_kind: "raw_aggregate"
    });
  }

  return candidates;
}

function boxArea(box = null) {
  if (!box) return 0;
  if (Array.isArray(box)) {
    if (box.length === 4 && box.every((value) => Number.isFinite(Number(value)))) {
      const [left, top, right, bottom] = box.map(Number);
      return Math.max(0, right - left) * Math.max(0, bottom - top);
    }
    const points = box
      .map((point) => Array.isArray(point)
        ? { x: Number(point[0]), y: Number(point[1]) }
        : { x: Number(point?.x), y: Number(point?.y) })
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (points.length >= 2) {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return Math.max(0, Math.max(...xs) - Math.min(...xs))
        * Math.max(0, Math.max(...ys) - Math.min(...ys));
    }
    return 0;
  }
  if (typeof box !== "object") return 0;
  const width = Number(box.width ?? box.w);
  const height = Number(box.height ?? box.h);
  if (Number.isFinite(width) && Number.isFinite(height)) return Math.max(0, width) * Math.max(0, height);
  const left = Number(box.left ?? box.x ?? box.x1);
  const top = Number(box.top ?? box.y ?? box.y1);
  const right = Number(box.right ?? box.x2);
  const bottom = Number(box.bottom ?? box.y2);
  if ([left, top, right, bottom].every(Number.isFinite)) {
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }
  return 0;
}

function inferredPsaCompanyFromGradeLabel(joined = "", textCandidates = []) {
  if (!/\bGEM\s+(?:MT|MINT)\b/.test(joined)) return null;
  if (!/\b\d{7,10}\b/.test(joined)) return null;
  const tokens = textCandidates.map((candidate) => ({
    text: normalizeOcrText(candidate.text).toUpperCase().replace(/[^A-Z0-9]+/g, ""),
    confidence: Number(candidate.confidence || 0)
  }));
  return tokens.some((candidate) => candidate.confidence >= 0.85 && ["PSA", "PA", "P5A"].includes(candidate.text))
    ? "PSA"
    : null;
}

function candidateGradeFields(textCandidates = [], rawText = "", cropType = "") {
  if (!["grade_label", "slab_cert"].includes(normalizeOcrCropType(cropType))) {
    return { fields: {}, confidence_by_field: {} };
  }
  const detectedRegions = textCandidates.filter((candidate) => candidate.source_kind !== "raw_aggregate");
  if (!detectedRegions.length) {
    const parsed = extractGradeFields(rawText);
    const fields = Object.fromEntries(Object.entries(parsed).filter(([field, value]) => (
      directlyVerifiedGradeFields.has(field) && hasValue(value)
    )));
    const aggregateConfidence = Number(textCandidates[0]?.confidence || 0);
    return {
      fields,
      confidence_by_field: Object.fromEntries(Object.keys(fields).map((field) => [field, aggregateConfidence]))
    };
  }
  const gradeCandidates = detectedRegions;
  const joined = normalizeOcrText([
    rawText,
    ...gradeCandidates.map((candidate) => candidate.text)
  ].filter(Boolean).join("\n")).toUpperCase();
  const company = extractGradeFields(joined).grade_company
    || inferredPsaCompanyFromGradeLabel(joined, gradeCandidates);
  if (!company) return { fields: {}, confidence_by_field: {} };
  const globalCardGradeContext = /\b(?:GEM\s+(?:MT|MINT)|MINT|NM-MT|EX-MT)\b/.test(joined);

  const candidates = gradeCandidates.map((candidate, index) => {
    const text = normalizeOcrText(candidate.text).toUpperCase();
    const previous = normalizeOcrText(gradeCandidates[index - 1]?.text || "").toUpperCase();
    const next = normalizeOcrText(gradeCandidates[index + 1]?.text || "").toUpperCase();
    const nearby = `${previous} ${text} ${next}`;
    const explicitCardGradeContext = /\b(?:PSA\/?DNA|PSA|BGS|BECKETT|CGC|CSG|SGC|TAG|CARD\s+GRADE|GRADE|GEM\s+(?:MT|MINT)|MINT|NM-MT|EX-MT)\b/.test(nearby);
    const subgrade = /\b(?:CENTERING|CORNERS?|EDGES?|SURFACE)\b/.test(text)
      || (/^\s*(?:10(?:\.0)?|[1-9](?:\.\d)?)\s*$/.test(text)
        && /\b(?:CENTERING|CORNERS?|EDGES?|SURFACE)\b/.test(previous));
    const autoLabel = (value) => /^(?:AUTO|AUTOGRAPH|AUTOGRAPH\s+GRADE)$/.test(value.trim());
    const autoContext = autoLabel(text)
      || (/^\s*(?:10(?:\.0)?|[1-9](?:\.\d)?)\s*$/.test(text)
        && (autoLabel(previous) || autoLabel(next)));
    const highConfidenceDetachedGrade = globalCardGradeContext
      && Number(candidate.confidence || 0) >= 0.85
      && /^\s*(?:10(?:\.0)?|[1-9](?:\.\d)?)\s*$/.test(text);
    const normalizedGrade = explicitCardGradeContext || highConfidenceDetachedGrade
      ? normalizeGradeValue(text)
      : null;
    const normalizedAutoGrade = normalizeAutoGradeValue(text);
    const certLike = (/\b(?:CERT|CERTIFICATION|SERIAL|NO\.?|CARD\s*(?:NO|NUMBER))\b/.test(text)
      || /\b\d{6,14}\b/.test(text))
      && !normalizedGrade
      && !normalizedAutoGrade;
    return {
      index,
      text,
      confidence: Number(candidate.confidence || 0),
      area: boxArea(candidate.box),
      subgrade,
      cert_like: certLike,
      auto_context: autoContext,
      card_grade: Number(candidate.confidence || 0) >= 0.55 ? normalizedGrade : null,
      auto_grade: Number(candidate.confidence || 0) >= 0.55 ? normalizedAutoGrade : null
    };
  }).filter((candidate) => !candidate.subgrade && !candidate.cert_like);

  const byVisualAuthority = (left, right) => (
    Number(right.area > 0) - Number(left.area > 0)
    || right.area - left.area
    || right.confidence - left.confidence
    || left.index - right.index
  );
  const auto = candidates
    .filter((candidate) => candidate.auto_context && candidate.auto_grade)
    .sort(byVisualAuthority)[0] || null;
  const directCardCandidates = candidates
    .filter((candidate) => !candidate.auto_context && candidate.card_grade)
    .sort(byVisualAuthority);
  const distinctCardGrades = unique(directCardCandidates.map((candidate) => candidate.card_grade));
  const card = distinctCardGrades.length === 1 ? directCardCandidates[0] || null : null;
  const companyConfidence = Math.max(0, ...gradeCandidates
    .filter((candidate) => {
      const token = normalizeOcrText(candidate.text).toUpperCase().replace(/[^A-Z0-9]+/g, "");
      return company === "PSA" ? ["PSA", "PA", "P5A"].includes(token) : token === company;
    })
    .map((candidate) => Number(candidate.confidence || 0)));
  const output = { grade_company: company };
  const confidenceByField = { grade_company: companyConfidence || 0 };
  if (card?.card_grade) output.card_grade = card.card_grade;
  if (auto?.auto_grade) output.auto_grade = auto.auto_grade;
  if (card?.card_grade) confidenceByField.card_grade = Number(card.confidence || 0);
  if (auto?.auto_grade) confidenceByField.auto_grade = Number(auto.confidence || 0);
  if (output.card_grade && output.auto_grade) output.grade_type = "CARD_AND_AUTO";
  else if (output.card_grade) output.grade_type = "CARD_ONLY";
  else if (output.auto_grade) output.grade_type = "AUTO_ONLY";
  if (output.grade_type) {
    confidenceByField.grade_type = Math.min(
      confidenceByField.grade_company || 0,
      confidenceByField.card_grade || confidenceByField.auto_grade || 0
    );
  }
  return { fields: output, confidence_by_field: confidenceByField };
}

function normalizeBoxes(payload = {}) {
  return candidateArrays(payload)
    .flat()
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
      const text = textFromCandidate(candidate);
      const box = candidate.box || candidate.bbox || candidate.bounding_box || candidate.boundingBox || candidate.points || candidate.polygon || null;
      if (!text && !box) return null;
      return {
        text,
        confidence: confidenceFromCandidate(candidate, confidenceFromCandidate(payload, 0)),
        box
      };
    })
    .filter(Boolean);
}

export function normalizeOcrText(value = "") {
  return normalizeText(value)
    .replace(/[｜|]/g, "/")
    .replace(/[–—]/g, "-")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*-\s*/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'");
}

function unique(values = []) {
  return [...new Set(values.filter(hasValue).map((value) => Array.isArray(value) ? value.join("|") : String(value)))];
}

function bestCandidate(textCandidates = [], pattern = null) {
  const matched = pattern
    ? textCandidates.filter((candidate) => pattern.test(candidate.normalized_text || candidate.text))
    : textCandidates;
  return [...matched].sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0] || null;
}

function extractPrintRuns(text = "", {
  allowHyphen = false
} = {}) {
  const serials = [];
  const normalized = normalizeOcrText(text);
  const hyphenCandidates = allowHyphen
    ? normalized
      .split(/\n+/)
      .flatMap((line) => {
        const trimmed = normalizeText(line);
        const explicitlyNumbered = /\b(?:NUMBERED|LIMITED|PRINT\s*RUN|SERIAL)\b/i.test(trimmed);
        const isolated = /^#?\s*0*\d{1,5}\s*-\s*0*\d{1,5}$/.test(trimmed);
        if (!explicitlyNumbered && !isolated) return [];
        return [...trimmed.matchAll(/\b0*\d{1,5}\s*-\s*0*\d{1,5}\b/g)];
      })
    : [];
  const full = [
    ...normalized.matchAll(/\b#?\s*0*\d{1,5}\s*\/\s*0*\d{1,5}\b/g),
    ...hyphenCandidates
  ];
  for (const match of full) {
    const parsed = parsePrintRunValue(match[0], { allowHyphen });
    if (parsed.suspicious_print_run === true) continue;
    if (parsed.print_run_number || parsed.print_run_denominator) serials.push(parsed);
  }
  const denominatorOnly = [...normalized.matchAll(/#?\s*\/\s*(\d{1,5})\b/g)]
    .find((match) => {
      const prefix = normalized.slice(Math.max(0, Number(match.index || 0) - 8), Number(match.index || 0));
      return !/(?:19|20)\d{2}\s*$/.test(prefix);
    });
  if (!serials.length && denominatorOnly) {
    const parsed = parsePrintRunValue(denominatorOnly[0], { allowHyphen });
    if (parsed.print_run_denominator) serials.push(parsed);
  }
  return serials;
}

function normalizeOcrPrintedCode(value, text = "") {
  const code = normalizePrintedCardCodeForFields(value);
  if (!code) return null;
  const normalized = normalizeOcrText(text)
    .toUpperCase()
    .replace(/\bC0DE\b/g, "CODE")
    .replace(/\bC0M\b/g, "COM")
    .replace(/\bT0PPS\b/g, "TOPPS");
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\bCODE\\s*#?\\s*${escaped}(?:$|[^A-Z0-9])`, "i").test(normalized)) return null;
  if (new RegExp(`(?:HTTPS?:\\/\\/|\\bWWW\\.)\\S{0,80}${escaped}(?:$|[^A-Z0-9])`, "i").test(normalized)) return null;
  return code;
}

function extractChecklistCodes(text = "") {
  const normalized = normalizeOcrText(text).toUpperCase();
  return unique([
    ...normalized.matchAll(/\b[A-Z]{1,8}-\d{1,4}[A-Z]?\b/g),
    ...normalized.matchAll(/\b[A-Z]{2,5}\d{1,4}[A-Z]?\b/g),
    ...normalized.matchAll(/\b\d{2}[A-Z]{1,4}-\d{1,4}-\d{1,4}\b/g)
  ].map((match) => normalizeOcrPrintedCode(match[0], normalized)).filter(Boolean)
    .filter((token) => !/^(?:PSA|BGS|SGC|CGC|TAG)/.test(token)));
}

function extractCollectorNumbers(text = "") {
  const normalized = normalizeOcrText(text).toUpperCase();
  const tokens = [
    ...normalized.matchAll(/(?:CARD\s*(?:NO\.?|NUMBER|#)|NO\.|#)\s*([A-Z0-9]{1,12}(?:[-/:][A-Z0-9]{1,12}){0,3})/gi),
    ...[...normalized.matchAll(/\bNO\s+([A-Z0-9]{1,12}(?:[-/:][A-Z0-9]{1,12}){0,3})/gi)]
      .filter((match) => /[0-9/:-]/.test(match[1]))
  ].map((match) => normalizeOcrPrintedCode(match[1], normalized)).filter(Boolean);
  if (!tokens.length) {
    const isolatedLines = normalized
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /^[A-Z0-9]{1,12}(?:[-/:][A-Z0-9]{1,12}){0,3}$/.test(line));
    for (const line of isolatedLines) {
      if (/^(?:19|20)\d{2}$/.test(line)) continue;
      if (/^\d{1,5}$/.test(line) && normalized.trim() !== line) continue;
      const code = normalizeOcrPrintedCode(line, normalized);
      if (code) tokens.push(code);
    }
  }
  return unique(tokens).slice(0, 6);
}

function boxVertices(box = null) {
  if (!box) return [];
  if (Array.isArray(box)) return box.map((point) => Array.isArray(point)
    ? { x: Number(point[0]), y: Number(point[1]) }
    : { x: Number(point?.x), y: Number(point?.y) });
  const vertices = box.vertices || box.normalizedVertices || box.points;
  return Array.isArray(vertices) ? boxVertices(vertices) : [];
}

function fullImageCollectorNumber(textCandidates = [], metadata = {}) {
  const sourceWidth = Number(metadata.source_width || metadata.sourceWidth);
  const sourceHeight = Number(metadata.source_height || metadata.sourceHeight);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const candidates = textCandidates.flatMap((candidate) => {
    if (candidate.ocr_pass !== "full_image_fallback" || Number(candidate.confidence) < 0.86) return [];
    const token = normalizeOcrPrintedCode(candidate.text, candidate.text);
    if (!token || /^(?:19|20)\d{2}$/.test(token)) return [];
    if (!/^(?:[A-Z]{1,8}-?\d{1,4}[A-Z]?|\d{1,3})$/.test(token)) return [];
    const vertices = boxVertices(candidate.box).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (!vertices.length) return [];
    const xs = vertices.map((point) => point.x);
    const ys = vertices.map((point) => point.y);
    const top = Math.min(...ys) / sourceHeight;
    const horizontalCenter = (Math.min(...xs) + Math.max(...xs)) / 2 / sourceWidth;
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    // Numeric-only full-image tokens are accepted only from the upper band.
    // This excludes most stat-table values while recovering landscape backs
    // whose card number is nowhere near the generic bottom-left crop.
    if (/^\d+$/.test(token) && (top > 0.40 || (horizontalCenter > 0.35 && horizontalCenter < 0.65))) return [];
    return [{ token, area, confidence: Number(candidate.confidence) }];
  });
  candidates.sort((left, right) => right.area - left.area || right.confidence - left.confidence);
  return candidates[0]?.token || null;
}

function extractTcgFields(text = "") {
  const normalized = normalizeOcrText(text).toUpperCase();
  const cardNumber = unique([
    ...normalized.matchAll(/\b[A-Z]{2,8}-?\d{3,4}\b/g),
    ...normalized.matchAll(/\b(?:OP|EB|ST|BT|EX|FB|UA|SV|SWSH|SM|XY)\d{1,2}-\d{3,4}\b/g)
  ].map((match) => match[0].replace(/^([A-Z]{2,8})(\d{2})-(\d{3,4})$/, "$1$2-$3")));
  const setCode = unique([
    ...normalized.matchAll(/\b(?:OP|EB|ST|BT|EX|FB|UA|SV|SWSH|SM|XY)\d{1,3}\b/g)
  ].map((match) => match[0]));
  const rarity = normalized.match(/\b(SEC|SP|SR|SAR|AR|UR|HR|RRR|RR|R|UC|U|C|L)\b/);
  return {
    tcg_set_code: setCode[0] || null,
    tcg_card_number: cardNumber[0] || null,
    rarity: rarity?.[1] || null
  };
}

function extractGradeFields(text = "") {
  const normalized = normalizeOcrText(text).toUpperCase().replace(/\bBECKETT\b/g, "BGS").replace(/\bCSG\b/g, "CGC");
  const gradeContext = /\b(PSA\/?DNA|PSA|BGS|CGC|SGC|TAG|CERT|CERTIFICATION|GEM\s+MT|GEM\s+MINT|MINT|NM-MT|EX-MT|AUTHENTIC|ALTERED|AUTO|AUTOGRAPH)\b/.test(normalized);
  if (!gradeContext) return {};
  const company = normalized.match(/\b(PSA\/?DNA|PSA|BGS|CGC|SGC|TAG)\b/)?.[1]?.replace("PSADNA", "PSA/DNA").replace("PSA/DNA", "PSA/DNA") || null;
  const boundedGrade = "(?:AUTHENTIC|AUTH|ALTERED|10(?:\\.0)?|[1-9](?:\\.\\d)?)";
  const gradeText = normalized.match(new RegExp(`\\b(?:PSA\\/?DNA|PSA|BGS|CGC|SGC|TAG)\\s+(?:(?:GEM\\s+MT|GEM\\s+MINT|MINT|NM-MT|NM|EX-MT|EX)\\s+)?(${boundedGrade})\\b`))?.[1]
    || normalized.match(new RegExp(`\\b(?:GEM\\s+MT|GEM\\s+MINT|MINT|NM-MT|NM|EX-MT|EX)\\s+(${boundedGrade})\\b`))?.[1]
    || null;
  const autoGrade = normalized.match(/\b(?:AUTO|AUTOGRAPH)\s+(AUTHENTIC|AUTH|\d+(?:\.\d+)?)\b/)?.[1] || null;
  const cert = normalized.match(/\b(?:CERT(?:IFICATION)?|CERT\s*NO\.?|NO\.?)\s*#?\s*(\d{6,14})\b/)?.[1]
    || normalized.match(/\b(\d{7,14})\b/)?.[1]
    || null;
  const normalizedGrade = gradeText === "AUTHENTIC" ? "Auth" : gradeText === "AUTH" ? "Auth" : gradeText === "ALTERED" ? "Altered" : gradeText;
  const normalizedAutoGrade = autoGrade === "AUTHENTIC" ? "Auth" : autoGrade === "AUTH" ? "Auth" : autoGrade;
  return {
    grade_company: company,
    card_grade: normalizedGrade,
    auto_grade: normalizedAutoGrade,
    grade_type: normalizedAutoGrade && normalizedGrade
      ? "CARD_AND_AUTO"
      : normalizedAutoGrade
        ? "AUTO_ONLY"
        : normalizedGrade === "Auth"
          ? "AUTHENTIC"
          : normalizedGrade === "Altered"
            ? "ALTERED"
            : normalizedGrade
              ? "CARD_ONLY"
              : null,
    cert_number: cert
  };
}

function extractPlayerNames(text = "") {
  return unique(normalizeOcrText(text)
    .split(/\n| {2,}|[•|]/)
    .map((line) => normalizeText(line))
    .filter((line) => /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}$/.test(line))
    .filter((line) => !/\b(?:topps|panini|upper|deck|chrome|prizm|rookie|refractor|cert|gem|mint)\b/i.test(line)))
    .slice(0, 4);
}

function extractProductText(text = "") {
  const lines = normalizeOcrText(text)
    .split(/\n| {2,}/)
    .map(normalizeText)
    .filter(Boolean)
    .filter((line) => !/^\d{1,4}(?:\/\d{1,4})?$/.test(line));
  return lines[0] || normalizeText(text) || null;
}

function normalizedFieldsFromText(text = "", cropType = "", expectedPattern = "") {
  const fields = {};
  const normalizedCropType = normalizeOcrCropType(cropType);
  const printRunContext = ["print_run_number", "print_run_denominator", "numbered", "serial_number", "serial_denominator"].includes(normalizedCropType)
    || /\b(?:print[_ -]?run|numbered|serial[_ -]?number|serial[_ -]?denominator)\b/i.test(expectedPattern);
  const printRuns = extractPrintRuns(text, { allowHyphen: printRunContext });
  if (printRunContext || printRuns.length) {
    Object.entries(printRuns[0] || {}).forEach(([field, value]) => {
      if (hasValue(value)) fields[field] = value;
    });
  }

  const gradeAllowed = ["grade_label", "slab_cert"].includes(normalizedCropType);
  if (gradeAllowed) {
    const grade = extractGradeFields(text);
    if (hasValue(grade.cert_number)) fields.cert_number = grade.cert_number;
  }

  const tcgAllowed = normalizedCropType === "tcg_code"
    || /\b(?:OP|EB|ST|BT|EX|FB|UA|SV|SWSH|SM|XY)\d{1,3}[- ]?\d{3,4}\b/i.test(text);
  if (tcgAllowed) {
    const tcg = extractTcgFields(text);
    Object.entries(tcg).forEach(([field, value]) => {
      if (hasValue(value)) fields[field] = value;
    });
  }

  const codeAllowed = ["collector_number", "checklist_code", "tcg_code"].includes(normalizedCropType);
  if (codeAllowed) {
    const checklistCodes = extractChecklistCodes(text);
    if (checklistCodes[0]) fields.checklist_code = checklistCodes[0];

    const collectorNumbers = extractCollectorNumbers(text);
    if (collectorNumbers[0] && !fields.collector_number) fields.collector_number = collectorNumbers[0];
  }

  if (normalizedCropType === "product_text") {
    fields.product_text = extractProductText(text);
    // A PRINTED season range ("2025-26", "2025/26") on the year/product region
    // is decisive for season products. Bare copyright years are deliberately
    // not extracted here: ©2025 is compatible with both the 2024-25 and the
    // 2025-26 season and must never masquerade as year evidence.
    const seasonRange = normalizeOcrText(text).match(/\b((?:19|20)\d{2})\s*[-/]\s*(\d{2})\b/);
    if (seasonRange && Number(seasonRange[2]) === (Number(seasonRange[1]) + 1) % 100) {
      fields.year = `${seasonRange[1]}-${seasonRange[2]}`;
    }
  }

  if (normalizedCropType === "player_name") {
    const names = extractPlayerNames(text);
    if (names.length) fields.player_names = names;
  }

  return fields;
}

function mergeExplicitFields(fields = {}, extracted = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return extracted;
  const next = { ...extracted };
  Object.entries(fields).forEach(([field, value]) => {
    if (!hasValue(value)) return;
    next[field] = Array.isArray(value) ? value.filter(hasValue) : normalizeText(value);
  });
  return next;
}

function canonicalGradeFieldValue(field, value) {
  if (field === "card_grade") return normalizeGradeValue(value);
  if (field === "auto_grade") return normalizeAutoGradeValue(value);
  return normalizeText(value).toUpperCase();
}

const directPrintRunFields = new Set([
  "print_run_number",
  "print_run_numerator",
  "print_run_denominator",
  "numbered_to",
  "serial_number",
  "serial_denominator"
]);

const directPrintedCodeFields = new Set([
  "card_number",
  "tcg_card_number",
  "collector_number",
  "checklist_code",
  "tcg_set_code"
]);

function normalizedDirectFieldValues(fields = {}, fieldNames = []) {
  return new Set([...fieldNames]
    .flatMap((field) => Array.isArray(fields[field]) ? fields[field] : [fields[field]])
    .filter(hasValue)
    .map((value) => normalizeOcrText(value).toUpperCase()));
}

function filterExplicitFieldsByDirectEvidence(fields = {}, directFields = {}, cropType = "") {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return fields;
  const normalizedCropType = normalizeOcrCropType(cropType);
  const directPrintRunValues = normalizedDirectFieldValues(directFields, directPrintRunFields);
  const directPrintedCodeValues = normalizedDirectFieldValues(directFields, directPrintedCodeFields);
  return Object.fromEntries(Object.entries(fields).filter(([field, value]) => {
    if (directlyVerifiedGradeFields.has(field) && ["grade_label", "slab_cert"].includes(normalizedCropType)) {
      if (!hasValue(directFields[field])) return false;
      return canonicalGradeFieldValue(field, value) === canonicalGradeFieldValue(field, directFields[field]);
    }
    const normalizedValue = normalizeOcrText(value).toUpperCase();
    if (directPrintRunFields.has(field)) return directPrintRunValues.has(normalizedValue);
    if (directPrintedCodeFields.has(field)) return directPrintedCodeValues.has(normalizedValue);
    return true;
  }));
}

function fieldsAllowedForCropType(fields = {}, cropType = "") {
  const allowed = normalizedFieldsByCropType[normalizeOcrCropType(cropType)] || new Set();
  return Object.fromEntries(Object.entries(fields).filter(([field]) => allowed.has(field)));
}

function confidenceForNormalizedValue(value, textCandidates = [], fallback = 0) {
  const values = Array.isArray(value) ? value : [value];
  const normalizedValues = values.map((entry) => normalizeOcrText(entry).toUpperCase()).filter(Boolean);
  const matches = textCandidates.filter((candidate) => {
    const token = normalizeOcrText(candidate.text).toUpperCase();
    return normalizedValues.some((entry) => token === entry || token.includes(entry));
  });
  if (!matches.length) return clamp01(fallback, 0);
  return clamp01(Math.max(...matches.map((candidate) => Number(candidate.confidence || 0))), fallback);
}

function normalizedConfidence(payload = {}, textCandidates = []) {
  const explicit = clamp01(payload.confidence ?? payload.ocr_confidence ?? payload.score, NaN);
  if (Number.isFinite(explicit)) return explicit;
  const scores = textCandidates.map((candidate) => Number(candidate.confidence)).filter(Number.isFinite);
  if (!scores.length) return 0;
  return Math.max(...scores);
}

export function normalizePaddleOcrResponse(payload = {}, requestInput = {}, {
  startedAt = null,
  endedAt = null
} = {}) {
  const request = normalizeOcrRequest(requestInput);
  const textCandidates = normalizeTextCandidates(payload);
  const rawText = normalizeText(payload.raw_text || payload.rawText || payload.text || textCandidates.map((candidate) => candidate.text).join("\n"));
  const confidence = normalizedConfidence(payload, textCandidates);
  const extractedFields = normalizedFieldsFromText(rawText, request.crop_type, request.expected_pattern);
  if (["collector_number", "card_code_crop", "collector_number_crop"].includes(normalizeOcrCropType(request.crop_type))
    && !extractedFields.collector_number) {
    const fallbackCollectorNumber = fullImageCollectorNumber(textCandidates, request.metadata || {});
    if (fallbackCollectorNumber) extractedFields.collector_number = fallbackCollectorNumber;
  }
  const candidateGrades = candidateGradeFields(textCandidates, rawText, request.crop_type);
  const explicitFields = filterExplicitFieldsByDirectEvidence(
    payload.normalized_fields || payload.normalizedFields || payload.fields,
    {
      ...candidateGrades.fields,
      ...extractedFields
    },
    request.crop_type
  );
  const normalizedFields = fieldsAllowedForCropType(sanitizeGradeFields(mergeExplicitFields(
    explicitFields,
    {
      ...candidateGrades.fields,
      ...extractedFields
    }
  )), request.crop_type);
  const normalizedFieldConfidence = Object.fromEntries(Object.entries(normalizedFields).map(([field, value]) => [
    field,
    clamp01(
      candidateGrades.confidence_by_field[field],
      confidenceForNormalizedValue(value, textCandidates, confidence)
    )
  ]));
  const latencyMs = Number(payload.latency_ms ?? payload.latencyMs);
  return {
    schema_version: ocrContractVersion,
    request_id: request.request_id,
    crop_type: request.crop_type,
    expected_pattern: request.expected_pattern || null,
    raw_text: rawText,
    text_candidates: textCandidates.length ? textCandidates : (rawText ? [{
      text: rawText,
      normalized_text: normalizeOcrText(rawText),
      confidence
    }] : []),
    boxes: normalizeBoxes(payload),
    confidence,
    normalized_fields: normalizedFields,
    normalized_field_confidence: normalizedFieldConfidence,
    latency_ms: Number.isFinite(latencyMs)
      ? latencyMs
      : startedAt && endedAt
        ? Math.max(0, Math.round(Number(endedAt) - Number(startedAt)))
        : null,
    model_id: normalizeText(payload.model_id || payload.modelId) || "paddleocr",
    model_revision: normalizeText(payload.model_revision || payload.modelRevision || payload.version) || "unknown",
    worker_status: normalizeText(payload.status) || (rawText ? "OK" : "EMPTY")
  };
}

function sourceForOcrResult(ocrResult = {}, {
  field = "",
  imageId = null,
  cropId = null
} = {}) {
  return createVisionSource({
    sourceType: "OCR",
    imageId,
    sourceCropId: cropId,
    side: null,
    captureRole: "field_crop_ocr",
    region: ocrResult.crop_type || null,
    observedText: ocrResult.raw_text || null,
    rawText: ocrResult.raw_text || null,
    sourceInferenceMethod: "paddleocr_field_verifier",
    derivedObjectPath: null,
    trustTier: field === "grade_company" || field === "card_grade" ? 2 : 3
  });
}

export function ocrResultToEvidencePatch(ocrResult = {}, {
  imageId = null,
  cropId = null
} = {}) {
  const evidence = {};
  const normalizedFields = ocrResult.normalized_fields || {};
  Object.entries(normalizedFields).forEach(([normalizedField, value]) => {
    const field = evidenceFieldsByNormalizedField[normalizedField];
    if (!field || !hasValue(value)) return;
    const source = sourceForOcrResult(ocrResult, { field, imageId, cropId });
    const confidence = clamp01(ocrResult.normalized_field_confidence?.[normalizedField], clamp01(ocrResult.confidence, 0.5));
    evidence[field] = createEvidenceField({
      value,
      normalizedValue: value,
      status: confidence >= 0.86 ? "CONFIRMED" : "REVIEW",
      confidence,
      candidates: [{
        value,
        confidence,
        sources: [source]
      }],
      sources: [source],
      conflicts: [],
      unresolvedReason: confidence >= 0.86 ? null : "ocr_field_requires_writer_review"
    });
  });

  return {
    schema_version: "ocr-evidence-patch-v1",
    source: "paddle_ocr",
    request_id: ocrResult.request_id || null,
    crop_type: ocrResult.crop_type || null,
    evidence,
    derived_fields: {
      print_run_number: normalizedFields.print_run_number || null,
      print_run_numerator: normalizedFields.print_run_numerator || null,
      print_run_denominator: normalizedFields.print_run_denominator || normalizedFields.numbered_to || null,
      numbered_to: normalizedFields.numbered_to || normalizedFields.print_run_denominator || null,
      serial_denominator: normalizedFields.serial_denominator || null,
      cert_number: normalizedFields.cert_number || null,
      rarity: normalizedFields.rarity || null
    },
    raw_text: ocrResult.raw_text || "",
    confidence: clamp01(ocrResult.confidence, 0),
    latency_ms: ocrResult.latency_ms ?? null,
    model_id: ocrResult.model_id || null,
    model_revision: ocrResult.model_revision || null,
    policy: {
      can_generate_title: false,
      can_override_resolved_fields: false,
      can_provide_catalog_identity: false,
      can_infer_exact_parallel: false,
      resolver_gate_authority_required: true
    }
  };
}

function canonicalFieldValue(value) {
  if (Array.isArray(value)) return value.map(canonicalFieldValue).sort().join("|");
  return normalizeText(value).toLowerCase();
}

function mergeEvidenceField(existing = null, incoming = null, fieldName = "") {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const existingValue = existing.value;
  const incomingValue = incoming.value;
  const conflict = hasValue(existingValue)
    && hasValue(incomingValue)
    && canonicalFieldValue(existingValue) !== canonicalFieldValue(incomingValue);
  const candidates = [
    ...(Array.isArray(existing.candidates) ? existing.candidates : []),
    ...(Array.isArray(incoming.candidates) ? incoming.candidates : [])
  ];
  const sources = [
    ...(Array.isArray(existing.sources) ? existing.sources : []),
    ...(Array.isArray(incoming.sources) ? incoming.sources : [])
  ];
  const conflicts = [
    ...(Array.isArray(existing.conflicts) ? existing.conflicts : []),
    ...(Array.isArray(incoming.conflicts) ? incoming.conflicts : [])
  ];
  if (conflict) {
    conflicts.push({
      field: fieldName,
      conflict_type: "OCR_FIELD_CONFLICT",
      conflicting_values: [existingValue, incomingValue],
      severity: ["print_run_number", "serial_number", "grade_company", "card_grade", "collector_number", "checklist_code"].includes(fieldName) ? "HIGH" : "MEDIUM",
      reason: "PaddleOCR current-image crop disagrees with existing provider evidence; writer review required.",
      resolved: false
    });
  }
  const best = candidates
    .filter((candidate) => hasValue(candidate.value))
    .sort((left, right) => Number(right.confidence || 0) - Number(left.confidence || 0))[0];
  return {
    ...existing,
    value: conflict ? existing.value : best?.value ?? existing.value,
    normalized_value: conflict ? existing.normalized_value : best?.value ?? existing.normalized_value,
    status: conflict ? "CONFLICT" : existing.status === "CONFIRMED" || incoming.status === "CONFIRMED" ? "CONFIRMED" : "REVIEW",
    confidence: Math.max(Number(existing.confidence || 0), Number(incoming.confidence || 0)),
    candidates,
    sources,
    conflicts,
    unresolved_reason: conflict ? "ocr_conflict_requires_writer_review" : existing.unresolved_reason || incoming.unresolved_reason || null
  };
}

export function applyOcrEvidencePatchToResult(result = {}, patch = {}) {
  const incomingEvidence = patch.evidence || {};
  const nextEvidence = { ...(result.evidence || {}) };
  const conflicts = [];

  Object.entries(incomingEvidence).forEach(([field, incoming]) => {
    const existing = nextEvidence[field] || null;
    const merged = mergeEvidenceField(existing, incoming, field);
    nextEvidence[field] = merged;
    const fieldConflicts = (merged.conflicts || []).filter((conflict) => conflict.conflict_type === "OCR_FIELD_CONFLICT");
    conflicts.push(...fieldConflicts);
  });

  return {
    ...result,
    evidence: nextEvidence,
    ocr_verification: {
      ...(result.ocr_verification || {}),
      enabled: true,
      latest_patch: patch,
      patches: [
        ...(Array.isArray(result.ocr_verification?.patches) ? result.ocr_verification.patches : []),
        patch
      ],
      policy: patch.policy || {
        can_generate_title: false,
        can_override_resolved_fields: false,
        resolver_gate_authority_required: true
      }
    },
    conflict_map: conflicts.length
      ? [...(Array.isArray(result.conflict_map) ? result.conflict_map : []), ...conflicts]
      : result.conflict_map,
    unresolved: conflicts.length
      ? [...(Array.isArray(result.unresolved) ? result.unresolved : []), ...unique(conflicts.map((conflict) => `${conflict.field}: OCR conflict requires writer review`))]
      : result.unresolved
  };
}

export function taskIdForOcrCropType(cropType = "") {
  const normalized = normalizeOcrCropType(cropType);
  if (["print_run_number", "print_run_denominator", "numbered", "serial_number", "serial_denominator"].includes(normalized)) return "ocr_serial_verifier";
  if (["collector_number", "checklist_code"].includes(normalized)) return "ocr_collector_number_verifier";
  if (["grade_label", "slab_cert"].includes(normalized)) return "ocr_slab_label_verifier";
  if (normalized === "tcg_code") return "ocr_tcg_code_verifier";
  return null;
}

export function buildOcrRequestFromCrop({
  requestId,
  imageUrl,
  cropType,
  expectedPattern = "",
  cropBox = null,
  metadata = {}
} = {}) {
  return normalizeOcrRequest({
    request_id: requestId,
    image_url: imageUrl,
    crop_type: cropType,
    expected_pattern: expectedPattern,
    crop_box: cropBox,
    metadata
  });
}
