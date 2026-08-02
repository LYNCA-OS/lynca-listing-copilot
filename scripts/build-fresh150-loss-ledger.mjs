#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUTS = {
  loss_audit: "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/exhaustive-loss-audit.json",
  canonical: "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/thin-path-gpt-5.6-luna.jsonl",
  exhaustive: "artifacts/extreme-observation-2026-08-02/high-150/thin-path-gpt-5.6-luna.jsonl",
  old100_rules: "docs/evaluation/extreme-observation-high-100-loss-audit-2026-08-01.md",
  safe_bundle_replay: "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/safe-bundle-replay-150-2026-08-02.json",
  expression_overlay_replay: "artifacts/accuracy-bundle-confirmatory-150-2026-08-02/expression-overlay-v1-replay-150.json"
};
const OUTPUT_JSON = "docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.json";
const OUTPUT_MD = "docs/evaluation/fresh150-loss-ledger-255-109-63-2026-08-02.md";

const EXPECTED = {
  paired_cards: 150,
  exhaustive_not_expressed: 255,
  canonical_schema_compression: 109,
  downstream_composition: 63
};

const clean = (value) => String(value ?? "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase();
const tokens = (value) => clean(value).split(/[^a-z0-9/']+/).filter(Boolean);
const hasToken = (value, token) => tokens(value).includes(token);
const suffix = (assetId) => String(assetId).replace(/^reviewed_blind_/, "");
const itemKey = (assetId, token) => `${suffix(assetId)}:${token}`;
const abs = (path) => resolve(ROOT, path);
const readJson = (path) => JSON.parse(readFileSync(abs(path), "utf8"));
const readJsonl = (path) => readFileSync(abs(path), "utf8")
  .split("\n").filter(Boolean).map(JSON.parse);
const sha256 = (path) => createHash("sha256").update(readFileSync(abs(path))).digest("hex");

function countBy(values, selector) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    const key = selector(value);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function fieldEntries(fields = {}) {
  const ignored = new Set(["grammar", "unreadable", "low_confidence"]);
  return Object.entries(fields).flatMap(([field, value]) => {
    if (ignored.has(field) || value == null || value === "") return [];
    return (Array.isArray(value) ? value : [value])
      .filter((entry) => entry != null && String(entry) !== "")
      .map((entry, index) => ({
        field,
        index: Array.isArray(value) ? index : null,
        value: String(entry)
      }));
  });
}

function matchingFields(fields, token) {
  return fieldEntries(fields).filter((entry) => hasToken(entry.value, token));
}

const GOOD_LABELS = new Set([
  "abbreviation", "card_number", "card_type", "copyright_set_line", "emblem",
  "event", "event_logo_text", "grade", "grading_field", "insert_name", "logo",
  "name", "rarity", "rarity_code", "rookie_designation", "rookie_emblem",
  "rookie_marker", "season", "serial_form", "serial_number", "set",
  "stamped_number", "team", "team_abbreviation", "team_and_position",
  "team_logo", "year_mark"
]);
const BAD_LABEL_PARTS = [
  "biographical", "biography", "copyright", "license", "licensing", "resume",
  "statistic", "statistics", "rights", "uniform"
];

function observationScore(observation) {
  const label = clean(observation?.label);
  let score = observation?.kind === "printed_text" ? 50 : 0;
  if (observation?.region === "slab_label") score += 20;
  else if (observation?.region === "card_front") score += 12;
  else if (observation?.region === "card_back") score += 6;
  if (GOOD_LABELS.has(label)) score += 30;
  if (BAD_LABEL_PARTS.some((part) => label.includes(part))) score -= 35;
  score -= Math.min(tokens(observation?.evidence).length, 40) / 10;
  return score;
}

const OBSERVATION_SOURCE_PREFERENCE = new Map([
  ["a12d7e8c2d623c870df4:dark", { label: "player_image" }],
  ["46be33ef1f2dbc0956af:red", { label: "background_pattern" }],
  ["7059d3b39d01402f0e61:black", { label: "illustration" }],
  ["b30172f8db7f7620575f:black", { label: "background_pattern" }]
]);

function matchingObservations(row, token) {
  const preference = OBSERVATION_SOURCE_PREFERENCE.get(itemKey(row?.asset_id, token));
  return (row?.observations || [])
    .filter((observation) => hasToken(observation.evidence, token))
    .sort((a, b) => {
      const preferredA = preference && clean(a.label) === preference.label ? 1 : 0;
      const preferredB = preference && clean(b.label) === preference.label ? 1 : 0;
      return preferredB - preferredA || observationScore(b) - observationScore(a);
    });
}

function commonPhrase(reference, source, targetToken) {
  const referenceTokens = tokens(reference);
  const sourceTokens = tokens(source);
  let best = [targetToken];
  for (let start = 0; start < referenceTokens.length; start += 1) {
    for (let end = start + 1; end <= referenceTokens.length; end += 1) {
      const candidate = referenceTokens.slice(start, end);
      if (!candidate.includes(targetToken) || candidate.length <= best.length) continue;
      for (let sourceStart = 0; sourceStart + candidate.length <= sourceTokens.length; sourceStart += 1) {
        if (candidate.every((token, index) => token === sourceTokens[sourceStart + index])) {
          best = candidate;
          break;
        }
      }
    }
  }
  return best.join(" ");
}

function phraseForItem(reference, source, targetToken, sourceObservation) {
  const label = clean(sourceObservation?.label);
  if (["set", "copyright_set_line", "season", "year_mark"].includes(label) && /^\d{2}$/.test(targetToken)) {
    const referenceTokens = tokens(reference);
    const index = referenceTokens.indexOf(targetToken);
    if (index > 0 && /^(?:19|20)\d{2}$/.test(referenceTokens[index - 1])) {
      return `${referenceTokens[index - 1]} ${targetToken}`;
    }
  }
  return commonPhrase(reference, source, targetToken);
}

function bracketForField(field, grammar) {
  const mapping = {
    year: "year",
    manufacturer: grammar === "lot" ? "manufacturer_product" : "manufacturer",
    product: grammar === "lot" ? "manufacturer_product" : "product",
    set: "set",
    subjects: "subject",
    team: "search_optimization",
    card_name: "card_name",
    release_variant: "release_variant",
    surface_color: "print_finish",
    parallel_family: "print_finish",
    parallel_exact: "print_finish",
    print_finish: "print_finish",
    descriptive_rarity: "descriptive_rarity",
    card_number: "card_number",
    serial: "numerical_rarity",
    attributes: "observable_components",
    components: "observable_components",
    grade: "grading_info",
    ip: "ip",
    language: "language",
    lot_count: "lot"
  };
  return mapping[field] || field;
}

const MANUAL_SCHEMA = {
  wrong_role: new Set(`
    a12d7e8c2d623c870df4:dark cd081e3a017a5c05b5b5:horizontal
    e0962fbbfd41c6c77f55:rookie 646c3f4af20b9ee7fe07:2025
    646c3f4af20b9ee7fe07:red 64d10f8c8986aa1c9af4:rookie
    d1cc0f12cdbba0306e8b:all 0c7b873fec31df71ddb3:blue
    7059d3b39d01402f0e61:black f246b38058854d10b78a:rookie
    35540f2899f796676dcd:color 5bbc14c582d6f0b34f77:red
  `.trim().split(/\s+/)),
  synonym: new Set(`
    a78c9e94bec0ced79c29:autograph 098dbc6f39f5cccb43ff:autograph
    89cde2e9bc69a6edb4fd:autograph 34413231dd0ea69e68a4:rookie
    c279329f2f78d7f65071:rookie 12eca650b27f025d5a1c:autograph
    dbf99f2a5e722e98b87a:rookie 0184bc4079b5350adad2:autograph
    350b42505d0a78017742:autograph e5c7694ffc8faf61ee31:rookie
    17d4ec4dd5aa0af31a78:rookie
  `.trim().split(/\s+/)),
  needs_evidence: new Set(`
    b58559bf3334cd6ff54b:2026 b58559bf3334cd6ff54b:refractor
    9ef085a2c3022091aec0:tennis a0f9f2aba5a459e23140:geometric
    72e1bdac368317a7c3b1:2026 52526222b532fbef54e2:green
    46be33ef1f2dbc0956af:red 6cbe7097beee5ecb14ba:major
    6cbe7097beee5ecb14ba:league bc9654d83b13db44d507:border
    e90ca474692fe8f57b44:orange 34413231dd0ea69e68a4:red
    34413231dd0ea69e68a4:yellow 5578954f2c4a40caf3bc:red
    3304222f844f985e9574:refractor dbf99f2a5e722e98b87a:white
    c6ecb08d49256335aa6b:refractor 8945fde9c65cb1b9f3a8:gold
    04bed0401e6450349141:teal 4a36645e653a8b8a8019:red
    413aa29a2561ee50f989:tennis 659d6de445a5a7f8fdca:silver
    f584d8bfc9982bfd0246:stained f584d8bfc9982bfd0246:glass
    b30172f8db7f7620575f:black 10f650102a783e83aff4:blue
    268055e5845c6ecfcf83:2026 522dae554f642f6810eb:refractor
    0e81149eb058b3a98a15:geometric bc6cd6c49b79324c84d7:2025
    17d4ec4dd5aa0af31a78:silver c1fdabad9da739fc592f:geometric
    65efa016ae8c5a82f3fa:tennis 7815e1aeda1f8e00dd4e:veefriends
  `.trim().split(/\s+/)),
  safe_direct: new Set(`
    dfba61396ec82f2b864e:19 3c690ab7d28f6c3d3e89:fc
    3215d29874a3dad22bbb:nbl a38ced8b163264d9d95a:21
    410c0c9aa76e944a0cbc:9 72e1bdac368317a7c3b1:graphite
    52526222b532fbef54e2:47/49 f371844dc1d0c6e49f92:star
    f371844dc1d0c6e49f92:wars 46be33ef1f2dbc0956af:los
    46be33ef1f2dbc0956af:angeles 6cbe7097beee5ecb14ba:material
    940144961215fef91c18:pick 940144961215fef91c18:2
    940144961215fef91c18:027/150 bc9654d83b13db44d507:kc
    d3bcbaa288c732ffed37:082/100 12f2d135218a7ca35d3e:derby
    c279329f2f78d7f65071:19 d768c8f01fbfdd779bb0:arquette
    d768c8f01fbfdd779bb0:1st b514a8918dbc221a17bd:los
    b514a8918dbc221a17bd:angeles c6ecb08d49256335aa6b:1st
    ee03ba06dd634655b4ba:kaboom 4c8131eeda536c66d385:redemption
    4c8131eeda536c66d385:card 8922f71c190ac8dbeca8:disney
    e25ba92ef5f8fb4207a0:vmax c4905891fd0ed7eb8308:draft
    7059d3b39d01402f0e61:veefriends 89e97f6cf6442bdbc497:04/25
    1ab36981fdce86771040:disney 8cabcafd0596fbab0bb0:optic
    8cabcafd0596fbab0bb0:02/25 f246b38058854d10b78a:19
    c2b77d787bd8cd8345e3:sar b30172f8db7f7620575f:detroit
    268055e5845c6ecfcf83:new 268055e5845c6ecfcf83:york
    a4051a222e9be2cf8149:edrio
    a4051a222e9be2cf8149:two a4051a222e9be2cf8149:tubes
    4cd844c77ea0347c87da:242 274c5078fce5de006ab1:19
    274c5078fce5de006ab1:rookie 274c5078fce5de006ab1:ticket
    86990bc00f236f49430e:25 c1fdabad9da739fc592f:common
    77f1063c48c35c3d3583:05/20 1638841b99625325c7d4:08/25
    7ae66142ce80a2d06fc0:1st
  `.trim().split(/\s+/))
};

const MANUAL_DOWNSTREAM = {
  suppression: new Set(`
    0692862d56755fe4e863:lakers cd842de8c33e22b20d47:spurs
    3c690ab7d28f6c3d3e89:arsenal 5edfef737b8f58f5253b:dodgers
    a0250627a306090528ce:mets f371844dc1d0c6e49f92:df
    f371844dc1d0c6e49f92:3 46be33ef1f2dbc0956af:dodgers
    bc9654d83b13db44d507:royals b514a8918dbc221a17bd:dodgers
    86c114c0d0e9866d56cf:astros ac56300fcdbf84e6f7d2:white
    ac56300fcdbf84e6f7d2:sox 8e6763a0f5c15b07ef8a:76ers
    2e500fea9778f1bfafc7:raiders b30172f8db7f7620575f:tigers
    268055e5845c6ecfcf83:mets bc6cd6c49b79324c84d7:lakers
    805d56c3f42c2ad4218c:padres 86990bc00f236f49430e:spurs
    8fb29302a15dd34e880b:lakers a13d07f85029e110759d:real
    a13d07f85029e110759d:madrid
  `.trim().split(/\s+/)),
  grammar: new Set(`
    646c3f4af20b9ee7fe07:rc 0dd3315a29711425e71b:shop
    0dd3315a29711425e71b:promo 0dd3315a29711425e71b:psa
    0dd3315a29711425e71b:10 5bbc14c582d6f0b34f77:rc
  `.trim().split(/\s+/)),
  synonym: new Set(`
    b70318cffa06b389f851:autographed 4a36645e653a8b8a8019:autograph
  `.trim().split(/\s+/)),
  normalization: new Set(`
    a12d7e8c2d623c870df4:blue 5edfef737b8f58f5253b:orange
    159b07bd6d12e0e4e794:gold 86c114c0d0e9866d56cf:baseball
    981cde75132b2b4a3269:orange 413aa29a2561ee50f989:green
    77f1063c48c35c3d3583:silver
  `.trim().split(/\s+/)),
  composer_budget: new Set(`
    410c0c9aa76e944a0cbc:elite bcc4e7ac4ac23e1e69d3:polanco
    bcc4e7ac4ac23e1e69d3:ryan 89cde2e9bc69a6edb4fd:kings
    6d227f82fdcb2ded4b6d:cova 6d227f82fdcb2ded4b6d:david
    4aa0c1e7f7e95ed8ae49:violet 4aa0c1e7f7e95ed8ae49:speckle
    4aa0c1e7f7e95ed8ae49:refractor ba0f97b835e28571d19f:purple
    12eca650b27f025d5a1c:blue 12eca650b27f025d5a1c:shimmer
    64d10f8c8986aa1c9af4:star 3304222f844f985e9574:orange
    c6ecb08d49256335aa6b:blue 2cada69235bf401f2a16:panini
    58264271a4854c4a73ed:green c2b77d787bd8cd8345e3:holo
    70559ba85193165a2f95:blue 4cd844c77ea0347c87da:special
    4cd844c77ea0347c87da:pr 4cd844c77ea0347c87da:1
    4cd844c77ea0347c87da:iconic 952016ff08174d8a0b0a:panini
    805d56c3f42c2ad4218c:gold
  `.trim().split(/\s+/))
};

function explicitClass(groups, key, label) {
  const matches = Object.entries(groups).filter(([, keys]) => keys.has(key));
  if (matches.length !== 1) {
    throw new Error(`${label} manual classification must match exactly once: ${key}; matches=${matches.map(([name]) => name).join(",") || "none"}`);
  }
  return matches[0][0];
}

const COLOR_TERMS = new Set(`black blue bronze gold green orange purple red silver teal white yellow`.split(" "));
const FINISH_TERMS = new Set(`
  bordered burst choice crystallized dalmatian diamond dye flashback foil fractor fusion
  geometric holo hyper interstellar lenticular mini mirrored mojo motion padparadscha
  patriotic pixel platinum portrait prismatic prizm pulsar raindrops raywave refractor
  reptilian round sapphire sparkle sparkles splash super tie timepieces wave
`.trim().split(/\s+/));
const ATTRIBUTE_TERMS = new Set(`1st auto autographs jersey patch prospect rc relics rookie signatures trainer`.split(" "));
const RARITY_TERMS = new Set(`base common hr rps sar sp ssp`.split(" "));
const TEAM_TERMS = new Set(`dolphins team university`.split(" "));
const IDENTITY_TERMS = new Set(`
  bowman box card disney draft edition gallery kings league major nbl origin outpost
  series smugglers star swsh veefriends volume
`.trim().split(/\s+/));
const SUBJECT_TERMS = new Set(`cee cristopher d'angelo dee edrio luis otani`.split(" "));

function structuralFamily(token) {
  if (/^(?:\d{1,4}\/\d{1,4}|\/\d{1,4}|(?:\/\d{1,4}){2,})$/.test(token)) return "serial_or_numbered_print";
  if (/^lotx\d+$/.test(token) || token === "x" || token === "three") return "lot_notation";
  if (/^(?:19|20)\d{2}$/.test(token) || token === "year" || token === "26'") return "year_or_season";
  if (/^\d+$/.test(token) || /^\d+(?:st|th)$/.test(token)) return "bare_number_or_ordinal";
  if (COLOR_TERMS.has(token)) return "color";
  if (FINISH_TERMS.has(token)) return "parallel_or_finish";
  if (ATTRIBUTE_TERMS.has(token)) return "attribute_or_component";
  if (RARITY_TERMS.has(token)) return "rarity_or_marker";
  if (TEAM_TERMS.has(token)) return "team_or_league";
  if (IDENTITY_TERMS.has(token)) return "product_set_or_ip";
  if (SUBJECT_TERMS.has(token)) return "subject_or_name";
  if (/^(?:advantge|jenkinsrefractor|wildchrome|wildliquid)$/.test(token)) return "token_boundary_or_spelling";
  return "other_identity_or_descriptor";
}

function targetForFamily(family) {
  const mapping = {
    serial_or_numbered_print: "numerical_rarity",
    lot_notation: "lot_count",
    year_or_season: "year",
    bare_number_or_ordinal: "card_number_or_identity",
    color: "print_finish_candidate",
    parallel_or_finish: "print_finish",
    attribute_or_component: "observable_components_or_descriptive_rarity",
    rarity_or_marker: "descriptive_rarity",
    team_or_league: "search_optimization_candidate",
    product_set_or_ip: "product_set_or_ip",
    subject_or_name: "subject",
    token_boundary_or_spelling: "normalization",
    other_identity_or_descriptor: "open_evidence_candidate"
  };
  return mapping[family];
}

function targetFromObservation(observation, token, family) {
  if (!observation) return targetForFamily(family);
  const label = clean(observation.label);
  if (token === "1st") return "descriptive_rarity";
  if (token.includes("/") && /(serial|stamped_number|serial_form)/.test(label)) return "numerical_rarity";
  if (/(grade|grading)/.test(label)) return "grading_info";
  if (/(season|year_mark|copyright_set_line)/.test(label) || (label === "set" && /^\d+$/.test(token))) return "year";
  if (/^team/.test(label)) return "search_optimization_candidate";
  if (label === "name") return "subjects";
  if (/(insert_name|event|event_logo_text)/.test(label)) return "card_name";
  if (/(rookie|rarity)/.test(label)) return "descriptive_rarity_or_observable_components";
  if (label === "card_number") return "card_number";
  if (label === "card_type") return "observable_components_or_card_name";
  if (label === "logo") return "product_set_or_ip";
  if (label === "abbreviation" && token === "vmax") return "subjects_or_card_name";
  if (clean(observation.evidence).includes("pick 2")) return "card_name";
  return targetForFamily(family);
}

function mechanismForClass(semanticClass, family) {
  if (semanticClass === "safe_direct") return "exact_high_value_evidence_resolver";
  if (semanticClass === "synonym") return "retain_evidence_and_score_semantics_without_title_duplication";
  if (semanticClass === "wrong_role") return "reject_role_collision_and_keep_provenance";
  if (semanticClass === "suppression") return "evidence_gated_suppression_exception_replay";
  if (semanticClass === "grammar") return "change_csm_sem_grammar_then_full_replay";
  if (semanticClass === "composer_budget") return "lossless_compaction_or_priority_replay";
  if (semanticClass === "normalization") {
    return family === "lot_notation" ? "lot_notation_normalizer" : "typed_normalization_exception_replay";
  }
  const candidates = {
    serial_or_numbered_print: "exact_digit_span_capture_then_verify",
    year_or_season: "printed_season_or_catalog_consistency_check",
    color: "bounded_parallel_candidate_plus_catalog_check",
    parallel_or_finish: "printed_or_catalog_attested_parallel_candidate",
    attribute_or_component: "printed_attribute_capture",
    rarity_or_marker: "printed_rarity_capture",
    team_or_league: "printed_affiliation_plus_temporal_world_check",
    product_set_or_ip: "identity_span_expansion_plus_catalog_check",
    subject_or_name: "subject_span_completeness_check",
    bare_number_or_ordinal: "role_aware_numeric_capture",
    token_boundary_or_spelling: "alias_and_token_boundary_normalizer",
    other_identity_or_descriptor: "open_evidence_candidate_only"
  };
  return candidates[family] || "open_evidence_candidate_only";
}

function downstreamShadow(canonical, fields) {
  if (!fields.length) return null;
  const brackets = fields.map((entry) => bracketForField(entry.field, canonical.grammar));
  if (fields.some((entry) => entry.field === "team" || entry.field === "card_number")) return "suppression";
  if (canonical.grammar === "lot" && fields.some((entry) => ["components", "attributes", "grade", "card_name"].includes(entry.field))) return "grammar";
  if (brackets.some((bracket) => (canonical.dropped_brackets || []).includes(bracket))) return "composer_budget";
  if (fields.some((entry) => entry.field === "subjects") && (canonical.dropped_brackets || []).includes("extra_subjects")) return "composer_budget";
  return "normalization";
}

function replayRows(report) {
  return report.cards || report.cards_detail || report.card_results || [];
}

function replayRecovery(replays, assetId, token) {
  const evidence = [];
  for (const replay of replays) {
    const row = replay.rows.get(assetId);
    if (!row) continue;
    const baselineTitle = row.baseline_title;
    const candidateTitle = row.candidate_title || row.replay_title;
    if (!baselineTitle || !candidateTitle) continue;
    if (!hasToken(baselineTitle, token) && hasToken(candidateTitle, token)) {
      const changes = (row.changes || []).map((change) => typeof change === "string"
        ? change
        : change.mechanism || change.field || "unspecified");
      evidence.push({
        artifact: replay.path,
        mechanism: [...new Set(changes)],
        baseline_title: baselineTitle,
        candidate_title: candidateTitle
      });
    }
  }
  return evidence;
}

function makeBase({ stage, row, token, canonical, sourceField, sourceObservation, semanticClass, annotationMethod, structuralFamilyName, replayEvidence }) {
  const sourceText = sourceObservation?.evidence || sourceField?.value || token;
  return {
    id: `${stage}:${row.asset_id}:${token}`,
    asset_id: row.asset_id,
    token,
    phrase: phraseForItem(row.reference, sourceText, token, sourceObservation),
    stage,
    reference: row.reference,
    canonical_title: canonical.title,
    source_field: sourceField || null,
    source_observation: sourceObservation || null,
    semantic_class: semanticClass,
    structural_family: structuralFamilyName,
    suggested_target_field: sourceField?.field || targetFromObservation(sourceObservation, token, structuralFamilyName),
    recommended_mechanism: mechanismForClass(semanticClass, structuralFamilyName),
    annotation_method: annotationMethod,
    annotation_confidence: semanticClass === "needs_evidence" ? "medium" : "high",
    replay_recovered: replayEvidence.length > 0,
    replay_evidence: replayEvidence
  };
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function clipped(value, limit = 150) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function markdownTable(items, includeObservation) {
  const header = includeObservation
    ? "| Asset suffix | Token / phrase | Class | Source observation | Mechanism | Replay |\n|---|---|---|---|---|---|"
    : "| Asset suffix | Token / phrase | Class | Source field | Mechanism | Replay |\n|---|---|---|---|---|---|";
  const rows = items.map((item) => {
    const source = includeObservation
      ? item.source_observation
        ? `${item.source_observation.label}@${item.source_observation.region}: ${clipped(item.source_observation.evidence)}`
        : "none"
      : item.source_field
        ? `${item.source_field.field}: ${clipped(item.source_field.value)}`
        : "none";
    return `| \`${suffix(item.asset_id)}\` | \`${markdownEscape(item.token)}\` / ${markdownEscape(item.phrase)} | \`${item.semantic_class}\` | ${markdownEscape(source)} | \`${item.recommended_mechanism}\` | ${item.replay_recovered ? "yes" : "no"} |`;
  });
  return [header, ...rows].join("\n");
}

function build() {
  for (const path of Object.values(INPUTS)) {
    if (!existsSync(abs(path))) throw new Error(`missing input: ${path}`);
  }
  const audit = readJson(INPUTS.loss_audit);
  const canonicalRows = readJsonl(INPUTS.canonical).filter((row) => row.arm === "thin_canonical_high");
  const exhaustiveRows = readJsonl(INPUTS.exhaustive).filter((row) => row.arm === "exhaustive_observation_high");
  const canonicalByAsset = new Map(canonicalRows.map((row) => [row.asset_id, row]));
  const exhaustiveByAsset = new Map(exhaustiveRows.map((row) => [row.asset_id, row]));
  const replays = [INPUTS.safe_bundle_replay, INPUTS.expression_overlay_replay].map((path) => {
    const report = readJson(path);
    return { path, rows: new Map(replayRows(report).map((row) => [row.asset_id, row])) };
  });

  if (audit.paired_cards !== EXPECTED.paired_cards || canonicalByAsset.size !== EXPECTED.paired_cards || exhaustiveByAsset.size !== EXPECTED.paired_cards) {
    throw new Error(`cohort mismatch: audit=${audit.paired_cards}, canonical=${canonicalByAsset.size}, exhaustive=${exhaustiveByAsset.size}`);
  }

  const items = [];
  for (const row of audit.rows) {
    const canonical = canonicalByAsset.get(row.asset_id);
    const exhaustive = exhaustiveByAsset.get(row.asset_id);
    if (!canonical || !exhaustive) throw new Error(`unpaired asset: ${row.asset_id}`);

    for (const token of row.causes.exhaustive_not_expressed) {
      const observations = matchingObservations(exhaustive, token);
      if (observations.length) throw new Error(`unexpected exhaustive observation match: ${row.asset_id}:${token}`);
      const fields = matchingFields(canonical.fields, token);
      const family = structuralFamily(token);
      const shadow = downstreamShadow(canonical, fields);
      const semanticClass = shadow || (family === "lot_notation" || family === "token_boundary_or_spelling" ? "normalization" : "needs_evidence");
      const replayEvidence = replayRecovery(replays, row.asset_id, token);
      const item = makeBase({
        stage: "exhaustive_not_expressed",
        row,
        token,
        canonical,
        sourceField: fields[0],
        sourceObservation: null,
        semanticClass,
        annotationMethod: shadow ? "structural_rule_with_canonical_shadow" : "structural_rule_no_visual_truth_claim",
        structuralFamilyName: family,
        replayEvidence
      });
      item.source_fields = fields;
      item.exhaustive_observation_match_count = 0;
      item.shadow_downstream_class = shadow;
      items.push(item);
    }

    for (const token of row.causes.canonical_schema_compression) {
      const observations = matchingObservations(exhaustive, token);
      if (!observations.length) throw new Error(`missing source observation: ${row.asset_id}:${token}`);
      const key = itemKey(row.asset_id, token);
      const semanticClass = explicitClass(MANUAL_SCHEMA, key, "schema");
      const replayEvidence = replayRecovery(replays, row.asset_id, token);
      const item = makeBase({
        stage: "canonical_schema_compression",
        row,
        token,
        canonical,
        sourceField: null,
        sourceObservation: observations[0],
        semanticClass,
        annotationMethod: "manual_old100_four_way_semantic_audit",
        structuralFamilyName: structuralFamily(token),
        replayEvidence
      });
      item.source_observation_match_count = observations.length;
      items.push(item);
    }

    for (const token of row.causes.downstream_composition) {
      const fields = matchingFields(canonical.fields, token);
      if (!fields.length) throw new Error(`missing canonical source field: ${row.asset_id}:${token}`);
      const key = itemKey(row.asset_id, token);
      const semanticClass = explicitClass(MANUAL_DOWNSTREAM, key, "downstream");
      const replayEvidence = replayRecovery(replays, row.asset_id, token);
      const item = makeBase({
        stage: "downstream_composition",
        row,
        token,
        canonical,
        sourceField: fields[0],
        sourceObservation: null,
        semanticClass,
        annotationMethod: "manual_old100_downstream_root_cause_audit",
        structuralFamilyName: structuralFamily(token),
        replayEvidence
      });
      item.source_fields = fields;
      item.grammar = canonical.grammar;
      item.composer_brackets = canonical.brackets || [];
      item.dropped_brackets = canonical.dropped_brackets || [];
      item.suppressed_brackets = canonical.suppressed_brackets || [];
      items.push(item);
    }
  }

  const stageCounts = countBy(items, (item) => item.stage);
  for (const [stage, expected] of Object.entries(EXPECTED).filter(([key]) => key !== "paired_cards")) {
    if (stageCounts[stage] !== expected) throw new Error(`stage count mismatch ${stage}: ${stageCounts[stage]} != ${expected}`);
  }
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error("duplicate ledger id");

  const inputHashes = Object.fromEntries(Object.entries(INPUTS).map(([name, path]) => [name, { path, sha256: sha256(path) }]));
  const stages = Object.fromEntries(Object.keys(EXPECTED).filter((key) => key !== "paired_cards").map((stage) => {
    const stageItems = items.filter((item) => item.stage === stage);
    return [stage, {
      item_count: stageItems.length,
      affected_cards: new Set(stageItems.map((item) => item.asset_id)).size,
      semantic_class_counts: countBy(stageItems, (item) => item.semantic_class),
      structural_family_counts: countBy(stageItems, (item) => item.structural_family),
      replay_recovered_count: stageItems.filter((item) => item.replay_recovered).length
    }];
  }));

  const report = {
    schema_version: "fresh150-loss-ledger-v1",
    generated_for_date: "2026-08-02",
    authority: "offline_evaluation_only",
    production_promoted: false,
    cohort: {
      paired_cards: audit.paired_cards,
      canonical_arm: audit.canonical_arm,
      exhaustive_arm: audit.exhaustive_arm,
      image_detail: "high"
    },
    methodology: {
      waterfall_warning: "The three stages record the earliest comparison boundary, not mutually exclusive causal truth. A canonical-field shadow is retained for stage-one items when present.",
      schema_annotation: "All 109 items are explicitly classified with the old-100 four-way semantic audit: safe direct, synonym, needs evidence, or wrong role.",
      downstream_annotation: "All 63 items are explicitly classified as suppression, grammar, synonym, normalization, or Composer budget.",
      unexpressed_annotation: "All 255 items receive structural classification only. No image truth is inferred; absence from exhaustive observations remains needs-evidence unless a mechanical normalization or canonical-field shadow is present.",
      replay_recovery: "Exact token absent from stored replay baseline and present in stored replay candidate; this is not a production-promotion claim.",
      old100_rule_source: INPUTS.old100_rules
    },
    inputs: inputHashes,
    validation: {
      expected_counts: EXPECTED,
      actual_counts: { paired_cards: audit.paired_cards, ...stageCounts },
      counts_match: true,
      unique_item_ids: true,
      canonical_assets: canonicalByAsset.size,
      exhaustive_assets: exhaustiveByAsset.size,
      schema_items_with_source_observation: items.filter((item) => item.stage === "canonical_schema_compression" && item.source_observation).length,
      downstream_items_with_source_field: items.filter((item) => item.stage === "downstream_composition" && item.source_field).length,
      stage_one_items_with_zero_observation_match: items.filter((item) => item.stage === "exhaustive_not_expressed" && item.exhaustive_observation_match_count === 0).length,
      manually_semantically_annotated_items: items.filter((item) => item.annotation_method.startsWith("manual_")).length
    },
    stages,
    items
  };

  const schemaItems = items.filter((item) => item.stage === "canonical_schema_compression");
  const downstreamItems = items.filter((item) => item.stage === "downstream_composition");
  const unexpressedItems = items.filter((item) => item.stage === "exhaustive_not_expressed");
  const recovered = items.filter((item) => item.replay_recovered);
  const hashRows = Object.values(inputHashes).map((input) => `| \`${input.path}\` | \`${input.sha256}\` |`).join("\n");
  const stageRows = Object.entries(stages).map(([stage, summary]) =>
    `| \`${stage}\` | ${summary.item_count} | ${summary.affected_cards} | ${Object.entries(summary.semantic_class_counts).map(([key, count]) => `${key}=${count}`).join(", ")} | ${summary.replay_recovered_count} |`
  ).join("\n");
  const familyRows = Object.entries(stages.exhaustive_not_expressed.structural_family_counts)
    .sort(([, a], [, b]) => b - a)
    .map(([family, count]) => `| \`${family}\` | ${count} |`).join("\n");
  const recoveredRows = recovered.length
    ? recovered.map((item) => {
      const mechanisms = [...new Set(item.replay_evidence.flatMap((entry) => entry.mechanism))];
      return `| \`${suffix(item.asset_id)}\` | \`${item.stage}\` | \`${item.token}\` | \`${mechanisms.join("+") || "unspecified"}\` |`;
    }).join("\n")
    : "| — | — | — | — |";

  const markdown = `# fresh150 逐项损失台账：255 / 109 / 63 — 2026-08-02

## 结论

反方观点是：把 \`255 / 109 / 63\` 直接当成“模型没看见 / schema 丢失 / Composer 丢失”三个互斥真因，会高估每一层的独立收益。原始分析采用最早命中优先级；例如 255 中仍有 canonical 字段影子。因此本台账保留原 stage，同时单独记录 canonical shadow。

本地只读复核得到 150 个完整配对、427 个 token occurrence，计数严格为 \`255 / 109 / 63\`。109 个 schema 项和 63 个 downstream 项均逐项补标且没有默认分类；255 项仅做结构分类，不依据图片猜真值。没有 provider、部署、网络、生产代码或图片读取。

| Earliest boundary | Items | Cards | Semantic classes | Exact replay recoveries |
|---|---:|---:|---|---:|
${stageRows}

注意：\`safe_direct\` 是“现有 observation 的语义角色足以进入高精度 resolver 候选池”，不是已经获准进入生产；\`needs_evidence\` 和 \`wrong_role\` 均不得自动获得 CSM 权威。

## 255：只做结构分类

| Structural family | Items |
|---|---:|
${familyRows}

这 255 项的逐项 asset、token、reference、canonical field shadow、建议机制和回放状态全部在同名 JSON 中。没有 exhaustive source observation 的项不会被标成视觉真值。机械可判的 lot/拼写边界归为 normalization；已有 canonical field shadow 的 7 项保留其 downstream 影子类别；其余保持 \`needs_evidence\`。

## 109：schema compression 逐项人工语义补标

沿用旧 100 的四分法：直接且角色正确、同义重复、候选待证、错位碰撞。每一项都链接到实际 exhaustive observation。

${markdownTable(schemaItems, true)}

## 63：downstream 逐项根因补标

沿用旧 100 的下游分类：预算/优先级、市场抑制、lot grammar、静默 normalization，并单列语义同义词。

${markdownTable(downstreamItems, false)}

## 已有回放精确回收

这里的 “recovered” 只表示：同一 asset 的已存 150-card replay 中，token 不在 baseline title、但出现在 candidate title。它不等于生产准入。

| Asset suffix | Stage | Token | Stored replay mechanism |
|---|---|---|---|
${recoveredRows}

## 校验与输入指纹

- regenerate: \`node scripts/build-fresh150-loss-ledger.mjs\`;
- verify without rewriting: \`node scripts/build-fresh150-loss-ledger.mjs --check\`;
- paired cards: \`${audit.paired_cards}\`;
- unique ledger ids: \`true\`;
- schema items with source observation: \`${report.validation.schema_items_with_source_observation}/109\`;
- downstream items with source field: \`${report.validation.downstream_items_with_source_field}/63\`;
- stage-one items confirmed absent from exhaustive observations: \`${report.validation.stage_one_items_with_zero_observation_match}/255\`;
- manually semantically annotated: \`${report.validation.manually_semantically_annotated_items}/172\`.

| Input | SHA-256 |
|---|---|
${hashRows}

## 使用边界

1. 优先回放 \`safe_direct\` 和可逆的 Composer 机制；不得把 oracle token 直接拼回标题。
2. \`synonym\` 进入语义评分或证据保留，不为刷 token F1 重复输出。
3. \`needs_evidence\` 只能进入 provenance-bearing candidate lane，等待目录/世界约束或人工确认。
4. \`wrong_role\` 是明确的拒绝样本，应进入 resolver 负例测试。
5. 所有机制仍须按 150-card 回放、再按 5–8 个机制一批做真实 150-card 验证；本台账本身不构成上线结论。
`;

  return {
    json: `${JSON.stringify(report, null, 2)}\n`,
    markdown,
    report
  };
}

const result = build();
const check = process.argv.includes("--check");
if (check) {
  for (const [path, content] of [[OUTPUT_JSON, result.json], [OUTPUT_MD, result.markdown]]) {
    if (!existsSync(abs(path)) || readFileSync(abs(path), "utf8") !== content) {
      throw new Error(`generated output is stale: ${path}`);
    }
  }
} else {
  writeFileSync(abs(OUTPUT_JSON), result.json);
  writeFileSync(abs(OUTPUT_MD), result.markdown);
}

process.stdout.write(`${JSON.stringify({
  output_json: relative(ROOT, abs(OUTPUT_JSON)),
  output_markdown: relative(ROOT, abs(OUTPUT_MD)),
  validation: result.report.validation,
  stages: result.report.stages
}, null, 2)}\n`);
