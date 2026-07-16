import { parseReviewedTitleFields } from "../memory/title-field-parser.mjs";
import { SEM_STANDARD_VERSION, semCanonicalEditableFields } from "./sem-definition.mjs";

export const WRITER_TITLE_SEM_CANDIDATE_SCHEMA_VERSION = "writer-title-sem-candidate-v1";
export const WRITER_TITLE_SEM_PARSER_VERSION = "parse-reviewed-title-fields-v1";
export const SEM_VALIDATION_STATUSES = Object.freeze(["PENDING", "VALIDATED", "REJECTED"]);
export const SEM_VALIDATION_SOURCE_TYPES = Object.freeze([
  "IMAGE_EVIDENCE",
  "OCR",
  "CATALOG",
  "HUMAN_CONFIRMATION"
]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => {
    if (Array.isArray(child)) return child.length > 0;
    if (child && typeof child === "object") return Object.keys(child).length > 0;
    return child !== null && child !== undefined && child !== "";
  }));
}

function gradingInfoSuggestion(fields = {}) {
  const grading = compactObject({
    company: fields.grade_company,
    card_grade: fields.card_grade || fields.grade,
    auto_grade: fields.auto_grade,
    grade_type: fields.grade_type && fields.grade_type !== "UNKNOWN" ? fields.grade_type : null
  });
  return Object.keys(grading).length ? grading : null;
}

function printFinishSuggestion(fields = {}) {
  const explicit = cleanText(fields.print_finish || fields.parallel_exact || fields.parallel);
  if (explicit) return explicit;
  const color = cleanText(fields.surface_color);
  const family = cleanText(fields.parallel_family);
  if (!color) return family || null;
  if (!family || family.toLocaleLowerCase("en-US").includes(color.toLocaleLowerCase("en-US"))) return color;
  return `${color} ${family}`;
}

export function resolvedFieldsToSemSuggestion(fields = {}) {
  const parsed = plainObject(fields);
  const subject = parsed.players?.length
    ? parsed.players
    : parsed.subject
      ? (Array.isArray(parsed.subject) ? parsed.subject : [parsed.subject])
      : parsed.character
        ? [parsed.character]
        : [];
  const searchOptimization = [
    parsed.rc ? "RC" : null,
    parsed.auto ? "Auto" : null,
    parsed.patch ? "Patch" : null,
    parsed.relic ? "Relic" : null,
    parsed.team || null
  ].filter(Boolean);
  return compactObject({
    year: parsed.year,
    ip_sport: parsed.ip || parsed.sport || parsed.category,
    language: parsed.language,
    manufacturer: parsed.manufacturer,
    product: parsed.product,
    set: parsed.set,
    subject,
    card_name: parsed.card_name || parsed.official_card_type,
    card_number: parsed.tcg_card_number || parsed.checklist_code || parsed.collector_number,
    descriptive_rarity: parsed.rarity,
    numerical_rarity: parsed.print_run_number || parsed.serial_number,
    release_variant: parsed.release_variant || parsed.variation,
    print_finish: printFinishSuggestion(parsed),
    special_stamp: [parsed.first_bowman ? "1st Bowman" : null].filter(Boolean),
    grading_info: gradingInfoSuggestion(parsed),
    search_optimization: searchOptimization
  });
}

export function titleDerivedSemSuggestion(title = "") {
  return resolvedFieldsToSemSuggestion(parseReviewedTitleFields(title));
}

function searchSignals(candidate = {}) {
  return (Array.isArray(candidate.search_optimization) ? candidate.search_optimization : [])
    .map((value) => cleanText(value).toLocaleLowerCase("en-US"));
}

// Stable external projection for the Data Flywheel contract. The canonical CSM
// object remains the only semantic source of truth; these names are aliases for
// exports and downstream consumers, not a second schema.
export function canonicalSemToDataFlywheelSem(candidateSem = {}) {
  const candidate = plainObject(candidateSem);
  const signals = searchSignals(candidate);
  return {
    year: candidate.year ?? null,
    manufacturer: candidate.manufacturer ?? null,
    product: candidate.product ?? null,
    set: candidate.set ?? null,
    subject: candidate.subject ?? [],
    card_name: candidate.card_name ?? null,
    card_number: candidate.card_number ?? null,
    parallel: candidate.print_finish || candidate.release_variant || candidate.descriptive_rarity || null,
    numerical_rarity: candidate.numerical_rarity ?? null,
    grading: candidate.grading_info ?? null,
    autograph: signals.includes("auto"),
    patch: signals.includes("patch")
  };
}

function scalarValues(value) {
  if (Array.isArray(value)) return value.flatMap(scalarValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(scalarValues);
  const text = cleanText(value);
  return text ? [text] : [];
}

function valueSpans(title, value) {
  const source = String(title || "");
  const comparable = source.toLocaleLowerCase("en-US");
  return scalarValues(value).map((text) => {
    const start = comparable.indexOf(text.toLocaleLowerCase("en-US"));
    return {
      value: text,
      title_anchored: start >= 0,
      span: start >= 0 ? { start, end: start + text.length } : null
    };
  });
}

function gradingValidation(grading = {}) {
  const errors = [];
  const warnings = [];
  const company = cleanText(grading.company).toUpperCase();
  if (company && !["PSA", "BGS", "SGC", "CGC"].includes(company)) {
    warnings.push(`unrecognized grade company: ${company}`);
  }
  for (const field of ["card_grade", "auto_grade"]) {
    const raw = cleanText(grading[field]);
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 10) errors.push(`${field} must be between 0 and 10`);
  }
  return { errors, warnings };
}

function pendingValidationSources() {
  return Object.fromEntries(SEM_VALIDATION_SOURCE_TYPES.map((source) => [source, {
    status: "NOT_RUN",
    evidence_refs: []
  }]));
}

function parserConfidence(provenance = {}, structurallyValid = true) {
  const fieldScores = Object.fromEntries(Object.entries(provenance).map(([field, record]) => {
    const values = Array.isArray(record.values) ? record.values : [];
    const anchored = values.filter((value) => value.title_anchored).length;
    const score = !values.length ? 0.25 : anchored === values.length ? 0.8 : anchored > 0 ? 0.6 : 0.4;
    return [field, structurallyValid ? score : Math.min(score, 0.3)];
  }));
  const scores = Object.values(fieldScores);
  const confidence = scores.length
    ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(4))
    : 0;
  return {
    confidence,
    field_confidence: fieldScores,
    basis: "TITLE_PARSER_ONLY",
    ceiling: 0.8,
    semantic_truth: false
  };
}

export function validateTitleDerivedSem(title = "", candidateSem = {}) {
  const errors = [];
  const warnings = [];
  const sourceTitle = cleanText(title);
  const candidate = plainObject(candidateSem);
  if (!sourceTitle) errors.push("writer title is required");
  if (!Object.keys(candidate).length && sourceTitle) warnings.push("parser produced no SEM fields");
  const unknownFields = Object.keys(candidate).filter((field) => !semCanonicalEditableFields.includes(field));
  if (unknownFields.length) errors.push(`non-canonical SEM fields: ${unknownFields.join(", ")}`);
  if (candidate.year && !/^(?:19|20)\d{2}(?:-\d{2})?$/.test(String(candidate.year))) {
    errors.push("year must be YYYY or YYYY-YY");
  }
  if (candidate.numerical_rarity && !/^(?:#?\d+\/\d+|#\/\d+|1\/1)$/i.test(String(candidate.numerical_rarity))) {
    warnings.push("numerical_rarity needs field review");
  }
  const grade = gradingValidation(plainObject(candidate.grading_info));
  errors.push(...grade.errors);
  warnings.push(...grade.warnings);
  const provenance = Object.fromEntries(Object.entries(candidate).map(([field, value]) => [field, {
    source: "writer_title_parser",
    parser_version: WRITER_TITLE_SEM_PARSER_VERSION,
    values: valueSpans(sourceTitle, value)
  }]));
  const unanchoredFields = Object.entries(provenance)
    .filter(([, record]) => record.values.length > 0 && record.values.every((value) => !value.title_anchored))
    .map(([field]) => field);
  if (unanchoredFields.length) warnings.push(`derived or unanchored fields require review: ${unanchoredFields.join(", ")}`);
  const structurallyValid = errors.length === 0;
  const parserAssessment = parserConfidence(provenance, structurallyValid);
  return {
    validation_status: "PENDING",
    status: "PENDING",
    confidence: parserAssessment.confidence,
    confidence_detail: parserAssessment,
    validation_sources: pendingValidationSources(),
    structurally_valid: structurallyValid,
    semantic_truth: false,
    training_eligible: false,
    errors,
    warnings,
    field_provenance: provenance
  };
}

export function buildWriterTitleSemCandidate(title = "", { action = "EDIT" } = {}) {
  const normalizedAction = cleanText(action).toUpperCase();
  const sourceTitle = cleanText(title);
  if (normalizedAction === "REJECT") {
    return {
      schema_version: WRITER_TITLE_SEM_CANDIDATE_SCHEMA_VERSION,
      parser_version: WRITER_TITLE_SEM_PARSER_VERSION,
      sem_standard_version: SEM_STANDARD_VERSION,
      source: "writer_final_title",
      source_title: sourceTitle || null,
      candidate_sem: {},
      validation: {
        validation_status: "REJECTED",
        status: "REJECTED",
        confidence: 0,
        confidence_detail: {
          confidence: 0,
          field_confidence: {},
          basis: "WRITER_REJECTED_TITLE",
          ceiling: 0,
          semantic_truth: false
        },
        validation_sources: pendingValidationSources(),
        structurally_valid: true,
        semantic_truth: false,
        training_eligible: false,
        errors: [],
        warnings: [],
        field_provenance: {}
      },
      sem_object: canonicalSemToDataFlywheelSem({}),
      validation_status: "REJECTED",
      confidence: 0,
      status: "REJECTED",
      semantic_truth: false,
      training_eligible: false
    };
  }
  const candidateSem = titleDerivedSemSuggestion(sourceTitle);
  const validation = validateTitleDerivedSem(sourceTitle, candidateSem);
  return {
    schema_version: WRITER_TITLE_SEM_CANDIDATE_SCHEMA_VERSION,
    parser_version: WRITER_TITLE_SEM_PARSER_VERSION,
    sem_standard_version: SEM_STANDARD_VERSION,
    source: "writer_final_title",
    source_title: sourceTitle,
    candidate_sem: candidateSem,
    sem_object: canonicalSemToDataFlywheelSem(candidateSem),
    validation,
    validation_status: validation.validation_status,
    confidence: validation.confidence,
    status: validation.status,
    semantic_truth: false,
    training_eligible: false
  };
}
