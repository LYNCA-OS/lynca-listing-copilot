import { createHash } from "node:crypto";
import { catalogFieldStatuses, catalogImportStatuses } from "./catalog-contract.mjs";

export const catalogAdmissionReasonCodes = Object.freeze({
  SOURCE_ROW_KEY_MISSING: "SOURCE_ROW_KEY_MISSING",
  SOURCE_ROW_KEY_DUPLICATE: "SOURCE_ROW_KEY_DUPLICATE",
  PHYSICAL_INSTANCE_FIELD_PRESENT: "PHYSICAL_INSTANCE_FIELD_PRESENT",
  TEAM_ROLE_TOKEN: "TEAM_ROLE_TOKEN",
  SUBJECT_ROLE_TOKEN: "SUBJECT_ROLE_TOKEN",
  AUTOGRAPH_COMPONENT_MISSING: "AUTOGRAPH_COMPONENT_MISSING",
  RELIC_COMPONENT_MISSING: "RELIC_COMPONENT_MISSING",
  MULTI_SUBJECT_PRINT_SPLIT: "MULTI_SUBJECT_PRINT_SPLIT",
  MULTI_SUBJECT_CARDINALITY_MISMATCH: "MULTI_SUBJECT_CARDINALITY_MISMATCH"
});

const roleTokenPattern = /^(?:RC|Rookie)$/i;
const explicitAutographPattern = /\b(?:Autographs?|Signatures?)\b/i;
const explicitRelicPattern = /\b(?:Relics?|Patch(?:es)?|Memorabilia|Jersey)\b/i;
const explicitMultiSubjectPattern = /\b(?:Dual|Triple|Trio|Quad(?:ruple)?|Pairings?|Split Decision|Combo)\b/i;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function fieldsFor(row = {}) {
  return row.identity_fields || row.fields || {};
}

function activeRow(row = {}) {
  const status = clean(row.import_status);
  return status !== catalogImportStatuses.OFFICIAL_RELEASE_SUPPORT && !/REVIEW_REQUIRED/i.test(status);
}

function hasMaterialValue(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.some(hasMaterialValue);
  if (typeof value === "object") return Object.values(value).some(hasMaterialValue);
  return true;
}

function printIdentityKey(row = {}) {
  const fields = fieldsFor(row);
  const number = clean(fields.card_number || fields.collector_number || fields.checklist_code).toUpperCase();
  if (!number) return "";
  return [
    clean(fields.season_year || fields.year),
    clean(fields.product),
    clean(fields.set_or_insert || fields.set),
    clean(fields.official_card_type),
    clean(fields.card_number || fields.collector_number).toUpperCase(),
    clean(fields.checklist_code).toUpperCase()
  ].join("\u001f");
}

function mergeEligible(row = {}) {
  const fields = fieldsFor(row);
  return explicitMultiSubjectPattern.test(clean(fields.set_or_insert || fields.set));
}

function expectedPlayerCount(row = {}) {
  if (!/\bcatalog_admission_multi_subject_merge:\d+\b/i.test(clean(row.review_notes))) return 0;
  const fields = fieldsFor(row);
  const setName = clean(fields.set_or_insert || fields.set);
  if (/\b(?:Quad(?:ruple)?)\b/i.test(setName)) return 4;
  if (/\b(?:Triple|Trio)\b/i.test(setName)) return 3;
  if (/\b(?:Dual|Pairings?|Split Decision)\b/i.test(setName)) return 2;
  return 0;
}

function union(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function distinctPlayerSetCount(rows = []) {
  return new Set(rows.map((row) => JSON.stringify(union(fieldsFor(row).players || []).sort()))).size;
}

function normalizedCanonicalTitle(row = {}, players = []) {
  const fields = fieldsFor(row);
  const firstPlayer = clean(fields.players?.[0]);
  const joinedPlayers = players.join(" / ");
  const current = clean(row.canonical_title);
  if (current && firstPlayer && current.toLowerCase().includes(firstPlayer.toLowerCase())) {
    const start = current.toLowerCase().indexOf(firstPlayer.toLowerCase());
    return `${current.slice(0, start)}${joinedPlayers}${current.slice(start + firstPlayer.length)}`;
  }
  const number = clean(fields.card_number || fields.collector_number || fields.checklist_code);
  return [
    fields.season_year || fields.year,
    fields.product,
    fields.set_or_insert || fields.set,
    joinedPlayers,
    number ? `#${number}` : ""
  ].map(clean).filter(Boolean).join(" ");
}

function normalizedRow(row = {}) {
  const fields = { ...fieldsFor(row) };
  const statuses = { ...(row.field_statuses || {}) };
  const components = union(fields.observable_components || []);
  let teamRoleCleared = false;
  let autographEnriched = false;
  let relicEnriched = false;

  if (roleTokenPattern.test(clean(fields.team))) {
    fields.team = null;
    delete statuses.team;
    if (!components.includes("rc")) components.push("rc");
    teamRoleCleared = true;
  }

  const setName = clean(fields.set_or_insert || fields.set);
  const autographSupported = explicitAutographPattern.test(setName)
    || /^Autograph$/i.test(clean(fields.official_card_type));
  if (autographSupported) {
    if (!components.includes("auto")) {
      components.push("auto");
      autographEnriched = true;
    }
    if (!clean(fields.official_card_type)) fields.official_card_type = "Autograph";
    statuses.official_card_type ||= catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST;
  }

  const relicSupported = explicitRelicPattern.test(setName)
    || /^Relic$/i.test(clean(fields.official_card_type));
  if (relicSupported) {
    if (!components.includes("relic")) {
      components.push("relic");
      relicEnriched = true;
    }
    if (!clean(fields.official_card_type)) fields.official_card_type = "Relic";
    statuses.official_card_type ||= catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST;
  }

  fields.observable_components = union(components);
  if (fields.observable_components.length) {
    statuses.observable_components ||= catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST;
  }
  return {
    row: { ...row, identity_fields: fields, field_statuses: statuses },
    teamRoleCleared,
    autographEnriched,
    relicEnriched
  };
}

function mergeRows(rows = []) {
  const first = rows[0];
  const firstFields = fieldsFor(first);
  const players = union(rows.flatMap((row) => fieldsFor(row).players || []));
  const components = union(rows.flatMap((row) => fieldsFor(row).observable_components || []));
  const sourceKeys = rows.map((row) => clean(row.source_row_key)).sort();
  const mergedKey = createHash("sha256").update(sourceKeys.join("\u001f")).digest("hex").slice(0, 24);
  const statuses = { ...(first.field_statuses || {}) };
  delete statuses.team;
  statuses.players ||= catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST;
  if (components.length) statuses.observable_components ||= catalogFieldStatuses.AUTO_PARSED_FROM_OFFICIAL_CHECKLIST;
  return {
    ...first,
    source_row_key: `merged:${mergedKey}`,
    canonical_title: normalizedCanonicalTitle(first, players),
    identity_fields: { ...firstFields, players, team: null, observable_components: components },
    field_statuses: statuses,
    review_notes: [clean(first.review_notes), `catalog_admission_multi_subject_merge:${rows.length}`]
      .filter(Boolean)
      .join("; ")
  };
}

export function normalizeOfficialCatalogRows(rows = []) {
  const normalized = [];
  const metrics = {
    input_row_count: rows.length,
    output_row_count: 0,
    team_role_cleared_count: 0,
    autograph_semantics_enriched_count: 0,
    relic_semantics_enriched_count: 0,
    multi_subject_group_count: 0,
    merged_row_count: 0
  };
  for (const row of rows) {
    const result = normalizedRow(row);
    normalized.push(result.row);
    metrics.team_role_cleared_count += Number(result.teamRoleCleared);
    metrics.autograph_semantics_enriched_count += Number(result.autographEnriched);
    metrics.relic_semantics_enriched_count += Number(result.relicEnriched);
  }

  const groups = new Map();
  const passthrough = [];
  for (const row of normalized) {
    const key = activeRow(row) && mergeEligible(row) ? printIdentityKey(row) : "";
    if (!key) {
      passthrough.push(row);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const output = [...passthrough];
  for (const groupRows of groups.values()) {
    if (groupRows.length === 1 || distinctPlayerSetCount(groupRows) <= 1) output.push(...groupRows);
    else {
      output.push(mergeRows(groupRows));
      metrics.multi_subject_group_count += 1;
      metrics.merged_row_count += groupRows.length - 1;
    }
  }
  output.sort((left, right) => clean(left.source_row_key).localeCompare(clean(right.source_row_key), "en", { numeric: true }));
  metrics.output_row_count = output.length;
  return { rows: output, metrics };
}

export function validateOfficialCatalogRows(rows = [], { maxIssueSamples = 25 } = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const issues = [];
  const issueCounts = {};
  const addIssue = (reasonCode, row = {}, details = {}) => {
    issueCounts[reasonCode] = Number(issueCounts[reasonCode] || 0) + 1;
    if (issues.length < maxIssueSamples) {
      issues.push({
        reason_code: reasonCode,
        source_row_key: clean(row.source_row_key) || null,
        print_identity_key: printIdentityKey(row) || null,
        ...details
      });
    }
  };
  const sourceKeys = new Set();
  const printGroups = new Map();

  for (const row of sourceRows) {
    if (!activeRow(row)) continue;
    const fields = fieldsFor(row);
    const sourceKey = clean(row.source_row_key);
    if (!sourceKey) addIssue(catalogAdmissionReasonCodes.SOURCE_ROW_KEY_MISSING, row);
    else if (sourceKeys.has(sourceKey)) addIssue(catalogAdmissionReasonCodes.SOURCE_ROW_KEY_DUPLICATE, row);
    else sourceKeys.add(sourceKey);
    if (hasMaterialValue(row.physical_instance_fields || {})) {
      addIssue(catalogAdmissionReasonCodes.PHYSICAL_INSTANCE_FIELD_PRESENT, row);
    }
    if (roleTokenPattern.test(clean(fields.team))) addIssue(catalogAdmissionReasonCodes.TEAM_ROLE_TOKEN, row);
    if ((fields.players || []).some((player) => roleTokenPattern.test(clean(player)))) {
      addIssue(catalogAdmissionReasonCodes.SUBJECT_ROLE_TOKEN, row);
    }
    const components = new Set((fields.observable_components || []).map((value) => clean(value).toLowerCase()));
    const setName = clean(fields.set_or_insert || fields.set);
    if ((explicitAutographPattern.test(setName) || /^Autograph$/i.test(clean(fields.official_card_type))) && !components.has("auto")) {
      addIssue(catalogAdmissionReasonCodes.AUTOGRAPH_COMPONENT_MISSING, row);
    }
    if ((explicitRelicPattern.test(setName) || /^Relic$/i.test(clean(fields.official_card_type))) && !components.has("relic")) {
      addIssue(catalogAdmissionReasonCodes.RELIC_COMPONENT_MISSING, row);
    }
    const printKey = mergeEligible(row) ? printIdentityKey(row) : "";
    const expectedPlayers = expectedPlayerCount(row);
    const actualPlayers = union(fields.players || []).length;
    if (expectedPlayers && actualPlayers < expectedPlayers) {
      addIssue(catalogAdmissionReasonCodes.MULTI_SUBJECT_CARDINALITY_MISMATCH, row, {
        expected_player_count: expectedPlayers,
        actual_player_count: actualPlayers
      });
    }
    if (printKey) {
      if (!printGroups.has(printKey)) printGroups.set(printKey, []);
      printGroups.get(printKey).push(row);
    }
  }
  for (const groupRows of printGroups.values()) {
    if (groupRows.length > 1 && distinctPlayerSetCount(groupRows) > 1) {
      addIssue(catalogAdmissionReasonCodes.MULTI_SUBJECT_PRINT_SPLIT, groupRows[0], { split_row_count: groupRows.length });
    }
  }
  return {
    schema_version: "official-catalog-admission-v1",
    valid: Object.keys(issueCounts).length === 0,
    checked_row_count: sourceRows.filter(activeRow).length,
    issue_count: Object.values(issueCounts).reduce((sum, count) => sum + count, 0),
    issue_counts: issueCounts,
    issues
  };
}

export function assertOfficialCatalogAdmission(rows = [], context = "official_source") {
  const validation = validateOfficialCatalogRows(rows);
  if (!validation.valid) {
    const reasons = Object.entries(validation.issue_counts)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(",");
    throw new Error(`official_catalog_admission_failed:${context}:${reasons}`);
  }
  return validation;
}
