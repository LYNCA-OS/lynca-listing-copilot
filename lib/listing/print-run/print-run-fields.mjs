function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePositiveIntegerText(value) {
  const numeric = Number(String(value ?? "").replace(/^0+(?=\d)/, ""));
  if (!Number.isInteger(numeric) || numeric < 1) return null;
  return String(numeric);
}

function normalizePositiveIntegerDisplayText(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  const numeric = Number(text.replace(/^0+(?=\d)/, ""));
  if (!Number.isInteger(numeric) || numeric < 1) return null;
  return text;
}

function basePrintRunFields({
  number = null,
  numerator = null,
  denominator = null,
  oneOfOne = false,
  suspicious = false
} = {}) {
  const normalizedDenominator = normalizePositiveIntegerText(denominator);
  const normalizedNumerator = normalizePositiveIntegerDisplayText(numerator);
  const normalizedNumber = normalizeText(number);
  const output = {};
  if (normalizedNumber) output.print_run_number = normalizedNumber;
  if (normalizedNumerator) output.print_run_numerator = normalizedNumerator;
  if (normalizedDenominator) {
    output.print_run_denominator = normalizedDenominator;
    output.numbered_to = normalizedDenominator;
    output.serial_denominator = normalizedDenominator;
    output.expected_serial_denominator = normalizedDenominator;
  }
  if (oneOfOne) output.one_of_one = true;
  if (suspicious) {
    output.suspicious_print_run = true;
    output.print_run_review_required = true;
  }
  if (output.print_run_number) output.serial_number = output.print_run_number;
  return output;
}

export function parsePrintRunValue(value, {
  allowHyphen = false
} = {}) {
  const raw = normalizeText(value)
    .replace(/\bOne\s+of\s+One\b/gi, "1/1")
    .replace(/[｜|]/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/^#\s*(?=\d)/, "#");
  if (!raw) return {};

  if (/^1\/1$/i.test(raw) || /\b1\/1\b/i.test(raw)) {
    return basePrintRunFields({
      number: "1/1",
      numerator: "1",
      denominator: "1",
      oneOfOne: true
    });
  }

  const denominatorOnly = raw.match(/^#?\/0*(\d{1,6})\b/);
  if (denominatorOnly) {
    const denominator = normalizePositiveIntegerText(denominatorOnly[1]);
    if (!denominator) return {};
    return basePrintRunFields({
      number: denominator === "1" ? "1/1" : `#/${denominator}`,
      numerator: denominator === "1" ? "1" : null,
      denominator,
      oneOfOne: denominator === "1"
    });
  }

  const full = raw.match(/(?:^|[^A-Z0-9])#?(\d{1,6})\/0*(\d{1,6})\b/i);
  const hyphen = allowHyphen
    ? raw.match(/(?:^|[^A-Z0-9])(\d{1,6})-0*(\d{1,6})\b/i)
    : null;
  const match = full || hyphen;
  if (!match) return {};

  const numerator = normalizePositiveIntegerDisplayText(match[1]);
  const denominator = normalizePositiveIntegerText(match[2]);
  if (!numerator || !denominator) return {};

  const numeratorValue = Number(normalizePositiveIntegerText(numerator));
  const denominatorValue = Number(denominator);
  if (denominatorValue === 1 && numeratorValue === 1) {
    return basePrintRunFields({
      number: "1/1",
      numerator,
      denominator,
      oneOfOne: true
    });
  }
  if (numeratorValue > denominatorValue) {
    return basePrintRunFields({
      number: `#/${denominator}`,
      denominator,
      suspicious: true
    });
  }
  return basePrintRunFields({
    number: `${numerator}/${denominator}`,
    numerator,
    denominator
  });
}

export function expandPrintRunFields(input = {}, {
  allowHyphen = false
} = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return parsePrintRunValue(input, { allowHyphen });
  }

  const candidates = [
    input.print_run_number,
    input.numbered,
    input.numbered_value,
    input.serial_number,
    input.numerical_rarity,
    input.numericalRarity
  ];
  let parsed = {};
  for (const candidate of candidates) {
    parsed = parsePrintRunValue(candidate, { allowHyphen });
    if (parsed.print_run_denominator || parsed.print_run_number) break;
  }

  const denominator = normalizePositiveIntegerText(
    input.print_run_denominator
    || input.numbered_to
    || input.serial_denominator
    || input.expected_serial_denominator
    || parsed.print_run_denominator
  );
  const numerator = normalizePositiveIntegerDisplayText(input.print_run_numerator || parsed.print_run_numerator);
  const numeratorValue = Number(normalizePositiveIntegerText(numerator));
  const oneOfOne = input.one_of_one === true || parsed.one_of_one === true || (numeratorValue === 1 && denominator === "1");

  if (!parsed.print_run_number && denominator) {
    parsed = basePrintRunFields({
      number: oneOfOne ? "1/1" : `#/${denominator}`,
      numerator: oneOfOne ? "1" : null,
      denominator,
      oneOfOne
    });
  }

  const output = { ...parsed };
  if (denominator) {
    output.print_run_denominator = denominator;
    output.numbered_to = denominator;
    output.serial_denominator = denominator;
    output.expected_serial_denominator = denominator;
  }
  if (numerator && !output.suspicious_print_run) output.print_run_numerator = numerator;
  if (oneOfOne) {
    output.one_of_one = true;
    output.print_run_number = "1/1";
    output.print_run_numerator = "1";
    output.print_run_denominator = "1";
    output.numbered_to = "1";
    output.serial_number = "1/1";
    output.serial_denominator = "1";
    output.expected_serial_denominator = "1";
  }
  if (output.print_run_number) output.serial_number = output.print_run_number;
  return output;
}

export function denominatorOnlyPrintRun(fields = {}) {
  const expanded = expandPrintRunFields(fields);
  const denominator = expanded.print_run_denominator || expanded.numbered_to || expanded.serial_denominator;
  if (!denominator) return "";
  return denominator === "1" ? "1/1" : `#/${denominator}`;
}

export function printRunTitleText(fields = {}, {
  directCurrentInstance = true
} = {}) {
  const expanded = expandPrintRunFields(fields);
  if (expanded.one_of_one) return "1/1";
  if (directCurrentInstance && expanded.print_run_number && expanded.print_run_numerator && !expanded.suspicious_print_run) {
    return expanded.print_run_number;
  }
  return denominatorOnlyPrintRun(expanded);
}

export function stripReferencePrintRunNumerator(fields = {}) {
  const expanded = expandPrintRunFields(fields);
  const denominator = expanded.print_run_denominator || expanded.numbered_to || expanded.serial_denominator;
  if (!denominator) {
    const next = { ...fields };
    delete next.print_run_number;
    delete next.print_run_numerator;
    delete next.serial_number;
    return next;
  }
  return {
    ...fields,
    print_run_number: denominator === "1" ? "1/1" : `#/${denominator}`,
    print_run_numerator: denominator === "1" ? "1" : null,
    print_run_denominator: denominator,
    numbered_to: denominator,
    serial_number: denominator === "1" ? "1/1" : `#/${denominator}`,
    serial_denominator: denominator,
    expected_serial_denominator: denominator,
    one_of_one: denominator === "1" || fields.one_of_one === true
  };
}
