// CsmResolutionView -- the one server-composed read model for field-level
// resolution. COS-42.
//
// Listing Copilot renders a final title and nothing else, while the client
// already receives `fields`, `resolved`, `generated_resolved_fields` and
// `csm_rows`. The data for an explanation is present and unexposed, so this is
// assembly rather than new recognition: the composer already reports which
// brackets it rendered, suppressed, dropped, restored and normalised, and the
// parser already reports what was unreadable, low-confidence or withheld.
//
// Two honesty constraints from the issue, both load-bearing:
//
//   * The resolver is `thin-path-observation-only-v1`. It makes ONE whole-card
//     observation and has no alternatives to weigh. Every bracket therefore
//     reports an empty alternatives list and says so, rather than implying a
//     multi-source conflict resolver that does not exist.
//   * ABSENT and INSUFFICIENT_EVIDENCE are different facts. A card with no
//     serial and a card whose serial we could not read both render as empty,
//     and treating them alike would hide the second behind the first.
//
// The application consumes this view. It must not join the persistence graph
// itself, and CSM must not import application code -- so nothing here reaches
// for a request, a database handle or a UI concern.

import {
  semCanonicalBracket,
  semCanonicalTitleOrder,
  semGrammarForResolved,
  semTcgIpLabel
} from "../ontology/sem-definition.mjs";
import { csmFieldLabels, labelForCsmField } from "../ontology/field-labels.mjs";
import { lotPublicationFailureCode } from "../../lib/listing/thin/lot-terminal-contract.mjs";
import {
  PUBLICATION_DISPOSITION,
  validatePublicationCoverage
} from "../../lib/listing/thin/publication-coverage.mjs";

export const CSM_RESOLUTION_VIEW_VERSION = "csm-resolution-view-v1";
export const CSM_RESOLUTION_VIEW_PROJECTOR = Object.freeze({
  CURRENT: "CURRENT_STANDARD_V03",
  CAPTURED_E1AE_STANDARD_V02: "E1AE_STANDARD_V02"
});

/** What a bracket's emptiness means. They are not the same fact. */
export const BRACKET_STATE = Object.freeze({
  VALUE: "VALUE",
  /** The card does not carry this. */
  ABSENT: "ABSENT",
  /** The card carries it and the observation could not make it out. */
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE"
});

/** What the Marketplace Composer did with a bracket that held a value. */
export const COMPOSER_DISPOSITION = Object.freeze({
  INCLUDED: "INCLUDED",
  /** The marketplace profile removed it before the budget was consulted. */
  SUPPRESSED_BY_PROFILE: "SUPPRESSED_BY_PROFILE",
  /** It yielded to the character budget, in the grammar's drop order. */
  DROPPED_FOR_BUDGET: "DROPPED_FOR_BUDGET",
  /** Recovered after a first pass would have dropped it. */
  RESTORED: "RESTORED",
  /** Rendered, but not verbatim. */
  NORMALIZED: "NORMALIZED",
  /** No owning text was emitted because another bracket already covered it. */
  DEDUPED_COVERED: "DEDUPED_COVERED",
  /** Canonical evidence existed, but the shared/publication contract forbade it. */
  WITHHELD_BY_CONTRACT: "WITHHELD_BY_CONTRACT",
  /** The bracket held nothing to render. */
  NOT_APPLICABLE: "NOT_APPLICABLE"
});

/**
 * Rationale codes are the resolver's own words for why a bracket reads as it
 * does. They are a decision trace, not model chain-of-thought: each one is a
 * branch this code took and can be replayed from stored facts.
 */
export const RATIONALE = Object.freeze({
  OBSERVED: "OBSERVED",
  MODEL_REPORTED_UNREADABLE: "MODEL_REPORTED_UNREADABLE",
  MODEL_REPORTED_LOW_CONFIDENCE: "MODEL_REPORTED_LOW_CONFIDENCE",
  /** Observed, then denied promotion by the finish vocabulary admission layer. */
  WITHHELD_BASE_APPEARANCE: "WITHHELD_BASE_APPEARANCE",
  NOT_OBSERVED: "NOT_OBSERVED"
});

// Which canonical field feeds each bracket. The composer keeps the same map
// privately; duplicating it here would be the drift COS-39 was filed about, so
// it is passed in by the caller that owns the composition.
const DEFAULT_FIELD_FOR_BRACKET = Object.freeze({
  subject: "subjects",
  numerical_rarity: "serial",
  grading_info: "grade",
  search_optimization: "team",
  lot: "lot_count",
  manufacturer_product: "product"
});

// COS-41 places Auto, RC, Patch and Relic in [Search Optimization] alongside
// independent supported search terms and the team. The legacy singular
// `canonical_field` remains `team` for response compatibility; the complete
// provenance is exposed by `canonical_fields` in the exact display order.
const EXTRA_FIELDS_FOR_BRACKET = Object.freeze({
  search_optimization: Object.freeze(["components", "search_optimization"])
});

const SOURCE_FIELDS_FOR_BRACKET = Object.freeze({
  manufacturer_product_set: Object.freeze(["manufacturer", "product", "set"]),
  search_optimization: Object.freeze(["components", "search_optimization", "team"]),
  grading_info: Object.freeze(["grading_info"])
});

const asArray = (value) => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);
const isEmpty = (value) => value == null || value === "" || (Array.isArray(value) && !value.length);

function renderValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    // grading_info is structured: company plus card and autograph grades.
    return [value.company, value.card_grade, value.auto_grade && `AUTO ${value.auto_grade}`]
      .filter(Boolean).join(" ");
  }
  return value == null ? "" : String(value);
}

/**
 * Compose the read model from one run's canonical fields and the composition
 * the run produced.
 *
 * `fields` is the parsed canonical object, `composed` is what
 * `composeFromCanonicalFields` returned for it. Both come from the same run --
 * recomposing here would risk showing an explanation of a title the operator
 * never saw.
 */
export function buildCsmResolutionView({
  fields = {},
  composed = {},
  resolverVersion = "thin-path-observation-only-v1",
  grammarConfidence = null,
  fieldForBracket = DEFAULT_FIELD_FOR_BRACKET,
  assetId = null,
  recognitionSessionId = null,
  legacyPublicProjection = false,
  resolutionViewProjector = CSM_RESOLUTION_VIEW_PROJECTOR.CURRENT
} = {}) {
  if (!Object.values(CSM_RESOLUTION_VIEW_PROJECTOR).includes(resolutionViewProjector)) {
    throw new TypeError("resolution_view_projector_unsupported");
  }
  const capturedE1ae = resolutionViewProjector
    === CSM_RESOLUTION_VIEW_PROJECTOR.CAPTURED_E1AE_STANDARD_V02;
  const publicationCoverage = capturedE1ae ? null : composed.publication_coverage ?? null;
  if (publicationCoverage != null) validatePublicationCoverage(publicationCoverage);
  const coverageEnabled = publicationCoverage != null;
  // Receipt presence is the feature boundary for this pure view only. Durable
  // replay separately requires it from the immutable packet contract version,
  // so deleting and resealing a receipt cannot downgrade a stored row.
  // The caller's immutable stored tuple decides whether public response bytes
  // are historical. A fresh in-memory compose may expose a coverage trace, but
  // that trace must not silently upgrade an already-published v1/v2 response.
  const legacyProjection = legacyPublicProjection;
  const grammar = composed.grammar || fields.grammar || semGrammarForResolved(fields) || "standard";
  const contractOrder = semCanonicalTitleOrder(grammar);

  // A bracket the composer renders but the contract order does not place would
  // otherwise appear in the title with nothing in the inspector explaining it.
  // Legacy compatibility rows may still carry `observable_components`. Hiding
  // one would make the read model less honest than the historical composer it
  // describes, so it stays visible and flagged outside the current contract.
  // Current Auto/RC/Patch/Relic terms are owned by Search Optimization.
  const composedOrder = asArray(composed.brackets);
  const extras = composedOrder.filter((b) => !contractOrder.includes(b));
  // The forward-reader bridge must leave the already-published v2 Glass Box
  // byte semantics alone. CNL profiles use the executable projection order;
  // legacy v2 keeps the historical contract order and extra-field placement.
  const order = capturedE1ae
    ? [...new Set([...composedOrder, ...contractOrder])]
    : legacyProjection
    ? (extras.length
        ? composedOrder.filter((bracket) => (
          contractOrder.includes(bracket) || extras.includes(bracket)
        )).concat(contractOrder.filter((bracket) => !composedOrder.includes(bracket)))
        : contractOrder)
    : [...new Set([...contractOrder, ...extras])];
  const outsideContract = new Set(extras);

  const unreadable = new Set(asArray(fields.unreadable));
  const lowConfidence = new Set(asArray(fields.low_confidence));
  const withheld = new Map(asArray(fields.withheld_finish_terms).map((w) => [w.layer, w]));
  const rendered = new Map(asArray(composed.bracket_text).map((b) => [b.bracket, b.text]));
  const suppressed = new Set(asArray(composed.suppressed));
  const dropped = new Set(asArray(composed.dropped));
  const restored = new Set(asArray(composed.restored));
  const normalized = new Set(asArray(composed.normalization_reasons).map((r) => String(r).split(":")[0]));
  const coverageByBracket = new Map();
  for (const atom of publicationCoverage?.atoms || []) {
    const values = coverageByBracket.get(atom.bracket) || [];
    values.push(atom);
    coverageByBracket.set(atom.bracket, values);
  }
  const lotQuantityUnresolved = Boolean(composed.lot_quantity_unresolved);
  const lotSingleCard = Boolean(composed.lot_single_card);
  const lotUnsharedAttributes = Object.freeze([
    ...new Set(asArray(composed.lot_unshared_attributes).map((field) => String(field).trim()).filter(Boolean))
  ]);
  const expectedLotFailureCode = lotPublicationFailureCode({
    quantityUnresolved: lotQuantityUnresolved,
    singleCard: lotSingleCard
  });

  const brackets = order.map((bracket) => {
    const field = fieldForBracket[bracket] || bracket;
    const legacyExtraFields = bracket === "search_optimization" ? ["components"] : [];
    const canonicalFields = legacyProjection
      ? [field, ...legacyExtraFields]
      : ((capturedE1ae
          ? (bracket === "search_optimization"
            ? ["components", "search_optimization", "team"] : null)
          : SOURCE_FIELDS_FOR_BRACKET[bracket])
        || [field, ...(EXTRA_FIELDS_FOR_BRACKET[bracket] || [])]);
    const rawParts = canonicalFields.flatMap((sourceField) => asArray(fields[sourceField]));
    const raw = legacyProjection
      ? (legacyExtraFields.flatMap((sourceField) => asArray(fields[sourceField])).length
          ? rawParts : fields[field])
      : (canonicalFields.length > 1 ? rawParts : fields[field]);
    const value = renderValue(raw);
    const empty = isEmpty(raw);

    // The two ways a bracket can be empty, kept apart.
    let state = BRACKET_STATE.VALUE;
    let rationale = RATIONALE.OBSERVED;
    if (empty) {
      if ((legacyProjection ? unreadable.has(field)
        : canonicalFields.some((sourceField) => unreadable.has(sourceField)))
          || unreadable.has(bracket)) {
        state = BRACKET_STATE.INSUFFICIENT_EVIDENCE;
        rationale = RATIONALE.MODEL_REPORTED_UNREADABLE;
      } else if (withheld.has(field) || (bracket === "print_finish" && withheld.size)) {
        // Observed and denied promotion. The observation survives in
        // `observed_*`, so this is a policy decision rather than a blind spot.
        state = BRACKET_STATE.ABSENT;
        rationale = RATIONALE.WITHHELD_BASE_APPEARANCE;
      } else {
        state = BRACKET_STATE.ABSENT;
        rationale = RATIONALE.NOT_OBSERVED;
      }
    } else if ((legacyProjection ? lowConfidence.has(field)
      : canonicalFields.some((sourceField) => lowConfidence.has(sourceField)))
        || lowConfidence.has(bracket)) {
      rationale = RATIONALE.MODEL_REPORTED_LOW_CONFIDENCE;
    }

    let disposition = COMPOSER_DISPOSITION.NOT_APPLICABLE;
    if (!empty) {
      const coverage = legacyProjection ? [] : (coverageByBracket.get(bracket) || []);
      const coverageStates = new Set(coverage.map((atom) => atom.disposition));
      const covered = coverageStates.has(PUBLICATION_DISPOSITION.PUBLISHED)
        || coverageStates.has(PUBLICATION_DISPOSITION.DEDUPED_COVERED);
      const ownRendered = coverageStates.has(PUBLICATION_DISPOSITION.PUBLISHED);
      const lost = coverageStates.has(PUBLICATION_DISPOSITION.TRUNCATED_LOSS)
        || coverageStates.has(PUBLICATION_DISPOSITION.DROPPED_FOR_BUDGET)
        || coverageStates.has(PUBLICATION_DISPOSITION.SUPPRESSED_BY_PROFILE)
        || coverageStates.has(PUBLICATION_DISPOSITION.WITHHELD_BY_CONTRACT);
      if (capturedE1ae) {
        if (suppressed.has(bracket)) {
          disposition = COMPOSER_DISPOSITION.SUPPRESSED_BY_PROFILE;
        } else if (dropped.has(bracket)) {
          disposition = COMPOSER_DISPOSITION.DROPPED_FOR_BUDGET;
        } else if (restored.has(bracket)) {
          disposition = COMPOSER_DISPOSITION.RESTORED;
        } else if (rendered.has(bracket)) {
          const text = rendered.get(bracket);
          disposition = (normalized.has(bracket) || text !== value)
            ? COMPOSER_DISPOSITION.NORMALIZED
            : COMPOSER_DISPOSITION.INCLUDED;
        }
      } else if (!legacyProjection && coverageEnabled && ownRendered && lost) {
        disposition = COMPOSER_DISPOSITION.NORMALIZED;
      } else if (!legacyProjection && coverageEnabled && covered && lost) {
        disposition = COMPOSER_DISPOSITION.DEDUPED_COVERED;
      } else if (!legacyProjection && coverageEnabled
          && coverageStates.has(PUBLICATION_DISPOSITION.TRUNCATED_LOSS)) {
        disposition = COMPOSER_DISPOSITION.DROPPED_FOR_BUDGET;
      } else if (!legacyProjection && coverageEnabled
          && coverageStates.has(PUBLICATION_DISPOSITION.DROPPED_FOR_BUDGET)) {
        disposition = COMPOSER_DISPOSITION.DROPPED_FOR_BUDGET;
      } else if (!legacyProjection && coverageEnabled
          && coverageStates.has(PUBLICATION_DISPOSITION.SUPPRESSED_BY_PROFILE)) {
        disposition = COMPOSER_DISPOSITION.SUPPRESSED_BY_PROFILE;
      } else if (!legacyProjection && coverageEnabled
          && coverageStates.has(PUBLICATION_DISPOSITION.WITHHELD_BY_CONTRACT)) {
        disposition = COMPOSER_DISPOSITION.WITHHELD_BY_CONTRACT;
      } else if (!legacyProjection && coverageEnabled && !ownRendered && covered) {
        disposition = COMPOSER_DISPOSITION.DEDUPED_COVERED;
      } else if (!legacyProjection && coverageEnabled && ownRendered) {
        disposition = (coverageStates.has(PUBLICATION_DISPOSITION.DEDUPED_COVERED)
          || normalized.has(bracket))
          ? COMPOSER_DISPOSITION.NORMALIZED
          : COMPOSER_DISPOSITION.INCLUDED;
      } else if (suppressed.has(bracket)) disposition = COMPOSER_DISPOSITION.SUPPRESSED_BY_PROFILE;
      else if (dropped.has(bracket)) disposition = COMPOSER_DISPOSITION.DROPPED_FOR_BUDGET;
      else if (legacyProjection && restored.has(bracket)) {
        disposition = COMPOSER_DISPOSITION.RESTORED;
      } else if (restored.has(bracket) && rendered.has(bracket)) {
        disposition = COMPOSER_DISPOSITION.RESTORED;
      } else if (rendered.has(bracket)) {
        const text = rendered.get(bracket);
        disposition = (normalized.has(bracket) || text !== value)
          ? COMPOSER_DISPOSITION.NORMALIZED
          : COMPOSER_DISPOSITION.INCLUDED;
      } else if (restored.has(bracket) || normalized.has(bracket)) {
        // A deterministic duplicate removed by an earlier bracket was not an
        // omission: the meaning is already present elsewhere in the title.
        disposition = COMPOSER_DISPOSITION.NORMALIZED;
      }
    }

    // Withheld terms are recorded against the LAYER they were observed in
    // (`surface_color`, `parallel_family`), while [Print Finish] is the bracket
    // they would have been promoted into. Looking them up by the bracket's own
    // field name found nothing and the evidence silently disappeared -- the one
    // thing this row exists to show.
    const withheldHere = withheld.get(field)
      || (bracket === "print_finish" && withheld.size ? [...withheld.values()][0] : null);
    return {
      bracket,
      label: labelForCsmField(bracket) || csmFieldLabels[bracket] || bracket,
      canonical_field: field,
      ...(!legacyProjection ? {
        canonical_fields: Object.freeze([...canonicalFields])
      } : {}),
      state,
      value: state === BRACKET_STATE.VALUE ? value : "",
      rendered_text: !capturedE1ae && !legacyProjection && coverageEnabled
        && !(coverageByBracket.get(bracket) || []).some((atom) => (
          atom.disposition === PUBLICATION_DISPOSITION.PUBLISHED
        )) ? null : rendered.get(bracket) ?? null,
      composer_disposition: disposition,
      rationale_codes: Object.freeze([rationale]),
      semantic_confidence: state !== BRACKET_STATE.VALUE ? null
        : (rationale === RATIONALE.MODEL_REPORTED_LOW_CONFIDENCE ? "LOW" : "OBSERVED"),
      evidence: Object.freeze({
        modality: "WHOLE_CARD_VISUAL",
        source: "front_and_back_images",
        withheld_observation: withheldHere ? `${withheldHere.value} (${withheldHere.reason})` : null
      }),
      selected_candidate: state === BRACKET_STATE.VALUE ? value : null,
      // Honest, not a placeholder: this resolver makes one observation and has
      // nothing to compare it against.
      alternate_candidates: Object.freeze([]),
      alternates_unavailable_reason: "SINGLE_OBSERVATION_RESOLVER",
      resolver_version: resolverVersion,
      // True when the composer places this bracket but the grammar's order does
      // not name it. Nothing does today -- COS-41 removed the one case by
      // deciding the components belong to a bracket the grammar already names
      // -- but the field stays, because the next inference should be visible
      // rather than discovered later by someone reading a title.
      outside_contract_order: outsideContract.has(bracket),
      // Only independent source lanes can be partially published. A composed
      // identity (`manufacturer_product_set`) or array presentation (`subject`)
      // changing punctuation is normalization, not a source subset loss.
      // Search Optimization is the current multi-lane projection: e.g. RC may
      // survive the eBay profile while Team is suppressed.
      partially_published: legacyProjection || capturedE1ae
        ? !empty && Boolean(rendered.get(bracket)) && rendered.get(bracket) !== value
        : (() => {
          const states = new Set((coverageByBracket.get(bracket) || [])
            .map((atom) => atom.disposition));
          const covered = states.has(PUBLICATION_DISPOSITION.PUBLISHED)
            || states.has(PUBLICATION_DISPOSITION.DEDUPED_COVERED);
          const lost = states.has(PUBLICATION_DISPOSITION.SUPPRESSED_BY_PROFILE)
            || states.has(PUBLICATION_DISPOSITION.DROPPED_FOR_BUDGET)
            || states.has(PUBLICATION_DISPOSITION.TRUNCATED_LOSS)
            || states.has(PUBLICATION_DISPOSITION.WITHHELD_BY_CONTRACT);
          return covered && lost;
        })(),
      ...(!legacyProjection && !capturedE1ae ? {
        publication_coverage: Object.freeze((coverageByBracket.get(bracket) || [])
          .map((atom) => Object.freeze({ ...atom })))
      } : {})
    };
  });

  return Object.freeze({
    schema_version: CSM_RESOLUTION_VIEW_VERSION,
    asset_id: assetId,
    recognition_session_id: recognitionSessionId,
    grammar: Object.freeze({
      value: grammar === "tcg" ? "TCG" : grammar === "lot" ? "LOT" : "NON_TCG",
      raw: grammar,
      confidence: grammarConfidence,
      contract_version: CSM_RESOLUTION_VIEW_VERSION,
      resolver_version: resolverVersion,
      // COS-39 (founder, 2026-08-04): "Grammar classification must happen
      // first", because each grammar then applies its own domain validation --
      // a Pokemon card must not receive `Gold Refractor`. So a grammar the
      // contract cannot corroborate is a review case.
      //
      // Surfaced, not corrected. Across 255 cards the model claimed TCG on 5
      // and the IP table recognised 1; of the other 4, two are genuinely wrong
      // (Topps Chrome Disney, an Entertainment product COS-8 covers) and two
      // are genuinely right and invisible, because the table reads `product`
      // and those cards carry "Mega Brave" or an empty product while being
      // unmistakably Pokemon. A rule forcing Standard whenever the table is
      // silent would fix two cards and break two others.
      ip_corroborated: grammar !== "tcg" ? null
        : Boolean(semTcgIpLabel({ manufacturer: fields.manufacturer, product: fields.product, set: fields.set || fields.product, card_name: fields.card_name })),
      review_required: (grammarConfidence != null && grammarConfidence < 0.5)
        || (grammar === "tcg" && !semTcgIpLabel({ manufacturer: fields.manufacturer, product: fields.product, set: fields.set || fields.product, card_name: fields.card_name }))
    }),
    ...(grammar === "lot" && composed.lot_terminal_durable === true ? {
      lot_terminal: Object.freeze({
        applicable: true,
        lot_quantity_unresolved: lotQuantityUnresolved,
        lot_single_card: lotSingleCard,
        lot_unshared_attributes: lotUnsharedAttributes,
        publishable: expectedLotFailureCode == null,
        failure_code: expectedLotFailureCode
      })
    } : {}),
    brackets: Object.freeze(brackets),
    composer: Object.freeze({
      marketplace: composed.marketplace || null,
      title: composed.title || "",
      character_budget: composed.character_budget ?? null,
      length: composed.length ?? (composed.title || "").length,
      truncated: Boolean(composed.truncated),
      inferred_parent: composed.inferred_parent ?? null
    }),
    // Counts an operator can scan without reading every row.
    summary: Object.freeze({
      total: brackets.length,
      with_value: brackets.filter((b) => b.state === BRACKET_STATE.VALUE).length,
      absent: brackets.filter((b) => b.state === BRACKET_STATE.ABSENT).length,
      insufficient_evidence: brackets.filter((b) => b.state === BRACKET_STATE.INSUFFICIENT_EVIDENCE).length,
      low_confidence: brackets.filter((b) => b.semantic_confidence === "LOW").length,
      suppressed_by_profile: brackets.filter((b) => b.composer_disposition === COMPOSER_DISPOSITION.SUPPRESSED_BY_PROFILE).length,
      dropped_for_budget: brackets.filter((b) => b.composer_disposition === COMPOSER_DISPOSITION.DROPPED_FOR_BUDGET).length,
      outside_contract_order: brackets.filter((b) => b.outside_contract_order).length
    })
  });
}

export { semCanonicalBracket };
