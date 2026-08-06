// DIAGNOSTIC ORACLE ONLY for the manually audited downstream 53.
//
// This is deliberately NOT a promotable mechanism or production policy. Every exception is bound to
// one audited asset and may serialize only tokens already present in that
// asset's canonical fields. The overlay lets us measure the value of typed
// compaction and source-attested marketplace exceptions without globally
// restoring team, card number, or bare colour.

import { composeFromCanonicalFields } from "../../lib/listing/thin/canonical-composer.mjs";
import { MARKETPLACE_PROFILES } from "../../lib/listing/thin/marketplace-composer-rules.mjs";
import { composeWithGeneralizableDownstreamRecoveryV1 } from "./composer-downstream-generalizable-v1.mjs";

const asset = (suffix) => `reviewed_blind_${suffix}`;

export const COMPOSER_DOWNSTREAM_DIAGNOSTIC_ORACLE_ATTESTATIONS_V1 = Object.freeze({
  [asset("cd842de8c33e22b20d47")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "Spurs", targets: ["spurs"] })
  ]),
  [asset("3c690ab7d28f6c3d3e89")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "Arsenal", targets: ["arsenal"] })
  ]),
  [asset("0692862d56755fe4e863")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "Lakers", targets: ["lakers"] })
  ]),
  [asset("5edfef737b8f58f5253b")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Orange", targets: ["orange"] }),
    Object.freeze({ kind: "attested_team_exception", value: "Dodgers", targets: ["dodgers"] })
  ]),
  [asset("a12d7e8c2d623c870df4")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Blue", targets: ["blue"] })
  ]),
  [asset("410c0c9aa76e944a0cbc")]: Object.freeze([
    Object.freeze({ kind: "typed_grade_compaction", value: "PSA Auto 9", targets: ["donruss"] })
  ]),
  [asset("a0250627a306090528ce")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "Mets", targets: ["mets"] })
  ]),
  [asset("46be33ef1f2dbc0956af")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "Dodgers", targets: ["dodgers"] })
  ]),
  [asset("bcc4e7ac4ac23e1e69d3")]: Object.freeze([
    Object.freeze({
      kind: "typed_subject_compaction",
      value: ["Xavier Neyens", "Polanco", "Ryan"],
      targets: ["polanco", "ryan"]
    })
  ]),
  [asset("6d227f82fdcb2ded4b6d")]: Object.freeze([
    Object.freeze({
      kind: "typed_subject_compaction",
      value: ["Sam Petersen", "Luis Cova", "David"],
      targets: ["luis", "cova", "david"]
    })
  ]),
  [asset("098dbc6f39f5cccb43ff")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Red", targets: ["red"] })
  ]),
  [asset("f371844dc1d0c6e49f92")]: Object.freeze([
    Object.freeze({ kind: "attested_card_number_exception", value: "DF-3", targets: ["df", "3"] })
  ]),
  [asset("bc9654d83b13db44d507")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "Royals", targets: ["royals"] })
  ]),
  [asset("ba0f97b835e28571d19f")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Purple", targets: ["purple"] })
  ]),
  [asset("e90ca474692fe8f57b44")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Orange", targets: ["orange"] })
  ]),
  [asset("4aa0c1e7f7e95ed8ae49")]: Object.freeze([
    Object.freeze({
      kind: "typed_product_finish_compaction",
      product: "Chrome",
      finish: "Violet Speckle",
      targets: ["violet", "speckle"]
    })
  ]),
  [asset("e2c50c291e40a226e90e")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Gold", targets: ["gold"] })
  ]),
  [asset("b514a8918dbc221a17bd")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "Dodgers", targets: ["dodgers"] })
  ]),
  [asset("c6ecb08d49256335aa6b")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Blue", targets: ["blue"] })
  ]),
  [asset("3304222f844f985e9574")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Orange", targets: ["orange"] })
  ]),
  [asset("2cada69235bf401f2a16")]: Object.freeze([
    Object.freeze({ kind: "typed_patch_relic_compaction", targets: ["panini"] })
  ]),
  [asset("86c114c0d0e9866d56cf")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "Astros", targets: ["astros"] })
  ]),
  [asset("0dd3315a29711425e71b")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Shop", targets: ["shop"] })
  ]),
  [asset("981cde75132b2b4a3269")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Orange", targets: ["orange"] })
  ]),
  [asset("58264271a4854c4a73ed")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Green", targets: ["green"] })
  ]),
  [asset("ac56300fcdbf84e6f7d2")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "White Sox", targets: ["white", "sox"] })
  ]),
  [asset("413aa29a2561ee50f989")]: Object.freeze([
    Object.freeze({ kind: "attested_finish_exception", value: "Green", targets: ["green"] })
  ]),
  [asset("4a36645e653a8b8a8019")]: Object.freeze([
    Object.freeze({ kind: "typed_product_parent", value: "UEFA", targets: ["uefa"] })
  ]),
  [asset("8e6763a0f5c15b07ef8a")]: Object.freeze([
    Object.freeze({ kind: "attested_team_exception", value: "76ers", targets: ["76ers"] })
  ])
});

export const COMPOSER_DOWNSTREAM_DIAGNOSTIC_ORACLE_KINDS_V1 = Object.freeze([
  ...new Set(Object.values(COMPOSER_DOWNSTREAM_DIAGNOSTIC_ORACLE_ATTESTATIONS_V1)
    .flatMap((actions) => actions.map((action) => action.kind)))
]);

export const titleTokens = (value) => new Set(String(value ?? "")
  .normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[‘’ʼ]/g, "'")
  .toLowerCase().split(/[^a-z0-9/']+/).filter(Boolean));

const displayIsSourceBacked = (display, source) => {
  const available = titleTokens(source);
  return [...titleTokens(Array.isArray(display) ? display.join(" ") : display)]
    .every((token) => available.has(token));
};

const targetMissing = (action, baselineTokens) =>
  action.targets.some((token) => !baselineTokens.has(token));

const profileWithExceptions = ({ team, cardNumber }) => ({
  ...MARKETPLACE_PROFILES.ebay,
  suppress: {
    ...MARKETPLACE_PROFILES.ebay.suppress,
    ...(team ? { search_optimization: [] } : {}),
    ...(cardNumber ? { card_number: [] } : {})
  }
});

function applyAction(fields, action, state) {
  switch (action.kind) {
    case "attested_team_exception":
      if (!displayIsSourceBacked(action.value, fields.team)) return "team_source_mismatch";
      fields.team = action.value;
      state.unsuppressTeam = true;
      return null;
    case "attested_card_number_exception":
      if (String(fields.card_number ?? "").trim().toLowerCase() !== action.value.toLowerCase()) {
        return "card_number_source_mismatch";
      }
      state.unsuppressCardNumber = true;
      return null;
    case "attested_finish_exception": {
      const source = [fields.surface_color, fields.parallel_family, fields.parallel_exact, fields.print_finish].join(" ");
      if (!displayIsSourceBacked(action.value, source)) return "finish_source_mismatch";
      fields.parallel_exact = action.value;
      fields.print_finish = action.value;
      return null;
    }
    case "typed_grade_compaction":
      if (!displayIsSourceBacked(action.value, fields.grade)) return "grade_source_mismatch";
      fields.grade = action.value;
      return null;
    case "typed_subject_compaction":
      if (!displayIsSourceBacked(action.value, fields.subjects ?? [])) return "subject_source_mismatch";
      fields.subjects = [...action.value];
      return null;
    case "typed_patch_relic_compaction": {
      const components = fields.components ?? [];
      if (!components.some((value) => /^patch$/i.test(value))
        || !components.some((value) => /^relic$/i.test(value))) return "patch_relic_source_mismatch";
      fields.components = components.filter((value) => !/^relic$/i.test(value));
      return null;
    }
    case "typed_product_parent":
      if (!displayIsSourceBacked(action.value, fields.product)) return "product_source_mismatch";
      fields.product = action.value;
      return null;
    case "typed_product_finish_compaction": {
      const finishSource = [fields.surface_color, fields.parallel_family, fields.parallel_exact, fields.print_finish].join(" ");
      if (!displayIsSourceBacked(action.product, fields.product)) return "product_source_mismatch";
      if (!displayIsSourceBacked(action.finish, finishSource)) return "finish_source_mismatch";
      fields.product = action.product;
      fields.parallel_exact = action.finish;
      fields.print_finish = action.finish;
      return null;
    }
    default:
      return "unknown_action";
  }
}

export function composeWithDiagnosticOracleDownstreamRecoveryV1(assetId, sourceFields, {
  enabledMechanisms = null
} = {}) {
  const generalizable = composeWithGeneralizableDownstreamRecoveryV1(sourceFields);
  const baseline = generalizable.baseline;
  const baselineTokens = titleTokens(generalizable.candidate.title);
  const fields = structuredClone(generalizable.fields);
  const state = { unsuppressTeam: false, unsuppressCardNumber: false };
  const applied = [];
  const rejected = [];
  const enabled = enabledMechanisms ? new Set(enabledMechanisms) : null;

  for (const action of COMPOSER_DOWNSTREAM_DIAGNOSTIC_ORACLE_ATTESTATIONS_V1[assetId] ?? []) {
    if (enabled && !enabled.has(action.kind)) continue;
    if (!targetMissing(action, baselineTokens)) {
      rejected.push({ kind: action.kind, reason: "target_already_present" });
      continue;
    }
    const reason = applyAction(fields, action, state);
    if (reason) rejected.push({ kind: action.kind, reason });
    else applied.push({ kind: action.kind, targets: [...action.targets] });
  }

  const oracleCandidate = applied.length
    ? composeFromCanonicalFields(fields, {
      profile: profileWithExceptions({
        team: state.unsuppressTeam,
        cardNumber: state.unsuppressCardNumber
      })
    })
    : generalizable.candidate;

  const candidate = {
    ...oracleCandidate,
    evaluation_recovery_reasons: [
      ...generalizable.applied.map((action) => action.kind),
      ...applied.map((action) => action.kind)
    ]
  };

  return {
    baseline,
    candidate,
    generalizable,
    applied: [...generalizable.applied, ...applied],
    rejected: [...generalizable.rejected, ...rejected],
    fields
  };
}
