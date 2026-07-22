// Field normalization family — extracted from the v2 monolith (R1).
// Copied verbatim; behavior must stay bit-identical.
import {
  highValueInsertTerms,
  resolveKnowledgeEntry,
  resolveKnowledgeFromFields
} from "../../listing-knowledge-registry.mjs";
import { expandPrintRunFields } from "../print-run/print-run-fields.mjs";
import { normalizeGradeCompanyValue } from "../grade/grade-company.mjs";
import { gradeTypeForValues, normalizeAutoGradeValue, normalizeGradeValue } from "../grade/grade-value.mjs";
import {
  normalizeStringOrNull,
  narratedProductIdentityFromSet,
  sanitizeIdentityCardNameValue,
  sanitizeIdentitySetValue
} from "./text.mjs";
import { normalizePositiveIntegerOrNull } from "./provider-options.mjs";
import { extractParallelFamily } from "../parallel-policy.mjs";
import { collapseRelatedSubjectIdentities } from "./subject-identity.mjs";
import { trustedDirectoryOverlay } from "../catalog/trusted-directory-facts.mjs";

const backgroundTerms = [
  "Metaverse Cards",
  "LYNCA",
  "CardLadder",
  "eBay UI",
  "table mat",
  "watermark",
  "seller branding"
];
export const backgroundTermPatterns = backgroundTerms.map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"));

const highValueInsertPatterns = highValueInsertTerms.map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));

export function extractHighValueInsert(value) {
  const text = String(value || "");
  const index = highValueInsertPatterns.findIndex((pattern) => pattern.test(text));
  return index === -1 ? null : highValueInsertTerms[index];
}

export function containsBackgroundTerm(value) {
  return backgroundTermPatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(String(value || ""));
  });
}

export function hasExplicitIdentityUncertainty(value) {
  const text = normalizeStringOrNull(value);
  if (!text) return false;
  return /\b(?:maybe|possibly|probably|uncertain|unclear|unknown|not\s+sure|could\s+be|might\s+be|appears\s+to\s+be)\b/i.test(text)
    || /\(\s*(?:or|maybe|possibly)\b/i.test(text)
    || /\b(?:either)\b[^.]{0,80}\bor\b/i.test(text);
}

export function normalizeIdentityTextOrNull(value) {
  const normalized = normalizeStringOrNull(value);
  return normalized && !hasExplicitIdentityUncertainty(normalized) ? normalized : null;
}

const uncertaintyFieldAliases = new Map(Object.entries({
  year: "year",
  manufacturer: "manufacturer",
  maker: "manufacturer",
  brand: "brand",
  product: "product",
  product_or_set: "product",
  productOrSet: "product",
  set: "set",
  subset: "subset",
  language: "language",
  card_type: "card_type",
  cardType: "card_type",
  official_card_type: "official_card_type",
  officialCardType: "official_card_type",
  insert: "insert",
  surface_color: "surface_color",
  surfaceColor: "surface_color",
  color: "surface_color",
  parallel_family: "parallel_family",
  parallelFamily: "parallel_family",
  parallel_exact: "parallel_exact",
  parallelExact: "parallel_exact",
  exact_parallel: "parallel_exact",
  exactParallel: "parallel_exact",
  variant_or_parallel: "parallel_exact",
  variantOrParallel: "parallel_exact",
  parallel: "parallel",
  variation: "variation",
  character: "character",
  card_name: "card_name",
  cardName: "card_name",
  name: "card_name",
  team: "team"
}));

export function explicitlyUncertainIdentityFields(fields = {}) {
  const rejected = new Set();
  for (const [sourceField, canonicalField] of uncertaintyFieldAliases.entries()) {
    if (hasExplicitIdentityUncertainty(fields?.[sourceField])) rejected.add(canonicalField);
  }
  const playerValues = [
    ...(Array.isArray(fields?.players) ? fields.players : []),
    fields?.player,
    fields?.subject,
    fields?.character
  ];
  if (playerValues.some(hasExplicitIdentityUncertainty)) rejected.add("players");
  return [...rejected];
}

export function normalizeRookieMarker(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return /^(?:RC|Rookie|Rookie Card|Rated Rookie)$/i.test(normalized) ? "RC" : normalized;
}

export function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined || value === "") return false;
  return /^(true|yes|y|1|rc|rc logo|rookie|rookie card|rookie logo|rookie ticket|rated rookie|1st bowman|first bowman|auto|autograph|ssp|case hit|patch|relic|jersey|sketch|redemption|1\/1)$/i.test(normalizeStringOrNull(value) || "");
}

export function normalizeObservableComponents(value) {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).filter(([, enabled]) => enabled === true).map(([component]) => component)
      : String(value || "").split(/[,\s/]+/);
  const aliases = {
    autograph: "auto",
    autographs: "auto",
    signature: "auto",
    signatures: "auto",
    signed: "auto",
    memorabilia: "relic",
    swatch: "relic",
    logoman: "relic",
    rookie: "rc",
    rookie_card: "rc",
    rookie_ticket: "rc",
    rated_rookie: "rc"
  };
  const allowed = new Set(["auto", "patch", "relic", "jersey", "rc", "sketch", "redemption"]);
  return [...new Set(raw
    .map((item) => String(item || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .map((item) => aliases[item] || item)
    .filter((item) => allowed.has(item)))];
}

export function normalizeGradeCompanyForFields(value) {
  return normalizeGradeCompanyValue(value);
}

function playerInitialsForCodeGuard(value) {
  const text = normalizeStringOrNull(value);
  if (!text) return "";
  const words = text
    .replace(/[^A-Za-z\s'-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
  if (words.length < 2) return "";
  return words.map((word) => word[0]).join("").toUpperCase();
}

export function normalizePrintedCardCodeForFields(value, context = {}) {
  const normalized = normalizeStringOrNull(value);
  if (!normalized) return null;
  const rawCode = normalized.replace(/^#\s*/, "").trim();
  const compoundParts = rawCode.split(/\s*(?:[·•|;,])\s*/).filter(Boolean);
  const tcgRatioParts = compoundParts.filter((part) => {
    const match = part.match(/^(\d{1,4})\s*\/\s*(\d{1,4})$/);
    return match && Number(match[1]) > Number(match[2]);
  });
  // A ratio whose numerator exceeds its denominator is a TCG checklist number,
  // not a physical print run. Recover it from compound OCR text without making
  // ordinary sports serials (for example 11/15) into card-number anchors.
  const code = tcgRatioParts.length === 1 ? tcgRatioParts[0] : rawCode;
  if (!code) return null;
  if (/^(?:unknown|none|null|n\/a|na|not\s+visible|unreadable|unclear)$/i.test(code)) return null;

  // Printed card numbers are compact identifiers, not OCR-concatenated title
  // fragments. Reject prose-like blobs before they can become retrieval anchors.
  // This intentionally preserves common sports/TCG forms such as PA-ANT,
  // 83T-6, OP01-001, CT14-EN001, 201/165, and short all-alpha set codes.
  if (code.length > 24) return null;
  if (/\b(?:PANINI|TOPPS|BOWMAN|DONRUSS|PRIZM|CHROME|WORLD\s*CUP|COLLECTION)\b/i.test(code)) return null;
  if (/\b(?:19|20)\d{2}\b/.test(code) && /[A-Za-z]/.test(code) && code.length > 12) return null;
  if (/\s/.test(code) && !/^[A-Z0-9]{1,8}\s+\d{1,4}\/\d{1,4}$/i.test(code)) return null;
  if (!/^(?:\d{1,4}(?:\/\d{1,4})?|[A-Z]{3,8}|(?=[A-Z0-9]{3,12}$)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+|[A-Z0-9]{1,12}(?:[-/:][A-Z0-9]{1,12}){1,3}|[A-Z0-9]{1,8}\s+\d{1,4}\/\d{1,4})$/i.test(code)) return null;

  // Two-letter all-alpha values are usually player initials leaked from labels
  // such as PAU-AED -> AED/JS, not a standalone card number. Keep real product
  // codes like PAU, PAU-AED, CA-LY, OP01-001, or numeric card numbers.
  if (/^[A-Z]{1,2}$/i.test(code)) return null;
  if (/^\d{2,4}(?:YANKEES|DODGERS|LAKERS|CELTICS|WARRIORS|BULLS|CHIEFS|PATRIOTS|COWBOYS)$/i.test(code)) return null;

  const subjects = [
    ...(Array.isArray(context.players) ? context.players : []),
    context.player,
    context.subject,
    context.character
  ].filter(Boolean);
  const upperCode = code.toUpperCase();
  const subjectInitials = subjects.map(playerInitialsForCodeGuard).filter(Boolean);
  if (subjectInitials.includes(upperCode)) return null;
  const subjectCodes = subjects
    .map((subject) => String(subject || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase())
    .filter(Boolean);
  if (subjectCodes.includes(upperCode.replace(/[^A-Z0-9]/g, ""))) return null;

  return code;
}

function cleanPlayerNameForFields(value, { allowSingleToken = false } = {}) {
  let text = normalizeIdentityTextOrNull(value);
  if (!text) return null;
  text = text
    .replace(/^visible[_\s-]*text\s*:?\s*/i, "")
    .replace(/\bvisible[_\s-]*text\b.*$/i, "")
    .replace(/\b\d{1,4}\s*\/\s*\d{1,4}\b.*$/i, "")
    .replace(/\b(?:PSA|BGS|SGC|CGC|GEM\s*MT|MINT|AUTHENTIC)\b.*$/i, "")
    .replace(/\s+\b(?:Gold|Red|Blue|Green|Purple|Orange|Black|Silver|White|Yellow|Sapphire|Refractor|Prizm|Ray\s*Wave|Raywave|Wave|Shimmer|Mojo|Cracked\s+Ice|Geometric|Variation|Auto|Autograph|Signatures?|Rookie|RC)\b.*$/i, "")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (/[|]/.test(text)) return null;
  if (/\/.+/.test(text)) return null;
  if (/\b(?:visible|copyright|trademark|legal|rights?|brand\s+elements?|designs?|trad(?:e)?|manufacturer|boilerplate|year|season|release|card|label|front|back|text|product|unknown|unreadable|unclear|athlete|subject)\b/i.test(text)) return null;
  if (/^(?:Autos?|Autographs?|Certified|Topps\s+Certified|Club\s+Legends|Historic\s+Ties(?:\s+Triple)?|Rookie\s+Ticket|Next\s+Stop\s+Signatures|Canvas\s+Creations(?:\s+Autos?)?|Hoopla|Material\s+Signatures|Variation[-\s]*Autograph|1983\s+Topps|Gem\s*Mt|Mint)$/i.test(text)) return null;
  if (/\b(?:Topps|Panini|Bowman|Donruss|Prizm|Finest|Chrome|Sapphire|Impeccable|Contenders|Absolute|Memorabilia|Triple\s+Threads|Certified)\b/i.test(text)) return null;
  if (/^(?:FC|AFC|CF|SC)\b/i.test(text) || /\b(?:FC|AFC|CF|SC|Barcelona|Angels|Yankees|Dodgers|Lakers|Celtics|Warriors|Bulls|Chiefs|Patriots|Cowboys)\b/i.test(text)) return null;
  if (/\d/.test(text)) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < (allowSingleToken ? 1 : 2) || words.length > 4) return null;
  return text;
}

function cleanProductNameForFields(value) {
  const text = normalizeIdentityTextOrNull(value);
  if (!text) return null;
  const normalized = text
    .replace(/\b(Panini|Topps|Bowman|Donruss)\s*[-–]\s*/gi, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
  const lower = normalized.toLowerCase();
  const exact = new Map([
    ["topps chrome", "Topps Chrome"],
    ["topps finest", "Topps Finest"],
    ["topps sapphire", "Topps Sapphire"],
    ["topps 3", "Topps Three"],
    ["topps 3 basketball", "Topps Three"],
    ["topps three basketball", "Topps Three"],
    ["panini prizm", "Panini Prizm"],
    ["panini prizm fifa soccer", "Panini Prizm FIFA Soccer"],
    ["panini impeccable", "Panini Impeccable"],
    ["panini contenders", "Panini Contenders"],
    ["panini absolute memorabilia", "Panini Absolute Memorabilia"],
    ["topps triple threads", "Topps Triple Threads"]
  ]);
  return exact.get(lower) || normalized;
}

function normalizeNamedIdentityForFields(value) {
  const normalized = normalizeIdentityTextOrNull(value);
  if (!normalized) return null;
  return normalized.replace(/\bRain\s+Drops\s+Signatures\b/gi, "Raindrops Signatures");
}

function normalizePlayerListForFields(fields = {}) {
  const rawPlayers = [
    ...(Array.isArray(fields.players) ? fields.players : []),
    ...(Array.isArray(fields.subjects) ? fields.subjects : []),
    ...(Array.isArray(fields.subject) ? fields.subject : [])
  ];
  const fallbackPlayers = rawPlayers.length
    ? []
    : String(fields.player || fields.subject || "")
      .split(/\s*\/\s*/)
      .filter(Boolean);
  const players = collapseRelatedSubjectIdentities([...rawPlayers, ...fallbackPlayers]
    .map((value) => cleanPlayerNameForFields(value, { allowSingleToken: true }))
    .filter(Boolean));
  return players;
}

export function normalizeFields(fields = {}) {
  const cardCount = normalizePositiveIntegerOrNull(fields.card_count ?? fields.cardCount);
  const rawLotType = normalizeStringOrNull(fields.lot_type ?? fields.lotType);
  // A single physical card is definitionally not a lot. Provider responses can
  // occasionally emit `multi_card: true` together with `card_count: 1`; make
  // that impossible state collapse deterministically before routing/rendering.
  const multiCard = cardCount === 1
    ? false
    : normalizeBoolean(fields.multi_card ?? fields.multiCard) || Number(cardCount || 0) > 1;
  const players = normalizePlayerListForFields(fields);
  const rawInsertText = normalizeStringOrNull(fields.insert);
  const observableComponents = normalizeObservableComponents(fields.observable_components || fields.observableComponents);
  const printRun = expandPrintRunFields(fields);
  const explicitProduct = cleanProductNameForFields(fields.product || fields.product_or_set || fields.productOrSet);
  const narratedProduct = narratedProductIdentityFromSet(fields.set);
  const product = narratedProduct && /^(?:Topps|Bowman|Panini|Upper\s+Deck|Donruss|Leaf)$/i.test(explicitProduct || "")
    ? cleanProductNameForFields(narratedProduct)
    : explicitProduct;
  const normalized = {
    year: normalizeIdentityTextOrNull(fields.year),
    manufacturer: normalizeIdentityTextOrNull(fields.manufacturer || fields.maker),
    brand: normalizeIdentityTextOrNull(fields.brand || fields.manufacturer || fields.maker),
    product,
    multi_card: multiCard,
    card_count: cardCount,
    lot_type: multiCard || rawLotType === "MULTI_SUBJECT_REVIEW" ? rawLotType : null,
    set: normalizeNamedIdentityForFields(sanitizeIdentitySetValue(fields.set)),
    subset: normalizeIdentityTextOrNull(normalizeRookieMarker(fields.subset)),
    language: normalizeIdentityTextOrNull(fields.language),
    card_type: normalizeIdentityTextOrNull(fields.card_type || fields.cardType || fields.type),
    official_card_type: normalizeIdentityTextOrNull(fields.official_card_type || fields.officialCardType),
    observable_components: observableComponents,
    insert: normalizeNamedIdentityForFields(rawInsertText),
    surface_color: normalizeIdentityTextOrNull(fields.surface_color || fields.surfaceColor || fields.color),
    // When the provider reads the finish as part of the surface/parallel
    // phrase ("Gold Refractor", "Blue Sparkle Refractor"), decompose the
    // curated optical finish words into parallel_family instead of dropping
    // them with the color filter. Explicit parallel_family always wins.
    parallel_family: normalizeIdentityTextOrNull(fields.parallel_family || fields.parallelFamily)
      || normalizeIdentityTextOrNull(extractParallelFamily(
        fields.surface_color || fields.surfaceColor || fields.color,
        fields.parallel,
        fields.variant_or_parallel || fields.variantOrParallel
      )),
    parallel_exact: normalizeIdentityTextOrNull(fields.parallel_exact || fields.parallelExact || fields.exact_parallel || fields.exactParallel || fields.variant_or_parallel || fields.variantOrParallel),
    parallel: normalizeIdentityTextOrNull(fields.parallel),
    variation: normalizeIdentityTextOrNull(fields.variation),
    player: players.join(" / ") || cleanPlayerNameForFields(fields.player || fields.subject, { allowSingleToken: true }) || null,
    players,
    character: normalizeIdentityTextOrNull(fields.character),
    card_name: normalizeNamedIdentityForFields(sanitizeIdentityCardNameValue(fields.card_name || fields.cardName || fields.name)),
    artist: normalizeStringOrNull(fields.artist),
    team: normalizeIdentityTextOrNull(fields.team),
    card_number: null,
    collector_number: null,
    checklist_code: null,
    print_run_number: normalizeStringOrNull(fields.print_run_number || printRun.print_run_number),
    print_run_numerator: normalizeStringOrNull(fields.print_run_numerator || printRun.print_run_numerator),
    print_run_denominator: normalizeStringOrNull(fields.print_run_denominator || printRun.print_run_denominator),
    numbered_to: normalizeStringOrNull(fields.numbered_to || printRun.numbered_to),
    serial_number: normalizeStringOrNull(fields.serial_number || printRun.serial_number),
    serial_denominator: normalizeStringOrNull(fields.serial_denominator || printRun.serial_denominator),
    numerical_rarity: normalizeStringOrNull(fields.numerical_rarity || fields.numericalRarity),
    expected_serial_denominator: normalizeStringOrNull(fields.expected_serial_denominator || printRun.expected_serial_denominator),
    grade_company: normalizeGradeCompanyForFields(fields.grade_company),
    grade: normalizeGradeValue(fields.grade || fields.card_grade),
    card_grade: normalizeGradeValue(fields.card_grade || fields.grade),
    auto_grade: normalizeAutoGradeValue(fields.auto_grade),
    grade_type: gradeTypeForValues(fields.card_grade || fields.grade, fields.auto_grade, fields.grade_type),
    rc: normalizeBoolean(fields.rc) || observableComponents.includes("rc"),
    first_bowman: normalizeBoolean(fields.first_bowman),
    ssp: normalizeBoolean(fields.ssp),
    case_hit: normalizeBoolean(fields.case_hit),
    auto: normalizeBoolean(fields.auto) || observableComponents.includes("auto"),
    relic: normalizeBoolean(fields.relic) || observableComponents.includes("relic"),
    patch: normalizeBoolean(fields.patch) || observableComponents.includes("patch"),
    jersey: normalizeBoolean(fields.jersey) || observableComponents.includes("jersey"),
    sketch: normalizeBoolean(fields.sketch) || observableComponents.includes("sketch"),
    redemption: normalizeBoolean(fields.redemption) || observableComponents.includes("redemption"),
    one_of_one: normalizeBoolean(fields.one_of_one) || printRun.one_of_one === true,
    suspicious_print_run: normalizeBoolean(fields.suspicious_print_run) || printRun.suspicious_print_run === true,
    print_run_review_required: normalizeBoolean(fields.print_run_review_required) || printRun.print_run_review_required === true
  };

  normalized.card_number = normalizePrintedCardCodeForFields(fields.card_number, normalized);
  normalized.collector_number = normalizePrintedCardCodeForFields(fields.collector_number, normalized);
  normalized.checklist_code = normalizePrintedCardCodeForFields(fields.checklist_code, normalized);

  Object.keys(normalized).forEach((key) => {
    if (typeof normalized[key] === "string" && containsBackgroundTerm(normalized[key])) {
      normalized[key] = null;
    }
  });

  const explicitInsertEntry = resolveKnowledgeEntry(normalized.insert);
  if (explicitInsertEntry) {
    normalized.insert = explicitInsertEntry.label;
  }

  const registryInsert = resolveKnowledgeFromFields(normalized);
  if (registryInsert && !normalized.insert) {
    normalized.insert = registryInsert.label;
  }

  if (/^TCAR[- ]/i.test(normalized.card_number || "")) {
    normalized.insert = "Chrome Rookie Auto";
    normalized.auto = true;
  }

  if (/^SR[- ]/i.test(normalized.card_number || "")) {
    normalized.insert = "Star Swatch Signatures";
  }

  if (/cosmic chrome/i.test(`${normalized.brand || ""} ${normalized.product || ""} ${normalized.set || ""}`)) {
    normalized.product = "Topps Cosmic Chrome";
    if (normalized.brand && /topps/i.test(normalized.brand)) normalized.brand = "Topps";
  }

  Object.assign(normalized, trustedDirectoryOverlay(normalized));

  // Chrome-stock releases (Topps Chrome, Bowman Chrome, Finest) print their
  // colored BASE/insert parallels on refractor stock; the card itself rarely
  // says the word, so providers report only the color. Append the finish for a
  // colored parallel unless a finish naming it (or a Sapphire-line product)
  // already covers it. Autograph subsets are excluded — their colored parallel
  // naming is irregular (e.g. "Gold" auto is not always "Gold Refractor") and
  // must not be synthesized. Base cards carry no surface_color and are
  // untouched.
  const chromeStockFamily = /\b(?:topps chrome|bowman chrome|finest)\b/i.test(
    `${normalized.brand || ""} ${normalized.product || ""} ${normalized.set || ""}`
  );
  const chromeFinishAlreadyNamed = /fractor|sapphire/i.test(
    `${normalized.parallel_family || ""} ${normalized.parallel_exact || ""} ${normalized.insert || ""} ${normalized.product || ""}`
  );
  if (chromeStockFamily && !chromeFinishAlreadyNamed && normalized.auto !== true && String(normalized.surface_color || "").trim()) {
    normalized.parallel_family = String(normalized.parallel_family || "").trim()
      ? `${String(normalized.parallel_family).trim()} Refractor`
      : "Refractor";
  }

  if (/red propulsion/i.test(`${normalized.insert || ""} ${normalized.parallel || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Red Propulsion";
    normalized.parallel = null;
  }

  if (/dual signatures/i.test(`${normalized.insert || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Dual Signatures";
    normalized.auto = true;
  }

  if (/jersey\s+no\.?/i.test(rawInsertText || "")) {
    normalized.card_number = null;
    normalized.collector_number = null;
  }

  if (/duo logoman|dual rookie logoman/i.test(`${normalized.insert || ""} ${normalized.subset || ""}`)) {
    normalized.insert = "Duo Logoman Autographs";
    normalized.auto = true;
  }

  if (!normalized.observable_components.length) {
    ["auto", "patch", "relic", "jersey", "rc", "sketch", "redemption"].forEach((component) => {
      if (normalized[component]) normalized.observable_components.push(component);
    });
  }

  const parallelInsert = resolveKnowledgeEntry(normalized.parallel) || (
    extractHighValueInsert(normalized.parallel)
      ? { label: extractHighValueInsert(normalized.parallel) }
      : null
  );
  if (parallelInsert && normalized.insert === parallelInsert.label) {
    normalized.parallel = null;
  }

  return normalized;
}
