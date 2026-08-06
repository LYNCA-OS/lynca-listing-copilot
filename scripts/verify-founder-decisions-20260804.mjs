#!/usr/bin/env node
// Clause-by-clause verification of the 2026-08-04 founder decisions.
//
// Written because the first pass through them missed three clauses, and the
// only reliable way to know a decision is implemented is to assert it against
// running code rather than against my memory of having read it.
//
// Every check names the decision and the clause it comes from, so a future
// change that breaks one fails with the reason attached.
import assert from "node:assert/strict";
import {
  semTcgTitleOrder, semStandardTitleOrder, semCanonicalBracket, semTcgIpLabel,
  isSemCardNumberText, classifySemNumberBoundary
} from "../csm/ontology/sem-definition.mjs";
import { csmFieldLabels } from "../csm/ontology/field-labels.mjs";
import { parseCanonicalFields } from "../lib/listing/thin/canonical-fields.mjs";
import { BRACKET_ORDER, DROP_ORDER, composeFromCanonicalFields } from "../lib/listing/thin/canonical-composer.mjs";
import { MARKETPLACE_PROFILES } from "../lib/listing/thin/marketplace-composer-rules.mjs";
import { buildCsmResolutionView } from "../csm/contracts/resolution-view.mjs";
import { routeReviewPatterns, OWNING_LAYER, CORRECTION_REASON } from "../csm/contracts/resolution-review.mjs";
import { TENANT_PERMISSIONS } from "../lib/tenant/permissions.mjs";

const results = [];
const check = (decision, clause, fn) => {
  try { fn(); results.push({ decision, clause, ok: true }); }
  catch (error) { results.push({ decision, clause, ok: false, why: error.message.split("\n")[0].slice(0, 110) }); }
};

const card = (over = {}) => ({
  year: "2025", manufacturer: "Topps", product: "Chrome", set: "", card_name: "",
  release_variant: "", surface_color: "Gold", parallel_family: "Refractor", parallel_exact: "",
  descriptive_rarity: "", subjects: ["Player"], team: "San Antonio Spurs", card_number: "150",
  serial: "17/50", attributes: ["Auto", "RC"], components: ["Auto", "RC"], grading_info: null,
  grade: "", grammar: "standard", lot_count: "", language: "", unreadable: [], low_confidence: [],
  withheld_finish_terms: [], ...over
});

// ---------------------------------------------------------------- COS-39
check("COS-39", "there is no CSM field named Product Finish", () => {
  assert.ok(!semTcgTitleOrder.includes("product_finish"));
  assert.ok(semTcgTitleOrder.includes("print_finish"));
});
check("COS-39", "the old name still resolves for stored orders", () => {
  assert.equal(semCanonicalBracket("tcg", "product_finish"), "print_finish");
});
check("COS-39", "grammar classification is validated, not assumed", () => {
  const uncorroborated = buildCsmResolutionView({
    fields: card({ grammar: "tcg" }), composed: composeFromCanonicalFields(card({ grammar: "tcg" }))
  });
  assert.equal(uncorroborated.grammar.ip_corroborated, false);
  assert.equal(uncorroborated.grammar.review_required, true);
});
check("COS-39", "Manufacturer, Product and Set stay separate canonical fields", () => {
  for (const f of ["manufacturer", "product", "set"]) assert.ok(semStandardTitleOrder.includes(f));
});
check("COS-39", "containment: Topps + Topps Chrome + Topps Chrome Update -> Topps Chrome Update", () => {
  const t = composeFromCanonicalFields(card({
    manufacturer: "Topps", product: "Topps Chrome", set: "Topps Chrome Update",
    surface_color: "", parallel_family: "", components: [], attributes: [], serial: "", card_number: ""
  })).title;
  assert.match(t, /Topps Chrome Update/);
  assert.ok(!/Topps Topps/.test(t), `mechanical concatenation: ${t}`);
});
check("COS-39", "manufacturer_product_set is not a canonical alias", () => {
  // It may translate for the Lot order, but it must not appear as a CSM field.
  assert.ok(!semStandardTitleOrder.includes("manufacturer_product_set"));
  assert.ok(!Object.keys(csmFieldLabels).includes("manufacturer_product_set"));
});

// ---------------------------------------------------------------- COS-38
check("COS-38", "TCG subset codes are Card Number", () => {
  for (const c of ["TG22/TG30", "GG01/GG70", "SV01/SV122", "086/070"]) {
    assert.ok(isSemCardNumberText(c, { grammar: "tcg", field: "card_number", checklistContext: true }), c);
  }
});
check("COS-38", "Standard 04/10 stays Numerical Rarity", () => {
  assert.equal(classifySemNumberBoundary("04/10", { grammar: "standard", field: "card_number" }).boundary,
    "NUMERICAL_RARITY");
  assert.ok(!isSemCardNumberText("TG22/TG30", { grammar: "standard", field: "card_number", checklistContext: true }));
});

// ---------------------------------------------------------------- COS-41
check("COS-41", "no Visible Components bracket in any grammar order", () => {
  for (const [g, order] of Object.entries(BRACKET_ORDER)) {
    assert.ok(!order.includes("observable_components"), `${g} still places it`);
  }
});
check("COS-41", "not declared as a CSM field label", () => {
  assert.ok(!("observable_components" in csmFieldLabels));
});
check("COS-41", "not in any drop order", () => {
  for (const [g, order] of Object.entries(DROP_ORDER)) {
    assert.ok(!order.includes("observable_components"), `${g} still ranks it`);
  }
});
check("COS-41", "Auto and RC survive the eBay profile; the team does not", () => {
  const t = composeFromCanonicalFields(card()).title;
  assert.match(t, /\bAuto\b/, `Auto missing: ${t}`);
  assert.match(t, /\bRC\b/, `RC missing: ${t}`);
  assert.ok(!/Spurs/.test(t), `team leaked: ${t}`);
});
check("COS-41", "retention is a profile policy, not a hard-coded list", () => {
  assert.ok(MARKETPLACE_PROFILES.ebay.retainWithinSuppressed?.search_optimization?.length);
});

// ---------------------------------------------------------------- COS-42
check("COS-42", "field review needs a reviewer permission writers lack", () => {
  assert.ok(TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS);
  assert.notEqual(TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS, TENANT_PERMISSIONS.EDIT_TITLE);
  assert.notEqual(TENANT_PERMISSIONS.REVIEW_SEMANTIC_FIELDS, TENANT_PERMISSIONS.SUBMIT_FEEDBACK);
});
check("COS-42", "one correction routes nowhere", () => {
  const one = routeReviewPatterns([{
    asset_id: "a", excluded_from_metrics: false,
    corrections: [{ bracket: "print_finish", reason: CORRECTION_REASON.MISSED_VALUE }]
  }]);
  assert.equal(one.routable.length, 0);
  assert.ok(one.observed_not_routable[0].withheld_reason);
});
check("COS-42", "a repeated pattern routes to the owning layer", () => {
  const many = routeReviewPatterns(["a", "b", "c"].map((id) => ({
    asset_id: id, excluded_from_metrics: false,
    corrections: [{ bracket: "print_finish", reason: CORRECTION_REASON.MISSED_VALUE }]
  })));
  assert.equal(many.routable[0].owning_layer, OWNING_LAYER.RECOGNITION_WORKER);
});
check("COS-42", "only a repeated wrong-bracket can reach a CSM proposal", () => {
  const many = routeReviewPatterns(["a", "b", "c"].map((id) => ({
    asset_id: id, excluded_from_metrics: false,
    corrections: [{ bracket: "card_name", reason: CORRECTION_REASON.WRONG_BRACKET }]
  })));
  assert.equal(many.routable[0].owning_layer, OWNING_LAYER.CSM_BOUNDARY_PROPOSAL);
});
check("COS-39", "finish validation is product-scoped and runs first", () => {
  // The decision's named case: "This boundary should prevent a Pokémon /
  // Charizard card from receiving inappropriate Non-TCG finish wording such as
  // Gold Refractor or Silver Refractor."
  //
  // Two things had to be true for it to fire at all. Classification has to
  // precede the finish admission -- it ran forty lines after, so the admission
  // layer read a grammar nothing had assigned yet. And the check has to precede
  // the `parallel_exact` early return, because the decision's own example is a
  // printed name.
  const charizard = parseCanonicalFields(JSON.stringify({
    grammar: "tcg", manufacturer: "Pokémon", product: "SWSH",
    subjects: ["Charizard"], parallel_exact: "Gold Refractor"
  })).fields;
  assert.equal(charizard.print_finish, "", "a Charizard must not carry Gold Refractor");
  assert.ok(charizard.withheld_finish_terms.some((w) => w.reason === "FINISH_NOT_MARKET_RECOGNIZED_FOR_PRODUCT"),
    "withheld on the product taxonomy, which is the authority CSM names");

  // TCG-appropriate wording is untouched, and NON_TCG grammar is untouched.
  assert.equal(parseCanonicalFields(JSON.stringify({
    grammar: "tcg", manufacturer: "Pokémon", product: "Mega Brave",
    subjects: ["Absol"], parallel_family: "Holo"
  })).fields.print_finish, "Holo");
  assert.equal(parseCanonicalFields(JSON.stringify({
    grammar: "standard", subjects: ["X"], parallel_exact: "Gold Refractor"
  })).fields.print_finish, "Gold Refractor");

  // PRODUCT taxonomy, not grammar. CSM says so in three places, and 60 Rebuild
  // Contract adds the reason the earlier gate was wrong: "TCG / Non-TCG is a
  // grammar choice, NOT an IP-level claim". A finish is withheld only when the
  // Registry positively knows the term belongs to a different product family.
  const disney = parseCanonicalFields(JSON.stringify({
    grammar: "tcg", manufacturer: "Topps", product: "Topps Chrome",
    subjects: ["Elsa"], surface_color: "Blue", parallel_family: "Refractor"
  })).fields;
  assert.equal(disney.print_finish, "Blue Refractor",
    "Refractor is market-recognized for a Topps Chrome product, whatever its grammar");

  const paniniForeign = parseCanonicalFields(JSON.stringify({
    grammar: "standard", manufacturer: "Panini", product: "Prizm",
    subjects: ["X"], parallel_family: "Refractor"
  })).fields;
  assert.equal(paniniForeign.print_finish, "",
    "the boundary is the product, so it bites on a NON_TCG card too");

  const unknown = parseCanonicalFields(JSON.stringify({
    grammar: "standard", subjects: ["X"], parallel_family: "Refractor"
  })).fields;
  assert.equal(unknown.print_finish, "Refractor",
    "Registry supports resolution; absence of knowledge is not rejection");
});
check("COS-39", "the IP table is fed the manufacturer it already reads", () => {
  // `semResolvedClassificationText` reads manufacturer, and every call site
  // dropped it. That is why the table looked silent on cards that are
  // unmistakably Pokemon: they carry `manufacturer: "Pokémon"` beside an empty
  // or product-shaped `product`.
  const pokemon = parseCanonicalFields(JSON.stringify({
    grammar: "tcg", manufacturer: "Pokémon", product: "Mega Brave", subjects: ["Absol"]
  })).fields;
  assert.equal(pokemon.ip, "Pokemon");

  // And the word must appear ONCE. [IP] is a `*` bracket with [Language] pinned
  // immediately after it, while Manufacturer is `****` under TCG grammar, so
  // the redundancy is resolved against the manufacturer. Suppressing [IP]
  // instead put the word behind [Language] and broke COS-9's order.
  const title = composeFromCanonicalFields(parseCanonicalFields(JSON.stringify({
    grammar: "tcg", year: "2025", manufacturer: "Pokémon", language: "JP",
    set: "Mega Brave", subjects: ["Mega Absol ex"], card_number: "089/063"
  })).fields).title;
  assert.match(title, /^2025 Pokemon JP /, "COS-9 pins [Language] immediately after [IP]");
  assert.equal((title.match(/pok[eé]mon/gi) || []).length, 1,
    "once as [IP], and not a second time as [Manufacturer]");
});
check("COS-10", "card number is not projected; numerical rarity is", () => {
  // Decided in COS-10 and re-confirmed by Fei on 2026-08-06. Asserted here so
  // it stops being re-argued: it came back three times in one session, each
  // time as "the contract says keep it if space allows", each time answered by
  // the same measurement. The measurement is not the reason. COS-10 is.
  //
  //   "checklist identifiers ... may be omitted WHEN NOT RECOGNIZED or when
  //    title space is constrained"
  //   "Numerical Rarity ... should not be treated as optional in the same way"
  //
  // A checklist code this path cannot verify against a Registry taxonomy is
  // not a recognized one, so the eBay profile does not project it.
  assert.deepEqual(MARKETPLACE_PROFILES.ebay.suppress.card_number, ["standard", "lot"],
    "card number stays unprojected for Standard and Lot");
  assert.equal((MARKETPLACE_PROFILES.ebay.suppress.card_number || []).includes("tcg"), false,
    "TCG card numbers identify the card and must survive (COS-38)");

  const standard = composeFromCanonicalFields(parseCanonicalFields(JSON.stringify({
    grammar: "standard", year: "2024", manufacturer: "Topps", product: "Chrome",
    subjects: ["Shohei Ohtani"], card_number: "PAU-12", serial: "22/50"
  })).fields).title;
  assert.ok(!/PAU-12/.test(standard), "no checklist code in a Standard eBay title");
  assert.match(standard, /22\/50/, "the numbered copy is the number that matters");

  const tcg = composeFromCanonicalFields(parseCanonicalFields(JSON.stringify({
    grammar: "tcg", year: "2022", manufacturer: "Pokémon", language: "EN",
    subjects: ["Eternatus VMAX"], card_number: "TG22/TG30"
  })).fields).title;
  assert.match(tcg, /TG22\/TG30/, "a TCG card number identifies the card within its set");
});
check("COS-39", "Subject precedes Card Name at the writer-visible boundary", () => {
  // Fei, 2026-08-04, in a COS-39 comment that was never promoted into the issue
  // description: "Any AI-generated Listing Copilot title with both fields
  // present in the opposite order is a Marketplace Composer contract failure."
  //
  // Found by re-reading the whole CSM project rather than the issue bodies. It
  // is the one founder decision this verifier had no clause for.
  for (const grammar of ["standard", "tcg", "lot"]) {
    const composed = composeFromCanonicalFields(parseCanonicalFields(JSON.stringify({
      grammar, year: "2024", manufacturer: "Topps", product: "Chrome",
      subjects: ["Shohei Ohtani"], card_name: "Rookie Ticket",
      lot_count: grammar === "lot" ? 3 : ""
    })).fields);
    assert.equal(composed.subject_before_card_name, true, grammar);
    assert.ok(composed.title.indexOf("Shohei Ohtani") < composed.title.indexOf("Rookie Ticket"),
      `${grammar}: ${composed.title}`);
    // The same comment asks for provenance saying which source produced the
    // title, so a second one reappearing is visible rather than inferred.
    assert.equal(composed.title_render_source, "csm_marketplace_composer_v1", grammar);
  }
  for (const [grammar, order] of Object.entries(BRACKET_ORDER)) {
    const s = order.indexOf("subject");
    const n = order.indexOf("card_name");
    if (s >= 0 && n >= 0) assert.ok(s < n, `${grammar} order places Card Name first`);
  }
});
check("COS-42", "every bracket including EMPTY is exposed", () => {
  const v = buildCsmResolutionView({ fields: card({ set: "" }), composed: composeFromCanonicalFields(card({ set: "" })) });
  assert.ok(v.brackets.some((b) => b.state === "ABSENT"));
  assert.ok(v.brackets.every((b) => b.alternate_candidates.length === 0));
});

// Clauses that are NOT implemented, listed so a full green run is not read as
// a decision being finished. A verifier that only lists what it checks reports
// completeness it never measured.
const UNIMPLEMENTED = [
  {
    decision: "COS-39",
    clause: "the Print Finish Registry was seeded, not governed",
    why: [
      "The product-scoped taxonomy in `csm/registry/print-finish-taxonomy.mjs`",
      "now enforces COS-39's boundary, and its content is sourced rather than",
      "invented: `20 Registry`'s own Print Finish examples, plus the 255",
      "reviewed titles, which are the market naming its own products.",
      "",
      "What it did NOT go through is `20 Registry`'s admission process --",
      "\"governed recurring production evidence, aggregated and reviewed",
      "operator feedback, compatible official checklist evidence, or trusted",
      "domain knowledge\". One corpus is evidence; it is not governance.",
      "",
      "The design fails safe in the meantime: a term or product the table does",
      "not know is ADMITTED, never withheld, so an ungoverned table can be",
      "incomplete without deleting anything. Growing it should go through the",
      "Registry process rather than another read of the same corpus."
    ].join("\n        ")
  }
];

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? "  ✓" : "  ✗"} ${r.decision}  ${r.clause}${r.ok ? "" : `\n        ${r.why}`}`);
}
for (const item of UNIMPLEMENTED) {
  console.log(`  ⏸ ${item.decision}  ${item.clause}\n        ${item.why}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 条子句已落实，${UNIMPLEMENTED.length} 条待裁决`);
if (failed.length) process.exitCode = 1;
