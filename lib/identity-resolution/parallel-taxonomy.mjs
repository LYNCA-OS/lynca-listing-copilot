import {
  canonicalValueKey,
  normalizeChecklistCode,
  normalizeFieldValue,
  normalizeText,
  parseSerial
} from "./normalizer.mjs";

export const surfaceColorTokens = Object.freeze([
  "black",
  "blue",
  "bronze",
  "gold",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "silver",
  "white",
  "yellow"
]);

export const parallelFamilyTokens = Object.freeze([
  "bordered",
  "chrome",
  "cracked ice",
  "foil",
  "fractor",
  "hyper",
  "lava",
  "mojo",
  "prism",
  "prizm",
  "refractor",
  "shimmer",
  "sparkle",
  "speckle",
  "velocity",
  "wave",
  "x-fractor",
  "xfractor"
]);

function listFromMaybe(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function titleCasePhrase(value) {
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function comparable(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textTokens(value) {
  return comparable(value).split(/\s+/).filter(Boolean);
}

function containsPhrase(text, phrase) {
  const normalized = comparable(text);
  const target = comparable(phrase);
  return Boolean(normalized && target && normalized.includes(target));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function firstValue(...values) {
  return values.find((value) => normalizeText(value)) || "";
}

function numberList(value) {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(numberList);
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? [value] : [];
  if (typeof value === "object") {
    return [
      value.denominator,
      value.serial_denominator,
      value.serialDenominator,
      value.numbered_to,
      value.numberedTo,
      value.print_run,
      value.printRun,
      value.value,
      value.to
    ].flatMap(numberList);
  }

  const text = normalizeText(value);
  const serial = parseSerial(text);
  if (serial.denominator) return [serial.denominator];
  const numbered = text.match(/\b(?:to|\/|out of|numbered to|print run)\s*#?\s*(\d{1,5})\b/i);
  if (numbered) return [Number(numbered[1])].filter((item) => item > 0);
  if (/^\d{1,5}$/.test(text)) return [Number(text)].filter((item) => item > 0);
  return [];
}

function denominatorsFromRecord(record = {}) {
  return unique([
    record.denominator,
    record.denominators,
    record.allowed_denominators,
    record.allowedDenominators,
    record.serial_denominators,
    record.serialDenominators,
    record.serial_denominator,
    record.serialDenominator,
    record.numbered_to,
    record.numberedTo,
    record.print_run,
    record.printRun,
    record.print_runs,
    record.printRuns,
    record.numbering,
    record.serial_number,
    record.serialNumber
  ].flatMap(numberList)).sort((left, right) => left - right);
}

export function splitParallelDescriptor(value) {
  const text = normalizeText(Array.isArray(value) ? value.join(" ") : value);
  if (!text) {
    return {
      surface_color: null,
      parallel_family: null,
      parallel_exact: null
    };
  }

  const normalized = comparable(text);
  const color = surfaceColorTokens.find((token) => textTokens(normalized).includes(token)) || "";
  const family = [...parallelFamilyTokens]
    .sort((left, right) => right.length - left.length)
    .find((token) => containsPhrase(normalized, token)) || "";

  return {
    surface_color: color ? titleCasePhrase(color) : null,
    parallel_family: family ? titleCasePhrase(family === "xfractor" ? "X-Fractor" : family) : null,
    parallel_exact: text
  };
}

function schemaRecords(productSchemas = []) {
  return listFromMaybe(productSchemas).filter((schema) => schema && typeof schema === "object");
}

function nestedParallelRecords(record = {}) {
  return [
    record.parallels,
    record.parallel_candidates,
    record.parallelCandidates,
    record.parallel_taxonomy,
    record.parallelTaxonomy,
    record.variants,
    record.variations,
    record.parallelChecklist,
    record.parallel_checklist
  ].flatMap(listFromMaybe).filter((item) => item && typeof item === "object");
}

function recordFields(record = {}) {
  return record.fields && typeof record.fields === "object"
    ? record.fields
    : record.resolved && typeof record.resolved === "object"
      ? record.resolved
      : record;
}

function recordName(record = {}) {
  const fields = recordFields(record);
  return firstValue(
    fields.parallel_exact,
    fields.parallelExact,
    fields.parallel,
    fields.variation,
    record.parallel_exact,
    record.parallelExact,
    record.parallel,
    record.variation,
    record.name,
    record.label,
    record.title,
    record.variant,
    record.description
  );
}

function recordDescriptorParts(record = {}) {
  const fields = recordFields(record);
  const name = recordName(record);
  const inferred = splitParallelDescriptor(name);
  return {
    name,
    surface_color: normalizeText(firstValue(
      fields.surface_color,
      fields.surfaceColor,
      fields.color,
      record.surface_color,
      record.surfaceColor,
      record.color,
      inferred.surface_color
    )) || null,
    parallel_family: normalizeText(firstValue(
      fields.parallel_family,
      fields.parallelFamily,
      fields.family,
      record.parallel_family,
      record.parallelFamily,
      record.family,
      inferred.parallel_family
    )) || null
  };
}

function identityValue(record = {}, key) {
  const fields = recordFields(record);
  const aliases = {
    year: ["year", "season"],
    product: ["product", "product_name", "productName", "set_name", "setName"],
    checklist_code: ["checklist_code", "checklistCode", "checklist"],
    collector_number: ["collector_number", "collectorNumber", "card_number", "cardNumber"],
    card_type: ["card_type", "cardType", "type"]
  }[key] || [key];
  return firstValue(...aliases.flatMap((alias) => [fields[alias], record[alias]]));
}

function yearCompatible(left, right) {
  const leftText = comparable(left);
  const rightText = comparable(right);
  if (!leftText || !rightText) return true;
  if (leftText === rightText) return true;
  const leftYears = leftText.match(/\b\d{4}(?:\s?\d{2})?\b/g) || [];
  const rightYears = rightText.match(/\b\d{4}(?:\s?\d{2})?\b/g) || [];
  return leftYears.some((year) => rightYears.includes(year));
}

function descriptorCompatible(left, right) {
  const leftText = comparable(left);
  const rightText = comparable(right);
  if (!leftText || !rightText) return true;
  return leftText === rightText || leftText.includes(rightText) || rightText.includes(leftText);
}

function identityCompatible(candidate = {}, identity = {}) {
  const checks = [
    ["year", yearCompatible],
    ["product", descriptorCompatible],
    ["card_type", descriptorCompatible],
    ["collector_number", descriptorCompatible]
  ];
  for (const [field, compatible] of checks) {
    const expected = identity[field];
    const actual = identityValue(candidate, field);
    if (expected && actual && !compatible(expected, actual)) return false;
  }

  const expectedChecklist = normalizeChecklistCode(identity.checklist_code);
  const actualChecklist = normalizeChecklistCode(identityValue(candidate, "checklist_code"));
  return !(expectedChecklist && actualChecklist && expectedChecklist !== actualChecklist);
}

function inheritedRecord(parent = {}, child = {}) {
  const parentFields = recordFields(parent);
  const childFields = recordFields(child);
  return {
    ...parent,
    ...child,
    fields: {
      ...parentFields,
      ...childFields
    },
    parent_schema: parent
  };
}

export function collectParallelTaxonomyRecords({
  productSchemas = [],
  registryRecords = []
} = {}) {
  const fromSchemas = schemaRecords(productSchemas).flatMap((schema) => {
    const nested = nestedParallelRecords(schema);
    const topLooksLikeParallel = Boolean(recordName(schema) || denominatorsFromRecord(schema).length);
    return [
      ...(topLooksLikeParallel ? [schema] : []),
      ...nested.map((record) => inheritedRecord(schema, record))
    ];
  });

  const fromRegistry = listFromMaybe(registryRecords).flatMap((record) => {
    const nested = nestedParallelRecords(record);
    const topLooksLikeParallel = Boolean(recordName(record) || denominatorsFromRecord(record).length);
    return [
      ...(topLooksLikeParallel ? [record] : []),
      ...nested.map((item) => inheritedRecord(record, item))
    ];
  });

  return [...fromSchemas, ...fromRegistry]
    .map((record, index) => {
      const descriptor = recordDescriptorParts(record);
      return {
        taxonomy_id: record.taxonomy_id || record.id || record.registry_id || `parallel_taxonomy_${index + 1}`,
        name: descriptor.name,
        surface_color: descriptor.surface_color,
        parallel_family: descriptor.parallel_family,
        allowed_denominators: denominatorsFromRecord(record),
        source_type: record.source_type || record.source || "STRUCTURED_DATABASE",
        fields: recordFields(record),
        raw: record
      };
    })
    .filter((record) => record.name || record.surface_color || record.parallel_family || record.allowed_denominators.length);
}

function candidateMatchesParallel(record = {}, parallelCandidate) {
  const candidate = splitParallelDescriptor(parallelCandidate);
  const candidateText = comparable(parallelCandidate);
  const recordText = comparable(record.name);
  if (!candidateText) return true;
  if (recordText && (recordText === candidateText || recordText.includes(candidateText) || candidateText.includes(recordText))) return true;

  const candidateColor = comparable(candidate.surface_color);
  const recordColor = comparable(record.surface_color);
  const candidateFamily = comparable(candidate.parallel_family);
  const recordFamily = comparable(record.parallel_family);
  if (candidateColor && recordColor && candidateColor !== recordColor) return false;
  if (candidateFamily && recordFamily && candidateFamily !== recordFamily) return false;
  return Boolean((candidateColor && recordColor) || (candidateFamily && recordFamily));
}

export function allowedDenominators({
  year = null,
  product = null,
  checklist_code = null,
  collector_number = null,
  card_type = null,
  parallel_candidate = null,
  productSchemas = [],
  registryRecords = []
} = {}) {
  const identity = {
    year,
    product,
    checklist_code,
    collector_number,
    card_type
  };
  const taxonomyRecords = collectParallelTaxonomyRecords({ productSchemas, registryRecords })
    .filter((record) => identityCompatible(record.raw, identity));

  if (!taxonomyRecords.length) {
    return {
      state: "taxonomy_missing",
      allowed_denominators: [],
      matched_candidates: [],
      taxonomy_record_count: 0
    };
  }

  const matched = taxonomyRecords.filter((record) => candidateMatchesParallel(record, parallel_candidate));
  if (!matched.length) {
    return {
      state: "parallel_candidate_not_found",
      allowed_denominators: [],
      matched_candidates: [],
      taxonomy_record_count: taxonomyRecords.length
    };
  }

  const allowed = unique(matched.flatMap((record) => record.allowed_denominators)).sort((left, right) => left - right);
  return {
    state: allowed.length ? "matched_candidate" : "no_denominator_declared",
    allowed_denominators: allowed,
    matched_candidates: matched.map((record) => ({
      taxonomy_id: record.taxonomy_id,
      name: record.name,
      surface_color: record.surface_color,
      parallel_family: record.parallel_family,
      allowed_denominators: record.allowed_denominators,
      source_type: record.source_type
    })),
    taxonomy_record_count: taxonomyRecords.length
  };
}

function aggregationValuesForField(aggregation = {}, field) {
  return Object.values(aggregation.fields?.[field] || {}).map((group) => group.value).filter(Boolean);
}

export function identityContextFromAggregation(aggregation = {}) {
  const first = (field) => aggregationValuesForField(aggregation, field)[0] || null;
  return {
    year: first("year"),
    product: first("product"),
    checklist_code: first("checklist_code"),
    collector_number: first("collector_number"),
    card_type: first("card_type")
  };
}

export function serialDenominatorsFromAggregation(aggregation = {}) {
  return aggregationValuesForField(aggregation, "serial_number")
    .map((value) => parseSerial(value).denominator)
    .filter((denominator) => Number.isInteger(denominator) && denominator > 0);
}

export function parallelSerialTaxonomyCompatibility(value, {
  aggregation = {},
  productSchemas = [],
  registryRecords = []
} = {}) {
  const denominator = serialDenominatorsFromAggregation(aggregation)[0] || null;
  const identity = identityContextFromAggregation(aggregation);
  const denominatorReport = allowedDenominators({
    ...identity,
    parallel_candidate: value,
    productSchemas,
    registryRecords
  });

  if (!denominator) {
    return {
      ...denominatorReport,
      state: "missing_serial_denominator",
      score: 0
    };
  }

  if (!["matched_candidate", "no_denominator_declared"].includes(denominatorReport.state)) {
    return {
      denominator,
      ...denominatorReport,
      state: denominatorReport.state,
      score: 0
    };
  }

  if (!denominatorReport.allowed_denominators.length) {
    return {
      denominator,
      ...denominatorReport,
      state: "no_denominator_declared",
      score: 0.05
    };
  }

  const compatible = denominatorReport.allowed_denominators.includes(denominator);
  return {
    denominator,
    ...denominatorReport,
    state: compatible ? "compatible" : "mismatch",
    score: compatible ? 0.45 : 0
  };
}

function observedDescriptorParts(aggregation = {}) {
  const values = [
    ...aggregationValuesForField(aggregation, "surface_color"),
    ...aggregationValuesForField(aggregation, "parallel_family"),
    ...aggregationValuesForField(aggregation, "parallel_exact"),
    ...aggregationValuesForField(aggregation, "parallel")
  ];
  return values.reduce((acc, value) => {
    const parts = splitParallelDescriptor(value);
    acc.surface_colors.push(parts.surface_color || (canonicalValueKey("surface_color", value) ? normalizeFieldValue("surface_color", value) : null));
    acc.parallel_families.push(parts.parallel_family);
    return acc;
  }, {
    surface_colors: [],
    parallel_families: []
  });
}

export function deriveParallelExactEvidenceFromTaxonomy(aggregation = {}, {
  productSchemas = [],
  registryRecords = []
} = {}) {
  const denominator = serialDenominatorsFromAggregation(aggregation)[0] || null;
  if (!denominator) return [];

  const observed = observedDescriptorParts(aggregation);
  const observedColors = unique(observed.surface_colors.map(normalizeText));
  if (!observedColors.length) return [];
  const observedFamilies = unique(observed.parallel_families.map(normalizeText));
  const identity = identityContextFromAggregation(aggregation);
  const records = collectParallelTaxonomyRecords({ productSchemas, registryRecords })
    .filter((record) => identityCompatible(record.raw, identity))
    .filter((record) => record.name)
    .filter((record) => record.allowed_denominators.includes(denominator))
    .filter((record) => {
      const color = normalizeText(record.surface_color);
      if (!color || !observedColors.some((item) => comparable(item) === comparable(color))) return false;
      const family = normalizeText(record.parallel_family);
      return !observedFamilies.length || !family || observedFamilies.some((item) => comparable(item) === comparable(family));
    });

  const uniqueNames = unique(records.map((record) => normalizeText(record.name)));
  if (uniqueNames.length !== 1) return [];

  return [{
    field: "parallel_exact",
    value: uniqueNames[0],
    source: "STRUCTURED_DATABASE",
    confidence: 0.82,
    metadata: {
      retrieval_source: "product_taxonomy_unique_parallel",
      denominator,
      observed_surface_colors: observedColors,
      observed_parallel_families: observedFamilies,
      matched_taxonomy_ids: records.map((record) => record.taxonomy_id)
    }
  }];
}
