function normalizedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanNumberText(value) {
  return normalizedText(value).replace(/^#/, "");
}

function normalizeSlashNumber(value) {
  return normalizedText(value)
    .replace(/^#/, "")
    .replace(/\s*\/\s*/g, "/");
}

export function classifyNumberToken(value) {
  const text = normalizedText(value);
  if (!text) return "none";

  const slash = normalizeSlashNumber(text).match(/^(\d{1,4})\/(\d{1,4})$/);
  if (slash) {
    const numerator = Number(slash[1]);
    const denominator = Number(slash[2]);
    if (numerator <= denominator) return "serial_number";
    return "collector_number";
  }

  if (/^[A-Z]{1,10}[- ][A-Z0-9]{1,16}$/i.test(text)) {
    return "checklist_code";
  }

  if (/^#?\d{1,4}[A-Z]?$/i.test(text)) {
    return "collector_number";
  }

  return "collector_number";
}

export function splitCardNumber(value) {
  const text = normalizedText(value);
  const kind = classifyNumberToken(text);

  return {
    serial_number: kind === "serial_number" ? normalizeSlashNumber(text) : null,
    collector_number: kind === "collector_number" ? cleanNumberText(text) || null : null,
    checklist_code: kind === "checklist_code" ? text.replace(/\s+/g, "-").toUpperCase() : null
  };
}

export function resolveNumberFields({
  resolved = {},
  legacyFields = {}
} = {}) {
  const next = { ...resolved };
  const notes = [];

  if (legacyFields.card_number) {
    const split = splitCardNumber(legacyFields.card_number);
    for (const [field, value] of Object.entries(split)) {
      if (value && !next[field]) {
        next[field] = value;
        notes.push({
          field,
          action: "split_legacy_card_number",
          from: legacyFields.card_number,
          to: value
        });
      }
    }
  }

  if (legacyFields.serial_number) {
    const serial = normalizeSlashNumber(legacyFields.serial_number);
    if (serial && next.serial_number !== serial) {
      next.serial_number = serial;
      notes.push({
        field: "serial_number",
        action: "explicit_serial_number",
        to: serial
      });
    }
  }

  if (next.checklist_code) {
    next.checklist_code = normalizedText(next.checklist_code).replace(/\s+/g, "-").toUpperCase();
  }

  if (next.collector_number) {
    next.collector_number = cleanNumberText(next.collector_number);
  }

  if (next.serial_number) {
    next.serial_number = normalizeSlashNumber(next.serial_number);
  }

  return {
    resolved: next,
    notes
  };
}
