import assert from "node:assert/strict";
import {
  assertOfficialCatalogAdmission,
  catalogAdmissionReasonCodes,
  normalizeOfficialCatalogRows,
  validateOfficialCatalogRows
} from "../lib/listing/catalog/catalog-admission-gate.mjs";

function row({ key, set = null, players = ["Player One"], team = null, number = "1", type = null, components = [] } = {}) {
  return {
    import_status: "OFFICIAL_CHECKLIST_CANDIDATE",
    source_row_key: key,
    canonical_title: `2026 Topps Product ${set || ""} ${players[0]} #${number}`,
    identity_fields: {
      season_year: "2026",
      product: "Topps Product",
      set_or_insert: set,
      players,
      team,
      card_number: number,
      checklist_code: /[A-Z-]/.test(number) ? number : null,
      official_card_type: type,
      observable_components: components
    },
    physical_instance_fields: {},
    field_statuses: {}
  };
}

const normalized = normalizeOfficialCatalogRows([
  row({ key: "source:1", set: "Triple Autographs", players: ["Player One"], team: "Rookie", number: "TA-1" }),
  row({ key: "source:2", set: "Triple Autographs", players: ["Player Two"], number: "TA-1" }),
  row({ key: "source:3", set: "Triple Autographs", players: ["Player Three"], number: "TA-1" }),
  row({ key: "source:4", set: "Disney Ink and Paint", players: ["Mickey Mouse"], number: "I&P-1" }),
  row({ key: "source:5", set: "Rookie Patch Autographs", players: ["Player Four"], number: "RPA-1" }),
  row({ key: "source:6", set: "Combo Variations", players: ["Player Five"], number: "CV-1", components: ["red"] }),
  row({ key: "source:7", set: "Combo Variations", players: ["Player Five"], number: "CV-1", components: ["blue"] })
]);

assert.equal(normalized.rows.length, 5);
assert.equal(normalized.metrics.team_role_cleared_count, 1);
assert.equal(normalized.metrics.multi_subject_group_count, 1);
assert.equal(normalized.metrics.merged_row_count, 2);
assert.equal(normalized.metrics.autograph_semantics_enriched_count, 4);
assert.equal(normalized.metrics.relic_semantics_enriched_count, 1);
const triple = normalized.rows.find((entry) => entry.identity_fields.card_number === "TA-1");
assert.deepEqual(triple.identity_fields.players, ["Player One", "Player Two", "Player Three"]);
assert.equal(triple.identity_fields.team, null);
assert.deepEqual(triple.identity_fields.observable_components.sort(), ["auto", "rc"]);
assert.equal(triple.identity_fields.official_card_type, "Autograph");
assert.match(triple.canonical_title, /Player One \/ Player Two \/ Player Three/);
const inkAndPaint = normalized.rows.find((entry) => entry.identity_fields.card_number === "I&P-1");
assert.deepEqual(inkAndPaint.identity_fields.observable_components, []);
assert.equal(inkAndPaint.identity_fields.official_card_type, null);
const rpa = normalized.rows.find((entry) => entry.identity_fields.card_number === "RPA-1");
assert.deepEqual(rpa.identity_fields.observable_components.sort(), ["auto", "relic"]);
assert.equal(validateOfficialCatalogRows(normalized.rows).valid, true);
assert.doesNotThrow(() => assertOfficialCatalogAdmission(normalized.rows, "unit"));
const legitimateSingleSubjectDualSection = normalizeOfficialCatalogRows([
  row({ key: "single-dual-section", set: "Rookie Photo Shoot Dual Autographs", players: ["Player Six"], number: "RS-P6" })
]);
assert.equal(validateOfficialCatalogRows(legitimateSingleSubjectDualSection.rows).valid, true);

const invalid = validateOfficialCatalogRows([
  row({ key: "duplicate", set: "Dual Autographs", team: "RC", number: "DA-1" }),
  row({ key: "duplicate", set: "Dual Autographs", players: ["Player Two"], number: "DA-1" }),
  {
    ...row({ key: "physical", set: "Signature Set", players: ["Rookie"], number: "S-1" }),
    physical_instance_fields: { serial_number: "01/10" }
  }
]);
assert.equal(invalid.valid, false);
for (const reason of [
  catalogAdmissionReasonCodes.SOURCE_ROW_KEY_DUPLICATE,
  catalogAdmissionReasonCodes.PHYSICAL_INSTANCE_FIELD_PRESENT,
  catalogAdmissionReasonCodes.TEAM_ROLE_TOKEN,
  catalogAdmissionReasonCodes.SUBJECT_ROLE_TOKEN,
  catalogAdmissionReasonCodes.AUTOGRAPH_COMPONENT_MISSING,
  catalogAdmissionReasonCodes.MULTI_SUBJECT_PRINT_SPLIT
]) assert.ok(invalid.issue_counts[reason] >= 1, reason);
assert.throws(() => assertOfficialCatalogAdmission([
  row({ key: "bad", set: "Relics", components: [], number: "R-1" })
], "unit"), /RELIC_COMPONENT_MISSING/);
assert.throws(() => assertOfficialCatalogAdmission([
  {
    ...row({ key: "bad-trio", set: "Trio Autographs", players: ["Player One", "Player Two"], components: ["auto"], number: "TA-2" }),
    review_notes: "catalog_admission_multi_subject_merge:2"
  }
], "unit"), /MULTI_SUBJECT_CARDINALITY_MISMATCH/);

console.log("catalog admission gate tests passed");
