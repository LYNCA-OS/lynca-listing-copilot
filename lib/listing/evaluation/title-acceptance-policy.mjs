const colorTokens = new Set([
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

const parallelStyleTokens = new Set([
  "checkerboard",
  "cracked",
  "disco",
  "fast",
  "fireworks",
  "flash",
  "hyper",
  "ice",
  "laser",
  "mojo",
  "pulsar",
  "refractor",
  "shimmer",
  "snakeskin",
  "velocity",
  "wave",
  "zebra"
]);

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function canonicalText(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title) {
  return new Set(canonicalText(title).split(" ").filter(Boolean));
}

function words(value) {
  return canonicalText(value).split(" ").filter(Boolean);
}

function includesPhrase(title, phrase) {
  const expected = canonicalText(phrase);
  if (!expected) return true;
  const normalizedTitle = ` ${canonicalText(title)} `;
  return normalizedTitle.includes(` ${expected} `);
}

function normalizeSerial(value) {
  const match = String(value || "").match(/\b0*(\d+)\s*\/\s*0*(\d+)\b/);
  if (!match) return "";
  return `${Number(match[1])}/${Number(match[2])}`;
}

function serialsFromTitle(title) {
  return (String(title || "").match(/\b\d+\s*\/\s*\d+\b/g) || []).map(normalizeSerial);
}

function serialMatches(title, value) {
  const expected = normalizeSerial(value);
  if (!expected) return includesPhrase(title, value);
  return serialsFromTitle(title).includes(expected);
}

function yearMatches(title, value) {
  if (includesPhrase(title, value)) return true;
  const normalizedTitle = ` ${canonicalText(title)} `;
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  return normalizedTitle.includes(` ${match[1].slice(2)} ${match[2]} `)
    || normalizedTitle.includes(` ${match[1]} `);
}

function tokenSubset(title, value) {
  const tokens = titleTokens(title);
  const expected = words(value);
  return expected.length > 0 && expected.every((token) => tokens.has(token));
}

function subjectMatches(title, value) {
  if (tokenSubset(title, value)) return true;
  const titleTokenSet = titleTokens(title);
  const subjectTokens = words(value).filter((token) => !["jr", "sr", "ii", "iii", "iv"].includes(token));
  const lastToken = subjectTokens.at(-1);
  return Boolean(lastToken && lastToken.length >= 4 && titleTokenSet.has(lastToken));
}

function arrayValues(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function expectedSubjects(fields = {}) {
  return [
    ...arrayValues(fields.players),
    fields.player,
    fields.character
  ].filter(Boolean);
}

function expectedRequiredFields(fields = {}, criticalFields = []) {
  const critical = new Set(criticalFields);
  const required = [];
  const add = (field, value, validator = tokenSubset) => {
    if (!value) return;
    if (criticalFields.length && !critical.has(field)) return;
    required.push({ field, value, validator });
  };

  expectedSubjects(fields).forEach((subject) => add("players", subject, subjectMatches));
  add("character", fields.character, subjectMatches);
  add("year", fields.year || fields.season, yearMatches);
  add("product", fields.product, tokenSubset);
  add("set", fields.set, tokenSubset);
  add("subset", fields.subset, tokenSubset);
  add("card_type", fields.card_type, tokenSubset);
  add("insert", fields.insert, tokenSubset);
  add("parallel", fields.parallel, tokenSubset);
  add("variation", fields.variation, tokenSubset);
  add("serial_number", fields.serial_number, serialMatches);
  add("collector_number", fields.collector_number || fields.card_number, includesPhrase);
  add("grade_company", fields.grade_company, tokenSubset);
  add("card_grade", fields.card_grade, includesPhrase);
  add("auto_grade", fields.auto_grade, includesPhrase);

  if ((!criticalFields.length || critical.has("rc")) && fields.rc === true) {
    required.push({
      field: "rc",
      value: "RC",
      validator: (title) => /\b(rc|rookie)\b/i.test(title)
    });
  }
  if ((!criticalFields.length || critical.has("first_bowman")) && fields.first_bowman === true) {
    required.push({
      field: "first_bowman",
      value: "1st Bowman",
      validator: (title) => /\b(1st bowman|first bowman)\b/i.test(title)
    });
  }
  if ((!criticalFields.length || critical.has("auto")) && fields.auto === true) {
    required.push({
      field: "auto",
      value: "Auto",
      validator: (title) => /\b(auto|autograph|signed)\b/i.test(title)
    });
  }
  if ((!criticalFields.length || critical.has("patch")) && fields.patch === true) {
    required.push({
      field: "patch",
      value: "Patch",
      validator: (title) => /\bpatch\b/i.test(title)
    });
  }
  if ((!criticalFields.length || critical.has("relic")) && fields.relic === true) {
    required.push({
      field: "relic",
      value: "Relic",
      validator: (title) => /\b(relic|memorabilia|swatch)\b/i.test(title)
    });
  }

  return required;
}

function parallelEvidence(fields = {}) {
  return canonicalText(fields.parallel || fields.variation || "");
}

function compatibleYear(expected, actual) {
  const expectedText = canonicalText(expected);
  const actualText = canonicalText(actual);
  if (!expectedText || !actualText) return false;
  if (expectedText === actualText) return true;
  const match = expectedText.match(/^(\d{4}) (\d{2})$/);
  if (!match) return false;
  return actualText === match[1] || actualText === `${match[1].slice(2)} ${match[2]}`;
}

function compatibleDescriptor(expected, actual) {
  const expectedTokens = new Set(words(expected));
  const actualTokens = new Set(words(actual));
  if (!expectedTokens.size || !actualTokens.size) return false;
  if ([...actualTokens].every((token) => expectedTokens.has(token))) return true;
  if ([...expectedTokens].every((token) => actualTokens.has(token))) return true;
  return false;
}

function compatibleSerial(expected, actual) {
  const expectedSerial = normalizeSerial(expected);
  const actualSerial = normalizeSerial(actual);
  return Boolean(expectedSerial && actualSerial && expectedSerial === actualSerial);
}

function descriptorEvidence(fields = {}) {
  return canonicalText([
    fields.brand,
    fields.manufacturer,
    fields.product,
    fields.set,
    fields.subset,
    fields.card_type,
    fields.insert,
    fields.parallel,
    fields.variation
  ].filter(Boolean).join(" "));
}

function criticalTokenErrors(title, fields = {}) {
  const tokens = titleTokens(title);
  const expectedParallel = parallelEvidence(fields);
  const expectedParallelTokens = new Set(words(expectedParallel));
  const expectedDescriptorTokens = new Set(words(descriptorEvidence(fields)));
  const errors = [];

  [...colorTokens].forEach((token) => {
    if (!tokens.has(token)) return;
    if (!expectedDescriptorTokens.has(token)) {
      errors.push({
        field: "parallel",
        type: "unexpected_color",
        value: token
      });
    }
  });

  [...parallelStyleTokens].forEach((token) => {
    if (!tokens.has(token)) return;
    if (expectedParallel && !expectedDescriptorTokens.has(token)) {
      errors.push({
        field: "parallel",
        type: "unexpected_parallel_style",
        value: token
      });
    }
  });

  if (fields.auto === false && /\b(auto|autograph|signed)\b/i.test(title)) {
    errors.push({ field: "auto", type: "unexpected_attribute", value: "auto" });
  }
  if (fields.patch === false && /\bpatch\b/i.test(title)) {
    errors.push({ field: "patch", type: "unexpected_attribute", value: "patch" });
  }
  if (fields.rc === false && /\b(rc|rookie)\b/i.test(title)) {
    errors.push({ field: "rc", type: "unexpected_attribute", value: "rc" });
  }

  return errors;
}

function predictedFieldErrors(predictedFields = {}, groundTruthFields = {}, criticalFields = []) {
  const critical = new Set(criticalFields);
  const fieldsToCheck = [
    "year",
    "season",
    "brand",
    "manufacturer",
    "player",
    "players",
    "character",
    "product",
    "set",
    "subset",
    "card_type",
    "insert",
    "parallel",
    "variation",
    "serial_number",
    "collector_number",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type"
  ];

  return fieldsToCheck.flatMap((field) => {
    if (criticalFields.length && !critical.has(field)) return [];
    const expected = canonicalText(Array.isArray(groundTruthFields[field])
      ? groundTruthFields[field].join(" ")
      : groundTruthFields[field]);
    const actual = canonicalText(Array.isArray(predictedFields[field])
      ? predictedFields[field].join(" ")
      : predictedFields[field]);
    const compatible = field === "year" || field === "season"
      ? compatibleYear(groundTruthFields[field], predictedFields[field])
      : field === "serial_number"
        ? compatibleSerial(groundTruthFields[field], predictedFields[field])
      : ["product", "set", "subset", "card_type", "insert", "parallel", "variation"].includes(field)
        ? compatibleDescriptor(groundTruthFields[field], predictedFields[field])
        : false;
    if (!expected || !actual || expected === actual || compatible) return [];
    return [{
      field,
      type: "predicted_field_conflicts_with_ground_truth",
      expected: groundTruthFields[field],
      actual: predictedFields[field]
    }];
  });
}

export function evaluateTitleAcceptance({
  title,
  groundTruthFields = {},
  predictedFields = {},
  criticalFields = []
} = {}) {
  const normalizedTitle = normalizeText(title);
  const requiredChecks = expectedRequiredFields(groundTruthFields, criticalFields);
  const missingRequiredFields = normalizedTitle
    ? requiredChecks
      .filter((check) => !check.validator(normalizedTitle, check.value))
      .map((check) => ({
        field: check.field,
        expected: check.value
      }))
    : requiredChecks.map((check) => ({
      field: check.field,
      expected: check.value
    }));
  const tokenErrors = criticalTokenErrors(normalizedTitle, groundTruthFields);
  const fieldErrors = predictedFieldErrors(predictedFields, groundTruthFields, criticalFields);
  const criticalErrors = [...tokenErrors, ...fieldErrors];

  return {
    title: normalizedTitle,
    accepted: normalizedTitle.length > 0 && missingRequiredFields.length === 0 && criticalErrors.length === 0,
    required_fields_present: missingRequiredFields.length === 0,
    unsubstantiated_critical_errors: criticalErrors.length > 0,
    missing_required_fields: missingRequiredFields,
    critical_errors: criticalErrors,
    policy: "critical-facts-title-acceptance-v1"
  };
}
