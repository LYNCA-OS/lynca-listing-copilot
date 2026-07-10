// Provider prompt stage — extracted from the v2 monolith (R1).
// The prompt text is accuracy-load-bearing and pinned by
// scripts/golden-prompt-snapshot.test.mjs; bodies are copied verbatim.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { registryPromptSummary } from "../../listing-knowledge-registry.mjs";
import { summarizeAssetImageQuality } from "../image-quality/quality-gate.mjs";
import { envFlag, optionFlag } from "./flags.mjs";
import { providerOptionsFromPayload, valuePresent } from "./provider-options.mjs";

const promptRoot = join(process.cwd(), "prompts");
const promptFiles = [
  "listing-intelligence-v1.md",
  "examples/sports.md",
  "examples/pokemon.md",
  "examples/marvel.md",
  "examples/sketch.md",
  "examples/redemption.md"
];
let promptCache;

export async function loadPrompt() {
  if (promptCache) return promptCache;

  const sections = await Promise.all(promptFiles.map(async (file) => {
    const content = await readFile(join(promptRoot, file), "utf8");
    return `--- ${file} ---\n${content.trim()}`;
  }));

  promptCache = sections.join("\n\n");
  return promptCache;
}

function resolutionHints(resolutionMap) {
  return Object.entries(resolutionMap || {})
    .map(([code, label]) => `${code}: ${label}`)
    .join("\n");
}

function compactScoutHintFields(fields = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  const allowed = [
    "year",
    "manufacturer",
    "brand",
    "product",
    "set",
    "players",
    "subject",
    "character",
    "card_name",
    "insert",
    "surface_color",
    "print_run_number",
    "print_run_denominator",
    "numbered_to",
    "collector_number",
    "checklist_code",
    "card_number",
    "tcg_card_number",
    "grade_company",
    "card_grade",
    "auto_grade",
    "grade_type",
    "rc",
    "auto",
    "patch",
    "relic",
    "jersey",
    "one_of_one"
  ];
  const output = {};
  for (const field of allowed) {
    const value = fields[field];
    if (!valuePresent(value)) continue;
    output[field] = value;
  }
  return output;
}

export function l1FastScoutHintPromptSection(payload = {}) {
  const fields = compactScoutHintFields(payload.l1_fast_scout_resolved_hint || payload.l1FastScoutResolvedHint || {});
  const title = String(payload.l1_fast_scout_title_hint || payload.l1FastScoutTitleHint || "").replace(/\s+/g, " ").trim();
  const unresolved = Array.isArray(payload.l1_fast_scout_unresolved_hint || payload.l1FastScoutUnresolvedHint)
    ? (payload.l1_fast_scout_unresolved_hint || payload.l1FastScoutUnresolvedHint).map(String).filter(Boolean).slice(0, 12)
    : [];
  if (!title && !Object.keys(fields).length && !unresolved.length) return "";
  return [
    "Internal L1 scout context:",
    JSON.stringify({
      title,
      fields,
      unresolved
    }),
    "L1 scout policy:",
    "- L1 scout is an internal fast observation from the same uploaded images, not a ground-truth source.",
    "- Use it to focus L2 on confirming, correcting, and completing fields instead of starting from scratch.",
    "- Current image/slab/card text always overrides L1 when they conflict.",
    "- Do not copy any field from L1 unless it is visible or supported in the current images or prompt-safe catalog/vector evidence.",
    "- If L1 only saw a denominator such as #/99, reread the current image for a visible numerator; keep #/D only when numerator is not directly readable."
  ].join("\n");
}

export function captureQualityForPayload(payload = {}) {
  return payload.captureQuality || payload.capture_quality || summarizeAssetImageQuality(payload.images || []);
}

export function fastInitialRecognitionPrompt(payload, maxTitleLength) {
  const vectorPacket = payload.vectorCandidatePacket || payload.vector_candidate_packet || null;
  return [
    "You are the first-pass card evidence reader for LYNCA Listing Copilot.",
    "Use only the supplied card/slab images. Do not use marketplace wording, memory, or outside knowledge.",
    "Return compact valid JSON only. Do not write Markdown.",
    "Goal: extract grounded identity evidence; deterministic code will render the English title.",
    "Fill every directly visible core field. Missing serial, grade, or exact parallel must not erase visible year, product, set, or players.",
    "Leave only unreadable or uncertain high-risk fields empty.",
    "Use the canonical Linear SEM standard linear-cos-10-23-v25. Standard Card Grammar = Year -> normalized Manufacturer/Product/Set -> Subject -> Card Name -> Release Variant -> Print Finish -> Numerical Rarity -> Descriptive Rarity -> Card Number -> Search Optimization -> Grading Info. TCG keeps its separate card-centric grammar. Deterministic code renders and compresses the final English title.",
    "Sports card_name rule: if any uploaded image prints a named card title or segment such as Best Performance, Club Legends, Gusto, Power Partnership, Canvas Creations, Rookie Ticket, or Next Stop Signatures, put the literal card name in fields.card_name when it is the card's named segment; use insert only for formal insert/set identity when that is the better structured field. Renderer places card_name after Subject.",
    "High-value material/card-name rule: when directly visible, preserve words such as NFL Shield, Logoman, Laundry Tag, Platinum Bar, Spotlight/Spotlights, Rookie Material Signatures, and Rookie Patch Auto in card_name or observable_components. If only a generic patch is visible, keep Patch and do not invent Shield/Logoman/Platinum.",
    "Chrome finish rule: if Refractor/Holo/Prizm/Chrome finish wording is printed on the card/slab/back or is directly readable as a named card text, capture it in card_name or print finish. If it is only visual shine without text/catalog support, keep only surface_color.",
    "Release Variant rule: release variant means layout/composition/design-direction differences within the same Card Name/Card Type, such as Horizontal, Vertical, Variation, Photo Variation, Image Variation, Design Variation, or International. Do not put FOTL, Hobby, Retail, Choice, Fast Break, Sapphire, colors, foil, holo, refractor, rarity, product, or set into Release Variant.",
    "Product/Set storage vs output rule: keep manufacturer/product/set as structured backend fields even when long, but the renderer smart-collapses redundant hierarchy. Example fields manufacturer=Panini, product=Panini Prizm Black, set=Panini Prizm Black FOTL should resolve as product/set evidence, not as repeated title words; output will become Panini Prizm Black.",
    "Card Name / Release Variant / Print Finish rule: keep the fields separate for learning, but do not duplicate the same word across them. Example card_name=Gold Refractor Autograph, release_variant=Variation, print_finish=Gold should render naturally as Gold Refractor Auto Variation; do not output Gold twice.",
    "Card Name must not include the subject/player name. Example Yoshinobu Yamamoto Patch Auto => players [Yoshinobu Yamamoto], card_name Patch Auto. Code-like shorthand belongs in card_number/collector_number/checklist_code, not product or card_name prose.",
    "TCG field rule: Subject is the character/card subject, Card Name is the printed card-title segment. Example Pikachu Illustrator: subject=Pikachu, card_name=Illustrator. Do not put the whole phrase Pikachu Illustrator into Subject.",
    "Do not cross module boundaries: serial numbers are not grades, grade-label words are not checklist codes, product names are not player names, and visual color alone is surface_color rather than exact parallel.",
    "If a card has front and back images, combine them into one identity when they are the same card.",
    "Hard-text scan order: before finalizing identity, explicitly inspect slab label, card front limited-numbering, card back code/product text, card number/code, and grade/autograph label areas. Do this even when the rest of the card identity seems obvious.",
    "Slab label rule: if a PSA/BGS/SGC/CGC label is visible, read it first and map label lines directly into year, product, players, collector_number/checklist_code, grade_company, card_grade, grade_type, insert, variation, and auto.",
    "Never return only a year when the slab label also contains readable product, player, grade, or card number.",
    "Example slab mapping: 2018 TOPPS CHROME / SHOHEI OHTANI / 1983 TOPPS / #83T-6 / GEM MT 10 => year 2018, product Topps Chrome, players [Shohei Ohtani], insert 1983 Topps, collector_number 83T-6, grade_company PSA, card_grade 10.",
    "Example slab mapping: 2020 CONTENDERS / ANTHONY EDWARDS / VARIATION-AUTOGRAPH / #105 / GEM MT 10 => year 2020, product Contenders, players [Anthony Edwards], variation Variation Autograph, auto true, collector_number 105, grade_company PSA, card_grade 10.",
    "BGS/Beckett slab discipline: inspect the main card grade and the separate autograph grade as two different facts, including rotated/vertical side labels. The large main slab grade is card_grade; a separate AUTOGRAPH/AUTO panel is auto_grade. Render order is BGS card_grade/auto_grade. If the label shows main 9.5 and autograph 10, output card_grade 9.5 and auto_grade 10; never reverse it to BGS 10/9.5. If a visible BGS/Beckett autographed-card label has no readable AUTO/AUTOGRAPH grade, leave auto_grade empty and grade_type CARD_ONLY; never copy card_grade into auto_grade.",
    "Structured high-risk field evidence contract:",
    "- field_evidence is provider-agnostic and must be used by GPT outputs.",
    "- Keep field_evidence compact. Only include short evidence for non-empty high-risk fields or fields that may need writer review.",
    "- Do not dump OCR lines, legal text, copyright text, or repeated boilerplate into field_evidence.",
    "- Each evidence entry should include value, source_type, short visible_text/raw_text when useful, confidence, review_required, and direct_observation/directly_observed.",
    "- Core/high-risk evidence fields include year, product, set, language, players, character, card_name, official_card_type, observable_components, insert, surface_color, parallel_exact, print_run_number, print_run_denominator, numbered_to, collector_number, checklist_code, card_number, tcg_card_number, grade, rc, auto, patch, relic, jersey, sketch, and redemption.",
    "- official_card_type must stay empty unless official wording is printed on the card/slab or supplied by trusted catalog/reviewed input. Never infer Base from visual context.",
    "- observable_components may include only directly visible components: auto, patch, relic, jersey, rc, sketch, redemption.",
    "- year: include a field_evidence entry with field \"year\", value, source_type, visible_text, confidence, and review_required. Use source_type SLAB_LABEL, CARD_BACK_PRINTED_TEXT, CARD_FRONT_PRINTED_TEXT, VISION_ONLY, or NONE.",
    "- grade: include a field_evidence entry with field \"grade\" only when a slab label directly shows grade. Put grade_company/card_grade/auto_grade/grade_type in fields, and put source_type SLAB_LABEL, visible_text, confidence, review_required false in the evidence entry. For BGS/Beckett labels, visible_text should include the separate AUTO/AUTOGRAPH grade line when it is readable. If grade is only guessed, leave grade fields empty.",
    "- rc: fields.rc may be true only with a visible RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, or slab/card text. Also include a field_evidence entry with field \"rc\", value true, source_type, evidence_kind, visible_text, confidence, and directly_observed true.",
    "- auto: fields.auto may be true only with visible Auto/Autograph/Signature/Signed text or an actual visible signature. Also include a field_evidence entry with field \"auto\", value true, source_type, evidence_kind, visible_text, confidence, and directly_observed true.",
    "- If year is visible but only from visual model reading, still return fields.year and a field_evidence entry for year with source_type VISION_ONLY; Gate will leave it for writer review.",
    "If readable slab/card text exists but you leave year, product, or players empty, add a short unresolved note naming the missing field and image region. Do not transcribe long text, legal lines, copyright lines, or repeated boilerplate.",
    "Numbered / Numerical Rarity evidence rule: values such as 2/3, 14/99, 31/50, 01/10, #/50, and 1/1 are current-card limited-numbering evidence for the CSM field Numerical Rarity, not checklist/card numbers. Search the full card face and slab area for small foil numbering such as top-left, top-center, lower edge, or autograph-window numbering before leaving it empty. Use implementation fields print_run_number, print_run_numerator, print_run_denominator, and numbered_to to carry the evidence. Fill the full numerator only when current uploaded card/slab/OCR evidence directly shows it. If only the denominator is known, use print_run_number #/D and leave print_run_numerator empty. Use one_of_one true for 1/1. serial_number is a legacy compatibility alias, not a CSM field. Never copy a print-run numerator from catalog/vector/reference/marketplace candidates, and never move limited numbering into collector_number, checklist_code, card_number, or tcg_card_number.",
    "Parallel/color rule: first-version output is color-first. Put visible Gold/Purple/Red/Blue/Green/Silver/Black/Orange only in surface_color. Leave parallel_exact empty unless exact wording is printed/slab/catalog-supported; do not infer Refractor/Wave/Shimmer/Mojo/Prizm/Sparkle/Holo from appearance alone.",
    "Sapphire discipline: Topps Chrome Sapphire or Bowman Chrome Sapphire is a product/set phrase when visibly attached to the Chrome product line; keep the full phrase in product or set. Non-product Sapphire such as Heir Apparent Sapphire is exact parallel/taxonomy wording and must stay out of final fields unless catalog/printed label evidence directly supports it.",
    "Open-set taxonomy rule: without prompt-safe catalog/vector candidates, do not put Tiger, Zebra, Sapphire, Refractor, Wave, Shimmer, Mojo, Prizm, Sparkle, Holo, or similar optical pattern words in insert/card_type/parallel fields; leave them unresolved for writer/catalog confirmation.",
    "Lot / multi-card rule: multi_card/card_count refer to separate physical cards in the photo, not the number of players or names printed on one card. A single card with two or more subjects must keep multi_card false and put every subject in players[]. When a listing is visibly a lot or multiple separate cards, set multi_card true, fill card_count when visible, keep up to three recognizable subjects, and fill common year/product/set only if shared or clearly visible. Do not merge different identities into one single-card identity; renderer will use Linear SEM Lot grammar. Use ABSTAIN only when the lot itself is unreadable or mixed beyond a usable draft.",
    "recognition_status rule: use CONFIRMED when core identity is visible with no critical conflict; RESOLVED when core identity is visible but some non-core field needs review; ABSTAIN only when product/subject is unreadable, multiple cards are mixed, image quality blocks core identity, or critical fields conflict.",
    `Runtime title limit downstream: ${maxTitleLength} characters.`,
    "Return this shape:",
    JSON.stringify(providerMinimalOutputShape({ includeVectorDecision: Boolean(vectorPacket) })),
    vectorCandidatePromptSection(vectorPacket),
    "Asset context:",
    JSON.stringify({
      assetId: payload.assetId || null,
      mode: payload.mode || null,
      imageCount: payload.images.length,
      fileNames: payload.images.map((image) => image.name).filter(Boolean).slice(0, 2)
    }),
    l1FastScoutHintPromptSection(payload)
  ].join("\n");
}

export function compactV4L2RecognitionPrompt(payload, maxTitleLength) {
  const vectorPacket = payload.vectorCandidatePacket || payload.vector_candidate_packet || null;
  return [
    "You are LYNCA Listing Copilot L2 final evidence reader.",
    "Use only the uploaded card/slab images, internal L1 scout context, and prompt-safe catalog/vector support. Seller titles and marketplace wording are not evidence.",
    "Return compact valid JSON only. Deterministic code renders the final English one-line title.",
    "L2 job: confirm, correct, and complete L1. Do not restart with broad prose. Current image/slab/card printed text overrides L1 and every candidate.",
    "Required Linear SEM canonical output order downstream: Standard = Year -> smart Manufacturer/Product/Set -> Subject -> Card Name -> Release Variant -> Print Finish -> Numerical Rarity -> Descriptive Rarity -> Card Number -> SO -> Grading Info. TCG = Year -> IP -> Language -> smart Manufacturer/Product/Set -> Subject -> Card Name -> Card Number -> Rarity -> Variant/Finish/Stamp -> Grading/SO.",
    "Smart compose: keep manufacturer/product/set separate for storage but avoid repeated title words. Keep card_name/release_variant/print_finish separate for learning but do not duplicate the same term across them.",
    "Release Variant means layout/design-direction differences only: Horizontal, Vertical, Variation, Photo Variation, Image Variation, Design Variation, International. Never put FOTL, Hobby, Retail, Choice, Fast Break, Sapphire, color, foil, holo, refractor, rarity, product, or set into Release Variant.",
    "Product/set/card-name preservation: visible product/set/card-name words such as Encased, Status, Prizm, Bowman Chrome, National Treasures, Eminence, New Breed, Spotlight, Gusto, Best Performance, Rookie Ticket, Patch Auto, Signatures, NFL Shield, Logoman, Laundry Tag, and Platinum Bar must not disappear merely because serial/grade/parallel is uncertain.",
    "Subject/card-name separation: never repeat the player/subject inside card_name. Keep the subject in players[] and keep card_name to the card-title component only. Do not leak raw internal shorthand such as BWM PROS MEGA AU-BLACK into product/card_name when a human-readable component is available.",
    "Hard-text scan order: before finalizing identity, inspect slab label, card front limited-numbering, card back code/product text, card number/code, and grade/autograph label areas. This is mandatory for GPT-5-mini because small text mistakes are more costly than title style differences.",
    "Numerical Rarity evidence: 2/3, 14/99, 31/50, #/50, and 1/1 are limited-numbering evidence for the CSM field Numerical Rarity. Store the evidence in print_run_number / print_run_denominator fields for compatibility. Search the card face and slab for small foil numbering such as top-left, top-center, lower edge, or autograph-window numbering before leaving it empty. Preserve visible full numerator/denominator from the current image. If only denominator is supported, use #/D. Do not treat limited numbering as collector_number/checklist_code/card_number/tcg_card_number.",
    "Card number/code: PAU, NB-TYG, S-P, #256, 201/165, TAEV-EN006 are identity card numbers/codes. Include them when visible and title space allows; they are lower priority than core identity and numerical rarity for Standard cards, high priority for TCG.",
    "Grade: fill grade_company/card_grade/auto_grade only from a visible slab label. BGS card grade and auto grade are separate facts. Read rotated/vertical BGS side labels. The large main grade is card_grade; the separate AUTOGRAPH/AUTO panel is auto_grade. Title order is BGS card_grade/auto_grade, so visible main 9.5 plus autograph 10 must become BGS 9.5/10, never BGS 10/9.5.",
    "RC/Auto/Patch: set true only from visible logo/text/signature/material evidence or slab/card text. Do not infer rookie or auto from year/player alone.",
    "Color/parallel safety: visual Gold/Purple/Red/Blue/Green/Silver/Black/Orange may be surface_color. Exact optical parallel words such as Refractor, Wave, Shimmer, Mojo, Prizm, Sparkle, Holo, Tiger, Sapphire need printed/slab/catalog support or strong current-image evidence plus compatible product context.",
    "TCG discipline: Subject is the character/card subject, Card Name is the printed card-title segment. Example Pikachu Illustrator => subject=Pikachu, card_name=Illustrator.",
    "Multi-card: multiple separate physical cards make a Lot. Multiple subjects on one card stay one identity with players[].",
    "Catalog/vector support boundary: prompt-safe catalog/vector candidates are evidence candidates only. They become trusted support only when current-image anchors agree and no direct conflict exists. Never copy catalog/reference serial numerator, grade, cert, or unsupported exact parallel.",
    "Field evidence: keep field_evidence short and only for non-empty high-risk/review-sensitive fields. Do not transcribe boilerplate or long OCR text.",
    "If a high-risk field is unreadable, leave it empty and add the field name to unresolved. Do not guess.",
    `Runtime title limit downstream: ${maxTitleLength} characters.`,
    "Internal context and current asset:",
    JSON.stringify({
      assetId: payload.assetId || payload.asset_id || null,
      mode: payload.mode || null,
      imageCount: Array.isArray(payload.images) ? payload.images.length : 0,
      fileNames: (payload.images || []).map((image) => image.name).filter(Boolean).slice(0, 2),
      captureQuality: captureQualityForPayload(payload)
    }),
    l1FastScoutHintPromptSection(payload),
    "Required JSON shape:",
    JSON.stringify(providerMinimalOutputShape({ includeVectorDecision: Boolean(vectorPacket) })),
    vectorCandidatePromptSection(vectorPacket)
  ].join("\n");
}

export function providerMinimalOutputShape({
  includeVectorDecision = false
} = {}) {
  const shape = {
    recognition_status: "CONFIRMED | RESOLVED | ABSTAIN",
    fields: {
      year: "",
      manufacturer: "",
      brand: "",
      product: "",
      set: "",
      language: "",
      players: [],
      card_name: "",
      card_type: "",
      official_card_type: "",
      observable_components: [],
      insert: "",
      surface_color: "",
      parallel_exact: "",
      print_run_number: "",
      print_run_numerator: "",
      print_run_denominator: "",
      numbered_to: "",
      serial_number: "",
      numerical_rarity: "",
      card_number: "",
      tcg_card_number: "",
      collector_number: "",
      checklist_code: "",
      grade_company: "",
      card_grade: "",
      auto_grade: "",
      grade_type: "",
      rc: false,
      auto: false,
      multi_card: false,
      card_count: null,
      lot_type: ""
    },
    field_evidence: [
      {
        field: "year",
        value: "",
        source_type: "SLAB_LABEL | CARD_BACK_PRINTED_TEXT | CARD_FRONT_PRINTED_TEXT | VISION_ONLY | NONE",
        source_image_id: "",
        source_region: "year_product",
        raw_text: "",
        visible_text: "",
        evidence_kind: "YEAR_TEXT",
        confidence: null,
        review_required: true,
        directly_observed: false,
        direct_observation: false
      },
      {
        field: "print_run_number",
        value: "",
        source_type: "SLAB_LABEL | CARD_FRONT_PRINTED_TEXT | CARD_BACK_PRINTED_TEXT | OCR | VISION_ONLY | NONE",
        source_image_id: "",
        source_region: "print_run_number",
        raw_text: "",
        visible_text: "",
        evidence_kind: "PRINTED_LIMITED_NUMBERING",
        confidence: null,
        review_required: true,
        directly_observed: false,
        direct_observation: false
      },
      {
        field: "serial_number",
        value: "",
        source_type: "SLAB_LABEL | CARD_FRONT_PRINTED_TEXT | CARD_BACK_PRINTED_TEXT | OCR | NONE",
        source_image_id: "",
        source_region: "legacy_serial_alias",
        raw_text: "",
        visible_text: "",
        evidence_kind: "LEGACY_SERIAL_ALIAS",
        confidence: null,
        review_required: true,
        directly_observed: false,
        direct_observation: false
      },
      {
        field: "grade",
        value: "",
        source_type: "SLAB_LABEL | OCR | NONE",
        source_image_id: "",
        source_region: "grade_label",
        raw_text: "",
        visible_text: "",
        evidence_kind: "GRADE_LABEL",
        confidence: null,
        review_required: false,
        directly_observed: false,
        direct_observation: false
      },
      {
        field: "rc",
        value: false,
        source_type: "SLAB_LABEL | CARD_FRONT_PRINTED_TEXT | CARD_BACK_PRINTED_TEXT | VISION_ONLY | NONE",
        source_image_id: "",
        source_region: "rc_marker",
        raw_text: "",
        visible_text: "",
        evidence_kind: "RC_MARKER",
        confidence: null,
        review_required: true,
        directly_observed: false,
        direct_observation: false
      },
      {
        field: "auto",
        value: false,
        source_type: "SLAB_LABEL | CARD_FRONT_PRINTED_TEXT | CARD_BACK_PRINTED_TEXT | VISIBLE_SIGNATURE | VISION_ONLY | NONE",
        source_image_id: "",
        source_region: "autograph",
        raw_text: "",
        visible_text: "",
        evidence_kind: "AUTO_EVIDENCE",
        confidence: null,
        review_required: true,
        directly_observed: false,
        direct_observation: false
      }
    ],
    unresolved: []
  };
  if (includeVectorDecision) {
    shape.vector_candidate_decision = {
      selected_candidate_id: null,
      decision: "SELECTED | PARTIAL_SUPPORT | REJECTED_ALL | NOT_AVAILABLE",
      supported_fields: [],
      rejected_fields: [],
      conflicts: []
    };
  }
  return shape;
}

export function vectorCandidatePromptSection(packet = null) {
  if (!packet?.vector_retrieval) return "";
  const fieldSupport = Array.isArray(packet.vector_retrieval.field_support)
    ? packet.vector_retrieval.field_support
    : [];
  const compactPacket = JSON.stringify(packet);
  return [
    "Vector Candidate Packet:",
    compactPacket,
    "Vector candidate policy:",
    "- Treat vector candidates as hypotheses only, never as ground truth.",
    "- Field support rows are not identity candidates. They are approved/internal/official vocabulary or legality support only.",
    "- Use a field support value only when the same field is visible or otherwise supported in the current uploaded images.",
    "- Never use marketplace seller titles, reference serial numerators, reference grade, or reference cert numbers as current-card facts.",
    "- First read all current uploaded card images and crops in upload order.",
    "- Do not decide, swap, or report front/back side labels; the system treats paired images as same-card evidence only.",
    "- You may select one candidate, partially use field support, reject all candidates, or return NOT_AVAILABLE.",
    "- Reject any candidate field that conflicts with current card/slab printed text, current serial, current collector/checklist code, current grade label, or current subject count.",
    "- Print-run numerator and grade must come only from the current card/slab image, never from a reference candidate. Reference candidates may support only the denominator/numbered_to.",
    "- Exact parallel requires current image evidence, printed/slab text, product taxonomy, or clear denominator compatibility; visual color alone is surface_color.",
    "- Do not auto-fill unseen fields from a candidate. Leave uncertain fields empty and put the field name in unresolved.",
    `- Packet field_support_count=${fieldSupport.length}. If there are no identity candidates but field support exists, use PARTIAL_SUPPORT only for verified fields.`,
    "- Populate vector_candidate_decision with supported_fields, rejected_fields, and conflicts. Use NOT_AVAILABLE when the packet has no candidates and no field support."
  ].join("\n");
}

export async function buildListingPrompt(payload, maxTitleLength) {
  const intelligencePrompt = await loadPrompt();
  const vectorPacket = payload.vectorCandidatePacket || payload.vector_candidate_packet || null;

  return [
    intelligencePrompt,
    `Runtime title limit: ${maxTitleLength} characters.`,
    "Return only valid JSON. Do not wrap the response in Markdown.",
    "Lot / multi-card rule: fields.card_count is the count of separate physical cards, not the count of players. A single multi-subject card must have fields.multi_card false and all visible subjects in fields.players. When multiple separate card rectangles, slabs, or lot items are visible, set fields.multi_card true, include fields.card_count when visible, describe fields.lot_type, keep up to three recognizable subjects, and do not merge identities across cards. Renderer will use Lot grammar rather than a single-card title.",
    "Do not infer RC, 1st Bowman, SSP, case hit, parallel, or variation from seller style or generic foil color. Use RC only for readable RC logo, Rookie Ticket, Rated Rookie, Rookie Card, rookie marker, slab text, or card-code-backed rookie marker. For parallel/variation, use printed text, slab/checklist support, or clearly intentional high-confidence card-design color/pattern only; weak visual color impressions must stay empty with uncertainty in unresolved.",
    "Numbered / Numerical Rarity evidence rule: values such as 2/3, 14/99, 31/50, #/50, and 1/1 belong to the CSM field Numerical Rarity and are carried in print_run_number / print_run_numerator / print_run_denominator / numbered_to for implementation compatibility. serial_number is a legacy alias only. Never copy a print-run numerator from catalog/vector/reference/marketplace candidates; card_number, collector_number, checklist_code, and tcg_card_number are different printed identity codes.",
    "Return compact provider-agnostic field_evidence only for high-risk or review-sensitive fields. Do not use provider confidence prose as fact evidence.",
    "Resolution hints:",
    resolutionHints(payload.resolutionMap) || "None",
    registryPromptSummary(),
    "Asset context:",
    JSON.stringify({
      assetId: payload.assetId || null,
      mode: payload.mode || null,
      imageCount: payload.images.length,
      fileNames: payload.images.map((image) => image.name)
    }),
    "Capture quality:",
    JSON.stringify(captureQualityForPayload(payload)),
    l1FastScoutHintPromptSection(payload),
    "Required JSON shape:",
    JSON.stringify(providerMinimalOutputShape({ includeVectorDecision: Boolean(vectorPacket) })),
    vectorCandidatePromptSection(vectorPacket),
  ].join("\n");
}

export function compactL2PromptEnabled(payload = {}, env = process.env) {
  const providerOptions = providerOptionsFromPayload(payload, env);
  const stageTarget = String(
    providerOptions.v4_title_stage_target
    || payload.v4_title_stage_target
    || ""
  ).trim();
  return stageTarget === "L2_ASSISTED_DRAFT"
    && optionFlag(providerOptions, "v4_compact_l2_prompt", envFlag(env, "ENABLE_V4_COMPACT_L2_PROMPT", false)) === true;
}

export async function buildInitialProviderPrompt(payload, maxTitleLength) {
  if (compactL2PromptEnabled(payload, process.env)) {
    return compactV4L2RecognitionPrompt(payload, maxTitleLength);
  }
  if (envFlag(process.env, "ENABLE_FAST_INITIAL_PROVIDER_PROMPT", true)) {
    return fastInitialRecognitionPrompt(payload, maxTitleLength);
  }

  return buildListingPrompt(payload, maxTitleLength);
}
