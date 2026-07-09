// Anchor-first recognition path: classify number-like strings found on the
// card / slab into typed anchors. "Looks like a serial number" is four very
// different things:
//
//   IDENTITY   — resolves to WHICH card design this is (TCG set code, exact
//                catalog code); strong lookup keys.
//   INSTANCE   — points at THIS physical copy (grading cert number, serial
//                numerator); a cert upgrades to identity ONLY via a registry
//                lookup plus visual verification.
//   CATALOG    — design identifiers that are not globally unique alone
//                (collector number, checklist code); need year+product+subject.
//   COMMERCIAL — value signals that never determine identity (numerical
//                rarity 31/50, grade); they go in the title, never in lookup.

export const anchorClasses = Object.freeze({
  IDENTITY: "IDENTITY",
  INSTANCE: "INSTANCE",
  CATALOG: "CATALOG",
  COMMERCIAL: "COMMERCIAL"
});

const knownGraders = Object.freeze(["PSA", "BGS", "SGC", "CGC", "PSA/DNA", "JSA"]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeGrader(value = "") {
  const upper = cleanText(value).toUpperCase();
  if (!upper) return "";
  if (upper.includes("PSA/DNA") || upper.includes("PSA DNA")) return "PSA/DNA";
  for (const grader of knownGraders) {
    if (upper === grader || upper.startsWith(`${grader} `) || upper.includes(grader)) return grader;
  }
  return "";
}

// TCG codes are set-code + card-number pairs like OP01-120, ST10-013,
// CORI-JP028, SV2a-165: strong identity keys inside the TCG segment.
const tcgCodePattern = /^[A-Z]{2,5}[0-9]{0,3}[a-z]?-(?:[A-Z]{0,4})[0-9]{2,4}$/;

// Sports checklist codes: short letter prefix + suffix (NB-TYG, LSB-PMS,
// BS-4, CRA-YY). Catalog anchors — unique only with year/product/subject.
const checklistCodePattern = /^[A-Z]{1,6}-[A-Z0-9]{1,8}$/i;

const numericalRarityPattern = /^#?\s*([0-9]{1,4})\s*\/\s*([0-9]{1,4})$/;

const collectorNumberPattern = /^#?\s*([0-9]{1,4})[A-Za-z]?$/;

// Grading cert numbers are longer pure-digit runs: PSA 8-9, BGS/SGC/CGC 7-10.
// A bare 7+ digit number with no slash is a cert candidate, strongest when a
// grader name was read nearby.
const certNumberPattern = /^[0-9]{7,10}$/;

export function classifyAnchorText(raw, { graderHint = "" } = {}) {
  const text = cleanText(raw);
  if (!text) return null;

  const rarity = text.match(numericalRarityPattern);
  if (rarity) {
    return {
      anchor_type: "numerical_rarity",
      anchor_class: anchorClasses.COMMERCIAL,
      normalized: `${rarity[1]}/${rarity[2]}`,
      numerator: rarity[1],
      denominator: rarity[2],
      lookup_key: false
    };
  }

  const compact = text.replace(/^#/, "").trim();

  if (certNumberPattern.test(compact)) {
    const grader = normalizeGrader(graderHint);
    return {
      anchor_type: "cert_number",
      anchor_class: anchorClasses.INSTANCE,
      normalized: compact,
      grader: grader || null,
      lookup_key: true,
      lookup_target: "cert_registry"
    };
  }

  if (tcgCodePattern.test(compact)) {
    return {
      anchor_type: "tcg_card_code",
      anchor_class: anchorClasses.IDENTITY,
      normalized: compact.toUpperCase(),
      lookup_key: true,
      lookup_target: "catalog"
    };
  }

  if (checklistCodePattern.test(compact)) {
    return {
      anchor_type: "checklist_code",
      anchor_class: anchorClasses.CATALOG,
      normalized: compact.toUpperCase(),
      lookup_key: true,
      lookup_target: "catalog"
    };
  }

  const collector = compact.match(collectorNumberPattern);
  if (collector) {
    return {
      anchor_type: "collector_number",
      anchor_class: anchorClasses.CATALOG,
      normalized: compact.toUpperCase(),
      lookup_key: true,
      lookup_target: "catalog"
    };
  }

  return {
    anchor_type: "unknown",
    anchor_class: anchorClasses.COMMERCIAL,
    normalized: text,
    lookup_key: false
  };
}

// Collect typed anchors from a scout observation (resolved fields) plus any
// preingestion evidence values. Instance fields never leak into lookup keys
// beyond their class: a serial numerator stays commercial, a cert number only
// keys the registry.
export function collectAnchors({ resolved = {}, evidence = {} } = {}) {
  const graderHint = cleanText(resolved.grade_company || evidence.grade_company?.value || "");
  const anchors = [];
  const push = (value, sourceField) => {
    const anchor = classifyAnchorText(value, { graderHint });
    if (anchor && anchor.anchor_type !== "unknown") {
      anchors.push({ ...anchor, source_field: sourceField });
    }
  };

  push(resolved.cert_number, "cert_number");
  push(resolved.tcg_card_number, "tcg_card_number");
  push(resolved.checklist_code, "checklist_code");
  push(resolved.collector_number || resolved.card_number, "collector_number");
  push(resolved.serial_number, "serial_number");
  for (const [field, entry] of Object.entries(evidence || {})) {
    if (!["cert_number", "tcg_card_number", "checklist_code", "collector_number", "card_number"].includes(field)) continue;
    push(entry?.value ?? entry, `evidence:${field}`);
  }

  const seen = new Set();
  return anchors.filter((anchor) => {
    const key = `${anchor.anchor_type}:${anchor.normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function strongestIdentityAnchor(anchors = []) {
  return anchors.find((anchor) => anchor.anchor_type === "cert_number" && anchor.grader)
    || anchors.find((anchor) => anchor.anchor_type === "cert_number")
    || anchors.find((anchor) => anchor.anchor_type === "tcg_card_code")
    || null;
}
