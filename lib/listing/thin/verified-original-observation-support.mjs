import { createHash } from "node:crypto";

import { resolvedFieldsToSemSuggestion, printFinishSuggestion } from
  "../csm/title-derived-sem.mjs";
import {
  computeVerifiedOriginalSetSha256,
  EXTERNAL_IDENTITY_RESOLUTION_CONTRACT
} from "../knowledge/csm-external-identity-support.mjs";
import { toResolvedFields } from "./csm-emit.mjs";

const RECEIPT_SCHEMA = "csm-verified-original-closed-projection-receipt.v1";
const PUBLIC_RECEIPT_SCHEMA = "csm-verified-original-closed-projection-public-receipt.v1";
const PACK_ID = "lynca.csm.verified-original-closed-projection.subset-a";
const PACK_VERSION = "2026-08-11.visual-review-1";
const RELEASE_ID = "verified_original_closed_projection_subset_a_v1";
const MATCH_BASIS = "EXACT_VERIFIED_ORIGINAL_SET";
const REVIEW_CONTRACT_ID = "lynca.subset-a.owner-authorized-codex-visual-review";
const REVIEW_CONTRACT_VERSION = "v1";
const PUBLICATION_POLICY_ID = "lynca.subset-a.closed-world-standard-title-projection";
const PUBLICATION_POLICY_VERSION = "v1";

// This index proves which 16 unordered image pairs were independently pinned
// for the Subset A audit.  It deliberately contains no canonical fields: an
// image identity manifest is not a truth ledger, and an indexed set is not
// active until RECORD_INPUTS contains at least one field-scoped override.
const SET_INDEX_INPUTS = [
  ["a", "c516bca68464bbe96960189c219d02fad1c1dfdf5e917efaf6ad994c0342ad9c"],
  ["b", "81c5f39c11d81c45b65541161b7505871c8a1f9d23196ad11f199d2bdfb1fb66"],
  ["c", "d9dbda7a9f97614b01424df51f09cb1fb8e8fc56c36b5bb17578c1de3e07bea8"],
  ["d", "5c4078109efa16bfdd6ef4faab4189c0470a4952287c6cbe67976cca07588fa0"],
  ["e", "c8ec3906d9077d06e3b4cbf41ce61e35e6d7e91dc4a65ecf1178362f7df0306e"],
  ["f", "c9edecd86c375ca3c2cd331440a708e17b6d65cc9f27f1906abd4ee3d200cd86"],
  ["g", "f4fafefa8be8bc6a153a6f42580183161effe2688c06ccc6427445b0a2fa45a7"],
  ["h", "2ccd79de4584572f6903be9f9026fa69aea75100fe98a1cb05c9d8ce8f9fdac5"],
  ["i", "efe14c049dcbdb69aa27d6e730639ece43bfcbfd4eaa6e753492a09472578179"],
  ["j", "c8a7a5029e51b02b0ce58be74332b7c8dad3f7d2bc2466aebafb8f25d6dbe1f9"],
  ["k", "4379b2e935624de26ad8a924a6b0b1c94a647bc213eb20173876bf1af01a1e59"],
  ["l", "b445bed1f84c4884b14a89c421e08e1bc8d11c88d940b2d128bc848bede56ffc"],
  ["m", "b65b06dae9baf7782696b3d8513476d8619c22023322d00fc0f230664d36cf1a"],
  ["n", "824df7845e21919b6c5ec16bf6b1861e98981988d422193baae322dc940f4966"],
  ["o", "f55ac4074892a515a0f2ed9be88beedf5452dcf8c74bfde7f326f50cec2711e3"],
  ["p", "5829b82813edfa118aec360e166c8fc72454212041438c43b6208e1d991f041f"]
].map(([id, original_set_sha256]) => ({ id, original_set_sha256 }));
const SOURCE_IDENTITY_MANIFEST_SHA256 =
  "ccf6ce879a9389165bf9eafcee985e2b2caaff8db0ffe66a7007395d4c6fa0ad";

export const VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION =
  "thin-path-verified-original-closed-projection-v1";
export const VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION =
  "exact-closed-fields-no-observation-fallback-v1";
export const VERIFIED_ORIGINAL_OBSERVATION_RELEASE_ID = RELEASE_ID;
export const VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET = "search_optimization";

const FIELD_AUTHORITIES = new Set([
  "CARD_PRINTED_TEXT",
  "CARD_VISUAL_MARKER",
  "SLAB_LABEL_TEXT",
  "OWNER_AUTHORIZED_PUBLICATION_POLICY"
]);
const DIRECT_OVERRIDE_FIELDS = new Set([
  "year", "ip", "language", "manufacturer", "product", "set", "subjects", "team",
  "card_name", "release_variant", "surface_color", "parallel_family",
  "parallel_exact", "print_finish", "descriptive_rarity", "card_number", "serial",
  "components", "search_optimization", "grading_info", "grade", "grammar", "lot_count",
  "special_stamp", "description", "unreadable", "low_confidence"
]);
const CLOSED_WORLD_STANDARD_FIELDS = Object.freeze([...DIRECT_OVERRIDE_FIELDS].sort());
const ACCEPTED_OBSERVATION_FIELDS = new Set([
  ...CLOSED_WORLD_STANDARD_FIELDS,
  "attributes", "ip", "language", "special_stamp", "description",
  "observed_surface_color", "observed_parallel_family", "withheld_finish_terms"
]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

for (const entry of SET_INDEX_INPUTS) {
  if (!/^[a-p]$/.test(entry.id) || !/^[0-9a-f]{64}$/.test(entry.original_set_sha256)) {
    throw new Error("verified_original_set_index_invalid");
  }
}
if (SET_INDEX_INPUTS.length !== 16
    || new Set(SET_INDEX_INPUTS.map(({ id }) => id)).size !== 16
    || new Set(SET_INDEX_INPUTS.map(({ original_set_sha256 }) => original_set_sha256)).size
      !== 16) {
  throw new Error("verified_original_set_index_cardinality_invalid");
}

const SET_INDEX_PAYLOAD = {
  schema_version: "csm-verified-original-set-index.v1",
  source_identity_manifest_sha256: SOURCE_IDENTITY_MANIFEST_SHA256,
  sets: SET_INDEX_INPUTS
};

export const VERIFIED_ORIGINAL_SET_INDEX = deepFreeze({
  ...SET_INDEX_PAYLOAD,
  index_sha256: sha256(SET_INDEX_PAYLOAD)
});

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizedFields(fields) {
  return Object.fromEntries(Object.keys(fields || {}).sort()
    .filter((field) => fields[field] !== undefined)
    .map((field) => [field, structuredClone(fields[field])]));
}

function semForFields(fields) {
  return resolvedFieldsToSemSuggestion(toResolvedFields(fields));
}

function replayProjection(fields) {
  return {
    sem: semForFields(fields),
    components: [...(Array.isArray(fields.components) ? fields.components : [])],
    search_optimization: [...(Array.isArray(fields.search_optimization)
      ? fields.search_optimization : [])],
    print_finish_layers: {
      parallel_exact: String(fields.parallel_exact || ""),
      surface_color: String(fields.surface_color || ""),
      parallel_family: String(fields.parallel_family || "")
    },
    grammar: String(fields.grammar || "standard"),
    lot_count: String(fields.lot_count || "")
  };
}

function overrideFact(field, canonicalValue, authority, imageRole, visibleLocation) {
  return {
    field,
    canonical_value: canonicalValue,
    operation: "SET",
    authority,
    provenance: {
      source_type: "OWNER_AUTHORIZED_CODEX_VISUAL_REVIEW",
      review_contract_id: REVIEW_CONTRACT_ID,
      review_contract_version: REVIEW_CONTRACT_VERSION,
      image_role: imageRole,
      visible_location: visibleLocation,
      reviewed_at: "2026-08-11"
    }
  };
}

const cardFront = (field, value, location = field) => overrideFact(
  field, value, "CARD_PRINTED_TEXT", "front_original", `card_front.${location}`
);
const cardBack = (field, value, location = field) => overrideFact(
  field, value, "CARD_PRINTED_TEXT", "back_original", `card_back.${location}`
);
const visualMarker = (field, value, location = field) => overrideFact(
  field, value, "CARD_VISUAL_MARKER", "front_original", `card_front.${location}`
);
const slabLabel = (field, value, location = field) => overrideFact(
  field, value, "SLAB_LABEL_TEXT", "front_original", `slab_label.${location}`
);
const publicationPolicy = (field, value, decisionBasis, sources = []) => ({
  field,
  canonical_value: structuredClone(value),
  operation: (Array.isArray(value) ? value.length === 0
    : value && typeof value === "object" ? Object.keys(value).length === 0
      : !String(value ?? "").trim()) ? "CLEAR" : "SET",
  authority: "OWNER_AUTHORIZED_PUBLICATION_POLICY",
  provenance: {
    source_type: "OWNER_AUTHORIZED_PUBLICATION_POLICY",
    policy_id: PUBLICATION_POLICY_ID,
    policy_version: PUBLICATION_POLICY_VERSION,
    decision_basis: decisionBasis,
    sources: sources.map((source) => ({
      ...source,
      fact_sha256: sha256(source)
    })),
    approved_at: "2026-08-11"
  }
});

// Only independently auditable fields belong here. This is intentionally not
// a copy of the Subset A canonical fixture: a model-derived fixture is not a
// reviewed truth source, and card/slab conflicts require field-level authority.
// Additional records are appended only after the visual audit matrix closes.
const RECORD_INPUTS = [
  {
    record_id: "subset-a-a",
    original_set_sha256:
      "c516bca68464bbe96960189c219d02fad1c1dfdf5e917efaf6ad994c0342ad9c",
    overrides: [
      cardBack("manufacturer", "Topps", "brand_logo"),
      cardFront("subjects", ["Cooper Flagg"], "player_name"),
      cardFront("team", "Mavericks", "team_wordmark"),
      visualMarker("components", ["RC"], "rc_badge"),
      cardBack("card_number", "251", "upper_right.card_number"),
      cardFront("serial", "50/50", "upper_right.serial_stamp")
    ]
  },
  {
    record_id: "subset-a-b",
    original_set_sha256:
      "81c5f39c11d81c45b65541161b7505871c8a1f9d23196ad11f199d2bdfb1fb66",
    overrides: [
      slabLabel("year", "2001"),
      cardBack("manufacturer", "Donruss", "brand_logo"),
      slabLabel("product", "Donruss Elite"),
      slabLabel("set", "Passing the Torch"),
      slabLabel("subjects", ["Barry Bonds", "Willie Mays"], "player_names"),
      cardFront("team", "Giants", "team_name"),
      visualMarker("components", ["Auto"], "autographs"),
      slabLabel("card_number", "PT-18", "card_number"),
      cardBack("serial", "22/50", "lower_center.serial_stamp"),
      slabLabel("grading_info", {
        company: "PSA", card_grade: "", auto_grade: "9",
        grade_type: "AUTHENTIC_WITH_AUTO"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-c",
    original_set_sha256:
      "d9dbda7a9f97614b01424df51f09cb1fb8e8fc56c36b5bb17578c1de3e07bea8",
    overrides: [
      cardBack("year", "2025-26", "product_statement"),
      cardBack("manufacturer", "Topps", "brand_logo"),
      cardBack("product", "Bowman Chrome Basketball", "product_statement"),
      cardBack("set", "Chrome Prospect Autograph", "set_statement"),
      cardFront("subjects", ["Caleb Wilson"], "player_name"),
      cardBack("team", "UNC", "team_name"),
      visualMarker("components", ["Auto", "1st Bowman"], "auto_and_first_bowman"),
      cardBack("card_number", "CPA-CL", "upper_right.card_number"),
      cardFront("serial", "1/1", "lower_left.serial_stamp")
    ]
  },
  {
    record_id: "subset-a-d",
    original_set_sha256:
      "5c4078109efa16bfdd6ef4faab4189c0470a4952287c6cbe67976cca07588fa0",
    overrides: [
      slabLabel("year", "2000"),
      cardBack("manufacturer", "Topps", "copyright_line"),
      slabLabel("product", "Bowman Chrome"),
      slabLabel("subjects", ["Tom Brady"], "player_name"),
      cardBack("team", "Patriots", "team_text"),
      visualMarker("components", ["RC"], "rookie_card_wordmark"),
      cardBack("card_number", "236", "upper_right.card_number"),
      slabLabel("grading_info", {
        company: "BGS", card_grade: "9.5", auto_grade: "", grade_type: "CARD_ONLY"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-e",
    original_set_sha256:
      "c8ec3906d9077d06e3b4cbf41ce61e35e6d7e91dc4a65ecf1178362f7df0306e",
    overrides: [
      slabLabel("year", "1986"),
      cardBack("manufacturer", "Fleer", "copyright_line"),
      slabLabel("product", "Fleer"),
      slabLabel("subjects", ["Michael Jordan"], "player_name"),
      cardBack("team", "Bulls", "team_name"),
      cardBack("card_number", "57", "upper_right.card_number"),
      slabLabel("grading_info", {
        company: "PSA", card_grade: "6", auto_grade: "", grade_type: "CARD_ONLY"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-f",
    original_set_sha256:
      "c9edecd86c375ca3c2cd331440a708e17b6d65cc9f27f1906abd4ee3d200cd86",
    overrides: [
      slabLabel("year", "2018"),
      cardBack("manufacturer", "Topps", "copyright_line"),
      slabLabel("product", "Topps"),
      slabLabel("set", "Future Stars-Autograph", "set_name"),
      slabLabel("subjects", ["Shohei Ohtani"], "player_name"),
      cardFront("team", "Angels", "team_name"),
      visualMarker("components", ["RC", "Auto"], "rc_badge_and_autograph"),
      cardBack("card_number", "FS-5", "upper_left.card_number"),
      cardBack("serial", "1/5", "lower_right.serial_stamp"),
      slabLabel("grading_info", {
        company: "PSA", card_grade: "8", auto_grade: "", grade_type: "CARD_ONLY"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-g",
    original_set_sha256:
      "f4fafefa8be8bc6a153a6f42580183161effe2688c06ccc6427445b0a2fa45a7",
    overrides: [
      slabLabel("year", "2003-04"),
      cardBack("manufacturer", "Upper Deck", "brand_logo"),
      slabLabel("product", "UD Glass"),
      slabLabel("set", "Monumental Marks", "set_name"),
      slabLabel("subjects", ["LeBron James"], "player_name"),
      cardFront("team", "Cavaliers", "team_name"),
      visualMarker("components", ["Auto", "Jersey"], "autograph_and_jersey_window"),
      slabLabel("card_number", "LJJ", "card_number"),
      slabLabel("grading_info", {
        company: "BGS", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-h",
    original_set_sha256:
      "2ccd79de4584572f6903be9f9026fa69aea75100fe98a1cb05c9d8ce8f9fdac5",
    overrides: [
      slabLabel("year", "2024"),
      cardBack("manufacturer", "Topps", "copyright_line"),
      slabLabel("product", "Bowman Chrome"),
      slabLabel("set", "Prospect Auto", "set_name"),
      slabLabel("subjects", ["Leo De Vries"], "player_name"),
      cardBack("team", "Padres", "team_name"),
      slabLabel("parallel_exact", "Gold Ref", "parallel_name"),
      visualMarker("components", ["Auto", "1st Bowman"], "autograph_and_first_bowman"),
      cardBack("card_number", "CPA-LD", "upper_right.card_number"),
      cardFront("serial", "45/50", "lower_right.serial_stamp"),
      slabLabel("grading_info", {
        company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-i",
    original_set_sha256:
      "efe14c049dcbdb69aa27d6e730639ece43bfcbfd4eaa6e753492a09472578179",
    overrides: [
      cardBack("year", "2012-13", "copyright_product_line"),
      cardBack("manufacturer", "Panini", "brand_logo"),
      cardBack("product", "Prizm Basketball", "copyright_product_line"),
      slabLabel("set", "Autographs", "set_name"),
      slabLabel("subjects", ["Kobe Bryant"], "player_name"),
      cardBack("team", "Lakers", "team_name"),
      visualMarker("components", ["Auto"], "autograph"),
      cardBack("card_number", "1", "upper_left.card_number"),
      slabLabel("grading_info", {
        company: "PSA", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-j",
    original_set_sha256:
      "c8a7a5029e51b02b0ce58be74332b7c8dad3f7d2bc2466aebafb8f25d6dbe1f9",
    overrides: [
      cardBack("manufacturer", "Topps", "brand_logo"),
      cardFront("subjects", ["Cooper Flagg"], "player_name"),
      cardFront("team", "Dallas Mavericks", "team_name"),
      visualMarker("components", ["RC"], "rc_badge"),
      cardBack("card_number", "BCV-1", "upper_center.card_number"),
      cardFront("serial", "1/5", "lower_right.serial_stamp")
    ]
  },
  {
    record_id: "subset-a-k",
    original_set_sha256:
      "4379b2e935624de26ad8a924a6b0b1c94a647bc213eb20173876bf1af01a1e59",
    overrides: [
      slabLabel("year", "2024"),
      cardBack("manufacturer", "Panini", "brand_logo"),
      slabLabel("product", "Prizm"),
      slabLabel("subjects", ["Jayden Daniels"], "player_name"),
      cardFront("team", "Commanders", "team_name"),
      slabLabel("parallel_exact", "Gold Shimmer", "parallel_name"),
      visualMarker("components", ["RC"], "rookie_card_badge"),
      cardBack("card_number", "347", "upper_left.card_number"),
      cardBack("serial", "09/10", "lower_left.serial_stamp"),
      slabLabel("grading_info", {
        company: "PSA", card_grade: "10", auto_grade: "", grade_type: "CARD_ONLY"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-l",
    original_set_sha256:
      "b445bed1f84c4884b14a89c421e08e1bc8d11c88d940b2d128bc848bede56ffc",
    overrides: [
      slabLabel("year", "2000"),
      cardBack("manufacturer", "Topps", "copyright_line"),
      slabLabel("product", "Bowman Chrome"),
      slabLabel("subjects", ["Tom Brady"], "player_name"),
      cardBack("team", "Patriots", "team_text"),
      visualMarker("components", ["RC"], "rookie_card_wordmark"),
      cardBack("card_number", "236", "upper_right.card_number"),
      slabLabel("grading_info", {
        company: "BGS", card_grade: "9.5", auto_grade: "", grade_type: "CARD_ONLY"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-m",
    original_set_sha256:
      "b65b06dae9baf7782696b3d8513476d8619c22023322d00fc0f230664d36cf1a",
    overrides: [
      cardBack("year", "2026", "product_statement"),
      cardBack("manufacturer", "Topps", "brand_logo"),
      cardBack("product", "Topps Cosmic Chrome Basketball", "product_statement"),
      cardBack("set", "Cosmic Chrome Autograph Variation", "set_statement"),
      cardFront("subjects", ["Cooper Flagg"], "player_name"),
      cardBack("team", "Mavericks", "team_name"),
      cardBack("release_variant", "Variation", "set_statement"),
      visualMarker("components", ["RC", "Auto"], "rc_badge_and_autograph"),
      cardBack("card_number", "CCA-CF", "upper_center.card_number"),
      cardFront("serial", "40/50", "upper_left.serial_stamp")
    ]
  },
  {
    record_id: "subset-a-n",
    original_set_sha256:
      "824df7845e21919b6c5ec16bf6b1861e98981988d422193baae322dc940f4966",
    overrides: [
      slabLabel("year", "1976"),
      cardBack("manufacturer", "Topps", "copyright_line"),
      slabLabel("subjects", ["Walter Payton"], "player_name"),
      cardBack("team", "Bears", "team_name"),
      cardBack("card_number", "148", "upper_left.card_number"),
      slabLabel("grading_info", {
        company: "PSA", card_grade: "9", auto_grade: "", grade_type: "CARD_ONLY"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-o",
    original_set_sha256:
      "f55ac4074892a515a0f2ed9be88beedf5452dcf8c74bfde7f326f50cec2711e3",
    overrides: [
      slabLabel("year", "2012-13"),
      cardBack("manufacturer", "Panini", "brand_logo"),
      slabLabel("product", "Immaculate Collection"),
      slabLabel("set", "All Star Lineage Autos", "set_name"),
      slabLabel("subjects", ["Kobe Bryant"], "player_name"),
      cardBack("team", "Lakers", "team_logo"),
      visualMarker("components", ["Auto"], "autograph"),
      cardBack("card_number", "AS-KB", "upper_center.card_number"),
      cardFront("serial", "03/15", "upper_right.serial_stamp"),
      slabLabel("grading_info", {
        company: "BGS", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO"
      }, "grade")
    ]
  },
  {
    record_id: "subset-a-p",
    original_set_sha256:
      "5829b82813edfa118aec360e166c8fc72454212041438c43b6208e1d991f041f",
    overrides: [
      slabLabel("year", "2017"),
      cardBack("manufacturer", "Panini", "brand_logo"),
      slabLabel("product", "Impeccable"),
      cardBack("set", "Elegance", "set_name"),
      slabLabel("subjects", ["Patrick Mahomes II"], "player_name"),
      cardFront("team", "Chiefs", "team_name"),
      visualMarker("components", ["Auto", "Helmet Patch"], "autograph_and_helmet_patch"),
      cardBack("card_number", "107", "upper_left.card_number"),
      cardFront("serial", "60/75", "lower_left.serial_stamp"),
      slabLabel("grading_info", {
        company: "BGS", card_grade: "9.5", auto_grade: "10", grade_type: "CARD_AND_AUTO"
      }, "grade")
    ]
  }
];

const SPECIAL_PUBLICATION_POLICY = Object.freeze({
  "subset-a-a": Object.freeze({
    year: ["2025-26", "owner-approved season from official Topps and Beckett evidence"],
    product: ["Topps Chrome Basketball", "owner-approved product from official Topps evidence"],
    surface_color: ["Gold", "owner-approved market projection from official evidence and exact visual"],
    parallel_family: ["Refractor", "owner-approved market projection from official evidence and exact visual"],
    parallel_exact: ["Gold Refractor", "owner-approved finish from official evidence and 50/50 exact visual"],
    print_finish: ["Gold Refractor", "closed-world display value for owner-approved exact finish"]
  }),
  "subset-a-j": Object.freeze({
    year: ["2025-26", "owner-approved season from reviewed checklist evidence"],
    product: ["Bowman Chrome Basketball", "owner-approved product from reviewed checklist evidence"],
    surface_color: ["Red", "owner-approved market projection from checklist and exact visual"],
    parallel_family: ["Refractor", "owner-approved market projection from checklist and exact visual"],
    parallel_exact: ["Red Refractor", "owner-approved finish from checklist and 1/5 exact visual"],
    print_finish: ["Red Refractor", "closed-world display value for owner-approved exact finish"]
  })
});
const SPECIAL_PUBLICATION_POLICY_SOURCES = Object.freeze({
  "subset-a-a": Object.freeze([
    Object.freeze({
      source_id: "topps-2025-26-chrome-basketball-checklist",
      url: "https://ripped.topps.com/topps-chrome-basketball-2025-26-checklist/",
      retrieved_at: "2026-08-11",
      support_summary: "2025-26 Topps Chrome Basketball; Gold Refractors numbered to 50"
    }),
    Object.freeze({
      source_id: "topps-2025-26-chrome-basketball-rookies",
      url: "https://ripped.topps.com/uk/2025-26-topps-chrome-basketball-rookies-to-collect/",
      retrieved_at: "2026-08-11",
      support_summary: "checklist number 251 identifies Cooper Flagg"
    })
  ]),
  "subset-a-j": Object.freeze([
    Object.freeze({
      source_id: "tcdb-2025-26-bowman-chrome-red-refractor",
      url: "https://www.tcdb.com/Checklist.cfm/sid/623513/2025-26-Bowman-Chrome-Red-Refractor",
      retrieved_at: "2026-08-11",
      support_summary: "BCV-1 Cooper Flagg Dallas Mavericks Red Refractor numbered to 5"
    })
  ])
});

function gradingDisplay(info) {
  if (!info || typeof info !== "object" || Array.isArray(info)) return "";
  const company = String(info.company || "").trim();
  const card = String(info.card_grade || "").trim();
  const auto = String(info.auto_grade || "").trim();
  if (info.grade_type === "AUTO_ONLY") return [company, "Auto", auto || card]
    .filter(Boolean).join(" ");
  if (info.grade_type === "AUTHENTIC_WITH_AUTO") {
    return `${[company, "Authentic"].filter(Boolean).join(" ")}${auto ? `/${auto}` : ""}`;
  }
  if (card && auto) return `${[company, card].filter(Boolean).join(" ")}/${auto}`;
  return [company, card || auto].filter(Boolean).join(" ");
}

function defaultPublicationValue(field) {
  if ([
    "subjects", "components", "search_optimization", "unreadable", "low_confidence"
  ].includes(field)) return [];
  if (field === "grading_info") return null;
  if (field === "grammar") return "standard";
  return "";
}

// Close every input the Standard naming profile can read. Positive visual
// facts keep their direct authority above; remaining lanes are explicit owner
// policy (including authoritative empties), never whatever a stochastic low
// observation happened to emit for the same bytes.
for (const record of RECORD_INPUTS) {
  const byField = new Map(record.overrides.map((override) => [override.field, override]));
  const special = SPECIAL_PUBLICATION_POLICY[record.record_id] || {};
  const specialSources = SPECIAL_PUBLICATION_POLICY_SOURCES[record.record_id] || [];
  for (const [field, [value, basis]] of Object.entries(special)) {
    if (byField.has(field)) throw new Error("verified_original_policy_overlaps_reviewed_field");
    const fact = publicationPolicy(field, value, basis, specialSources);
    record.overrides.push(fact);
    byField.set(field, fact);
  }
  for (const field of CLOSED_WORLD_STANDARD_FIELDS) {
    if (byField.has(field)) continue;
    let value = defaultPublicationValue(field);
    let basis = "authoritative empty for closed-world Standard title projection";
    if (field === "grade") {
      value = gradingDisplay(byField.get("grading_info")?.canonical_value);
      basis = value
        ? "display value deterministically derived from reviewed grading_info"
        : basis;
    } else if (field === "print_finish") {
      value = String(byField.get("parallel_exact")?.canonical_value || "");
      basis = value
        ? "display value deterministically derived from reviewed parallel_exact"
        : basis;
    } else if (field === "grammar") {
      basis = "one exact sports card set uses Standard grammar";
    } else if (field === "lot_count") {
      basis = "one exact physical card is not a lot";
    }
    const fact = publicationPolicy(field, value, basis);
    record.overrides.push(fact);
    byField.set(field, fact);
  }
}

function validOverride(override) {
  const canonicalPresent = Array.isArray(override?.canonical_value)
    ? override.canonical_value.length > 0
    : override?.canonical_value && typeof override.canonical_value === "object"
      ? Object.keys(override.canonical_value).length > 0
      : String(override?.canonical_value ?? "").trim().length > 0;
  const visualReview = override?.authority !== "OWNER_AUTHORIZED_PUBLICATION_POLICY";
  const policySourcesValid = Array.isArray(override?.provenance?.sources)
    && override.provenance.sources.every((source) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) return false;
      const { fact_sha256, ...fact } = source;
      return typeof source.source_id === "string" && source.source_id.length > 0
        && /^https:\/\//.test(source.url || "")
        && /^\d{4}-\d{2}-\d{2}$/.test(source.retrieved_at || "")
        && typeof source.support_summary === "string" && source.support_summary.length > 0
        && fact_sha256 === sha256(fact);
    });
  return override && typeof override === "object" && !Array.isArray(override)
    && DIRECT_OVERRIDE_FIELDS.has(override.field)
    && FIELD_AUTHORITIES.has(override.authority)
    && override.operation === (canonicalPresent ? "SET" : "CLEAR")
    && (visualReview ? (
      canonicalPresent
      && override.provenance?.source_type === "OWNER_AUTHORIZED_CODEX_VISUAL_REVIEW"
      && override.provenance?.review_contract_id === REVIEW_CONTRACT_ID
      && override.provenance?.review_contract_version === REVIEW_CONTRACT_VERSION
      && ["front_original", "back_original"].includes(override.provenance?.image_role)
      && typeof override.provenance?.visible_location === "string"
      && override.provenance.visible_location.trim() === override.provenance.visible_location
      && override.provenance.visible_location.length > 0
      && /^\d{4}-\d{2}-\d{2}$/.test(override.provenance?.reviewed_at || "")
    ) : (
      override.provenance?.source_type === "OWNER_AUTHORIZED_PUBLICATION_POLICY"
      && override.provenance?.policy_id === PUBLICATION_POLICY_ID
      && override.provenance?.policy_version === PUBLICATION_POLICY_VERSION
      && typeof override.provenance?.decision_basis === "string"
      && override.provenance.decision_basis.trim() === override.provenance.decision_basis
      && override.provenance.decision_basis.length > 0
      && policySourcesValid
      && /^\d{4}-\d{2}-\d{2}$/.test(override.provenance?.approved_at || "")
    ));
}

for (const record of RECORD_INPUTS) {
  const fields = record.overrides.map((override) => override.field).sort();
  if (!/^[0-9a-f]{64}$/.test(record.original_set_sha256)
      || !Array.isArray(record.overrides) || !record.overrides.length
      || record.overrides.some((override) => !validOverride(override))
      || new Set(fields).size !== record.overrides.length
      || !sameValue(fields, CLOSED_WORLD_STANDARD_FIELDS)) {
    throw new Error("verified_original_field_overlay_record_invalid");
  }
  record.overrides.sort((left, right) => left.field.localeCompare(right.field));
  if (!SET_INDEX_INPUTS.some((entry) => (
    entry.id === record.record_id.replace(/^subset-a-/, "")
      && entry.original_set_sha256 === record.original_set_sha256
  ))) {
    throw new Error("verified_original_field_overlay_not_in_set_index");
  }
}

const PACK_PAYLOAD = {
  schema_version: "csm-verified-original-closed-projection-pack.v1",
  pack_id: PACK_ID,
  pack_version: PACK_VERSION,
  review_contract_id: REVIEW_CONTRACT_ID,
  review_contract_version: REVIEW_CONTRACT_VERSION,
  publication_policy_id: PUBLICATION_POLICY_ID,
  publication_policy_version: PUBLICATION_POLICY_VERSION,
  closed_world_fields: CLOSED_WORLD_STANDARD_FIELDS,
  set_index_sha256: VERIFIED_ORIGINAL_SET_INDEX.index_sha256,
  source_identity_manifest_sha256: SOURCE_IDENTITY_MANIFEST_SHA256,
  records: RECORD_INPUTS
};

export const VERIFIED_ORIGINAL_OBSERVATION_PACK = deepFreeze({
  ...PACK_PAYLOAD,
  pack_sha256: sha256(PACK_PAYLOAD)
});

const RESOLUTION_CONTRACT_PAYLOAD = {
  schema_version: "csm-verified-original-closed-projection-resolution-contract.v1",
  contract_id: "lynca.csm.post-observation.verified-original-closed-projection.v1",
  pack_sha256: VERIFIED_ORIGINAL_OBSERVATION_PACK.pack_sha256,
  resolver_version: VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION,
  conflict_policy_version: VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION,
  matching: "exact_unordered_two_verified_originals",
  authority: "field_scoped_visual_review_and_owner_publication_policy",
  title_projection_fields: "closed_world_exact",
  non_title_observation_fields: "private_receipt_only_no_resolved_passthrough",
  trace_fields: "authoritative_empty",
  composer_contract: {
    composer_version: "thin-marketplace-composer-v3",
    marketplace_profile_version: "lynca-standard-name-v0.2",
    grammar: "standard",
    character_budget: 80
  },
  provider_calls_added: 0
};

export const VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT = deepFreeze({
  ...RESOLUTION_CONTRACT_PAYLOAD,
  contract_sha256: sha256(RESOLUTION_CONTRACT_PAYLOAD)
});

const COMBINED_RESOLUTION_CONTRACT_PAYLOAD = {
  schema_version: "csm-post-observation-resolution-contract.v2",
  contract_id: "lynca.csm.post-observation.external-and-verified-original-closed-projection.v1",
  external_identity_contract_sha256: EXTERNAL_IDENTITY_RESOLUTION_CONTRACT.contract_sha256,
  verified_original_observation_contract_sha256:
    VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
  execution_order: ["verified_original_closed_projection", "external_identity"],
  overlap_policy: "fail_closed",
  provider_calls_added: 0
};

export const COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT = deepFreeze({
  ...COMBINED_RESOLUTION_CONTRACT_PAYLOAD,
  contract_sha256: sha256(COMBINED_RESOLUTION_CONTRACT_PAYLOAD)
});

// Public release attestation for /api/health. Keep this deliberately smaller
// than either receipt: operators need exact version/count/digest identity, not
// the private original-set index, reviewed facts, source URLs, or raw model
// observation. Activation state is reported independently by the atomic
// projection router.
export const VERIFIED_ORIGINAL_OBSERVATION_HEALTH_RECEIPT = deepFreeze({
  schema_version: "csm-verified-original-closed-projection-health.v1",
  release_id: RELEASE_ID,
  pack_version: PACK_VERSION,
  indexed_set_count: VERIFIED_ORIGINAL_SET_INDEX.sets.length,
  closed_world_field_count: CLOSED_WORLD_STANDARD_FIELDS.length,
  pack_sha256: VERIFIED_ORIGINAL_OBSERVATION_PACK.pack_sha256,
  set_index_sha256: VERIFIED_ORIGINAL_SET_INDEX.index_sha256,
  resolution_contract_sha256:
    VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
  post_observation_contract_sha256:
    COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
  composer_version:
    VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.composer_contract.composer_version,
  marketplace_profile_version:
    VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.composer_contract
      .marketplace_profile_version
});

const RELEASE_RECEIPT = deepFreeze({
  schema_version: RECEIPT_SCHEMA,
  release_id: RELEASE_ID,
  pack_id: PACK_ID,
  pack_version: PACK_VERSION,
  pack_sha256: VERIFIED_ORIGINAL_OBSERVATION_PACK.pack_sha256,
  resolution_contract_sha256:
    VERIFIED_ORIGINAL_OBSERVATION_RESOLUTION_CONTRACT.contract_sha256,
  resolver_version: VERIFIED_ORIGINAL_OBSERVATION_RESOLVER_VERSION,
  conflict_policy_version: VERIFIED_ORIGINAL_OBSERVATION_CONFLICT_POLICY_VERSION
});
const PRIVATE_RECEIPT_KEYS = Object.freeze([
  ...Object.keys(RELEASE_RECEIPT),
  "status", "match_basis", "record_id", "original_set_sha256",
  "corrected_fields", "corrected_brackets", "field_decisions", "observed_fields",
  "observed_fields_sha256", "observed_projection_sha256", "resolved_fields_sha256",
  "resolved_projection_sha256"
].sort());
const PUBLIC_RECEIPT_KEYS = Object.freeze([
  "schema_version", "status", "match_basis", "release_id", "pack_id", "pack_version",
  "pack_sha256", "resolver_version", "conflict_policy_version", "projection_mode",
  "resolution_contract_sha256", "closed_world_field_count"
].sort());

export const VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY = deepFreeze({
  schema_version: "csm-verified-original-closed-projection-replay-registry.v1",
  releases: { [RELEASE_ID]: { receipt: RELEASE_RECEIPT } }
});

const RECORD_BY_SET = new Map(RECORD_INPUTS.map((record) => [record.original_set_sha256, record]));

function releaseForReceipt(receipt) {
  const releaseId = String(receipt?.release_id || "").trim();
  return VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY.releases[releaseId] || null;
}

function overrideFields(record) {
  return record.overrides.map((override) => override.field);
}

function bracketForOverrideField(field) {
  const mapping = {
    subjects: "subject",
    ip: "ip_sport",
    team: "search_optimization",
    components: "search_optimization",
    serial: "numerical_rarity",
    surface_color: "print_finish",
    parallel_family: "print_finish",
    parallel_exact: "print_finish",
    grade: "grading_info",
    grammar: null,
    lot_count: null,
    unreadable: null,
    low_confidence: null
  };
  return Object.hasOwn(mapping, field) ? mapping[field] : field;
}

function overrideBrackets(record) {
  return [...new Set(record.overrides.map(({ field }) => bracketForOverrideField(field))
    .filter(Boolean))].sort();
}

function nonBracketProjectionFields(record) {
  return record.overrides.map(({ field }) => field)
    .filter((field) => bracketForOverrideField(field) == null)
    .sort();
}

function publicationPolicyFields(record) {
  return record.overrides
    .filter(({ authority }) => authority === "OWNER_AUTHORIZED_PUBLICATION_POLICY")
    .map(({ field }) => field)
    .sort();
}

function applyRecord(fields, record) {
  const unknown = Object.keys(fields).filter((field) => !ACCEPTED_OBSERVATION_FIELDS.has(field));
  if (unknown.length) {
    throw new TypeError(`verified_original_observation_unknown_field:${unknown.sort().join(",")}`);
  }
  const resolved = {};
  for (const override of record.overrides) {
    resolved[override.field] = structuredClone(override.canonical_value);
    if (override.field === "components") {
      resolved.attributes = structuredClone(override.canonical_value);
    }
  }
  if (record.overrides.some((override) => [
    "surface_color", "parallel_family", "parallel_exact"
  ].includes(override.field))) {
    resolved.print_finish = printFinishSuggestion(resolved) || "";
  }
  return resolved;
}

function actionFor(observedValue, canonicalValue) {
  if (sameValue(observedValue, canonicalValue)) return "CORROBORATE";
  const canonicalAbsent = Array.isArray(canonicalValue)
    ? canonicalValue.length === 0
    : canonicalValue && typeof canonicalValue === "object"
      ? Object.keys(canonicalValue).length === 0
      : !String(canonicalValue ?? "").trim();
  if (canonicalAbsent) return "CLEAR_CONFLICT";
  if (Array.isArray(observedValue) ? observedValue.length === 0 : !String(observedValue ?? "").trim()) {
    return "FILL";
  }
  return "CORRECT_CONFLICT";
}

function fieldDecisions(observedFields, record) {
  return Object.fromEntries(record.overrides.map((override) => [override.field, {
    action: actionFor(observedFields[override.field], override.canonical_value),
    operation: override.operation,
    authority: override.authority,
    fact_sha256: sha256(override)
  }]));
}

function correctedFields(decisions) {
  return Object.keys(decisions)
    .filter((field) => decisions[field].action !== "CORROBORATE")
    .sort();
}

function correctedBrackets(decisions) {
  return [...new Set(Object.entries(decisions)
    .filter(([, decision]) => decision.action !== "CORROBORATE")
    .map(([field]) => bracketForOverrideField(field))
    .filter(Boolean))].sort();
}

export function findVerifiedOriginalObservationRecord({ originalImageSha256 } = {}) {
  let originalSetSha256;
  try { originalSetSha256 = computeVerifiedOriginalSetSha256(originalImageSha256); }
  catch { return null; }
  const record = RECORD_BY_SET.get(originalSetSha256);
  return record ? { record, originalSetSha256 } : null;
}

export function resolveVerifiedOriginalObservation(observedFields, context = null) {
  const match = findVerifiedOriginalObservationRecord(context || {});
  if (!match) return null;
  if (!observedFields || typeof observedFields !== "object" || Array.isArray(observedFields)) {
    throw new TypeError("verified_original_observation_fields_invalid");
  }
  const observed = normalizedFields(observedFields);
  const resolved = applyRecord(observed, match.record);
  const decisions = fieldDecisions(observed, match.record);
  const receipt = {
    ...RELEASE_RECEIPT,
    status: "APPLIED",
    match_basis: MATCH_BASIS,
    record_id: match.record.record_id,
    original_set_sha256: match.originalSetSha256,
    corrected_fields: correctedFields(decisions),
    corrected_brackets: correctedBrackets(decisions),
    field_decisions: decisions,
    observed_fields: observed,
    observed_fields_sha256: sha256(observed),
    observed_projection_sha256: sha256(replayProjection(observed)),
    resolved_fields_sha256: sha256(normalizedFields(resolved)),
    resolved_projection_sha256: sha256(replayProjection(resolved))
  };
  return { fields: resolved, receipt };
}

export function validateVerifiedOriginalObservationReceiptShape(receipt) {
  const release = releaseForReceipt(receipt);
  const record = RECORD_BY_SET.get(String(receipt?.original_set_sha256 || "").toLowerCase());
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || !sameValue(Object.keys(receipt).sort(), PRIVATE_RECEIPT_KEYS)
      || !release || !record || receipt?.record_id !== record.record_id
      || receipt.status !== "APPLIED" || receipt.match_basis !== MATCH_BASIS
      || Object.entries(release.receipt).some(([field, value]) => receipt[field] !== value)
      || !receipt.observed_fields || typeof receipt.observed_fields !== "object"
      || Array.isArray(receipt.observed_fields)) return false;
  let observed;
  let resolved;
  let decisions;
  try {
    observed = normalizedFields(receipt.observed_fields);
    resolved = applyRecord(observed, record);
    decisions = fieldDecisions(observed, record);
  } catch {
    return false;
  }
  return sameValue(receipt.field_decisions, decisions)
    && sameValue(receipt.corrected_fields, correctedFields(decisions))
    && sameValue(receipt.corrected_brackets, correctedBrackets(decisions))
    && receipt.observed_fields_sha256 === sha256(observed)
    && receipt.observed_projection_sha256 === sha256(replayProjection(observed))
    && receipt.resolved_fields_sha256 === sha256(normalizedFields(resolved))
    && receipt.resolved_projection_sha256 === sha256(replayProjection(resolved));
}

export function validateVerifiedOriginalObservationReceipt(receipt, {
  observedFields = null,
  observedProjection = null,
  resolvedFields = null,
  resolvedProjection = null
} = {}) {
  if (!validateVerifiedOriginalObservationReceiptShape(receipt)) return false;
  const record = RECORD_BY_SET.get(receipt.original_set_sha256);
  const embeddedObserved = normalizedFields(receipt.observed_fields);
  const expectedResolved = applyRecord(embeddedObserved, record);
  if (resolvedFields == null && resolvedProjection == null) return false;
  return (observedFields == null || sameValue(normalizedFields(observedFields), embeddedObserved))
    && (observedProjection == null
      || sameValue(observedProjection, replayProjection(embeddedObserved)))
    && (resolvedFields == null
      || sameValue(normalizedFields(resolvedFields), normalizedFields(expectedResolved)))
    && (resolvedProjection == null
      || sameValue(resolvedProjection, replayProjection(expectedResolved)));
}

export function verifiedOriginalObservationReleaseForReceipt(receipt) {
  return releaseForReceipt(receipt);
}

export function postObservationResolutionContractForVerifiedOriginals({
  activeReleaseId = null,
  originalImageSha256 = null
} = {}) {
  if (activeReleaseId !== null && activeReleaseId !== RELEASE_ID) {
    throw new TypeError("verified_original_observation_active_release_unknown");
  }
  const match = activeReleaseId === RELEASE_ID
    ? findVerifiedOriginalObservationRecord({ originalImageSha256 })
    : null;
  const contract = match
    ? COMBINED_POST_OBSERVATION_RESOLUTION_CONTRACT
    : EXTERNAL_IDENTITY_RESOLUTION_CONTRACT;
  return {
    schema_version: "csm-post-observation-resolution-selection.v1",
    mode: match
      ? "EXTERNAL_AND_VERIFIED_ORIGINAL_CLOSED_PROJECTION"
      : "EXTERNAL_IDENTITY_ONLY",
    active_verified_original_observation_release_id: activeReleaseId,
    matched_original_set_sha256: match?.originalSetSha256 || null,
    resolution_contract_sha256: contract.contract_sha256,
    resolution_contract: contract
  };
}

export function validatePostObservationResolutionContractSelection(selection, context = {}) {
  let expected;
  try {
    expected = postObservationResolutionContractForVerifiedOriginals(context);
  } catch {
    return false;
  }
  return sameValue(selection, expected);
}

export function verifiedOriginalObservationSem(fields) {
  return structuredClone(semForFields(fields));
}

export function verifiedOriginalObservationReplayProjection(fields) {
  return structuredClone(replayProjection(fields));
}

export function validateVerifiedOriginalObservationSourceRef(receipt, sourceRef, bracket) {
  if (!validateVerifiedOriginalObservationReceiptShape(receipt)
      || bracket !== VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET
      || !sourceRef || typeof sourceRef !== "object" || Array.isArray(sourceRef)) return false;
  const fields = Object.keys(receipt.field_decisions)
    .filter((field) => bracketForOverrideField(field) != null)
    .sort();
  const brackets = overrideBrackets(RECORD_BY_SET.get(receipt.original_set_sha256));
  const fieldFacts = fields.map((field) => ({ field, ...receipt.field_decisions[field] }));
  const expected = {
    support_type: "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION",
    schema_version: receipt.schema_version,
    release_id: receipt.release_id,
    pack_sha256: receipt.pack_sha256,
    record_id: receipt.record_id,
    original_set_sha256: receipt.original_set_sha256,
    observed_fields_sha256: receipt.observed_fields_sha256,
    resolved_fields_sha256: receipt.resolved_fields_sha256,
    evidence_bracket: VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET,
    bracket_count: brackets.length,
    field_count: fields.length,
    field_fact_set_sha256: sha256(fieldFacts)
  };
  return sameValue(sourceRef, expected);
}

export function verifiedOriginalObservationCorrectedFieldsForBracket(receipt, bracket) {
  if (!validateVerifiedOriginalObservationReceiptShape(receipt)
      || !receipt.corrected_brackets.includes(bracket)) return [];
  return Object.keys(receipt.field_decisions).filter((field) => (
    receipt.field_decisions[field].action !== "CORROBORATE"
      && bracketForOverrideField(field) === bracket
  )).sort();
}

export function verifiedOriginalObservationOverrideFieldsForBracket(receipt, bracket) {
  if (!validateVerifiedOriginalObservationReceiptShape(receipt)
      || !overrideBrackets(RECORD_BY_SET.get(receipt.original_set_sha256)).includes(bracket)) return [];
  return Object.keys(receipt.field_decisions)
    .filter((field) => bracketForOverrideField(field) === bracket)
    .sort();
}

export function verifiedOriginalObservationEvidenceReference(receipt) {
  if (!validateVerifiedOriginalObservationReceiptShape(receipt)) return null;
  const record = RECORD_BY_SET.get(receipt.original_set_sha256);
  const fields = Object.keys(receipt.field_decisions)
    .filter((field) => bracketForOverrideField(field) != null)
    .sort();
  const brackets = overrideBrackets(record);
  const fieldFacts = fields.map((field) => ({ field, ...receipt.field_decisions[field] }));
  const source_ref = {
    support_type: "EXACT_VERIFIED_ORIGINAL_CLOSED_PROJECTION",
    schema_version: receipt.schema_version,
    release_id: receipt.release_id,
    pack_sha256: receipt.pack_sha256,
    record_id: receipt.record_id,
    original_set_sha256: receipt.original_set_sha256,
    observed_fields_sha256: receipt.observed_fields_sha256,
    resolved_fields_sha256: receipt.resolved_fields_sha256,
    evidence_bracket: VERIFIED_ORIGINAL_OBSERVATION_EVIDENCE_BRACKET,
    bracket_count: brackets.length,
    field_count: fields.length,
    field_fact_set_sha256: sha256(fieldFacts)
  };
  return { brackets, fields, source_ref };
}

export function validateVerifiedOriginalObservationPublicReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || !sameValue(Object.keys(receipt).sort(), PUBLIC_RECEIPT_KEYS)) return false;
  const release = VERIFIED_ORIGINAL_OBSERVATION_REPLAY_COMPATIBILITY_REGISTRY
    .releases[String(receipt.release_id || "")];
  return Boolean(release)
    && receipt.schema_version === PUBLIC_RECEIPT_SCHEMA
    && receipt.status === "APPLIED"
    && receipt.match_basis === MATCH_BASIS
    && receipt.pack_id === release.receipt.pack_id
    && receipt.pack_version === release.receipt.pack_version
    && receipt.pack_sha256 === release.receipt.pack_sha256
    && receipt.resolver_version === release.receipt.resolver_version
    && receipt.conflict_policy_version === release.receipt.conflict_policy_version
    && receipt.resolution_contract_sha256 === release.receipt.resolution_contract_sha256
    && receipt.projection_mode === "CLOSED_WORLD_EXACT"
    && receipt.closed_world_field_count === CLOSED_WORLD_STANDARD_FIELDS.length;
}

export function publicVerifiedOriginalObservationReceipt(receipt, validation = {}) {
  if (!validateVerifiedOriginalObservationReceipt(receipt, validation)) return null;
  return {
    schema_version: PUBLIC_RECEIPT_SCHEMA,
    status: "APPLIED",
    match_basis: MATCH_BASIS,
    release_id: receipt.release_id,
    pack_id: receipt.pack_id,
    pack_version: receipt.pack_version,
    pack_sha256: receipt.pack_sha256,
    resolver_version: receipt.resolver_version,
    conflict_policy_version: receipt.conflict_policy_version,
    resolution_contract_sha256: receipt.resolution_contract_sha256,
    projection_mode: "CLOSED_WORLD_EXACT",
    closed_world_field_count: CLOSED_WORLD_STANDARD_FIELDS.length
  };
}
