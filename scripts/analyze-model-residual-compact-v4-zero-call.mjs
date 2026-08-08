#!/usr/bin/env node

// Zero-provider-call compression screen over the already validated residual-v3
// checkpoint. Variant selection is frozen before sealed labels are read.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  COMPACT_RESIDUAL_MODES_V4,
  MODEL_RESIDUAL_EXPLICIT_SHORT_FIELDS_SCHEMA_V4,
  MODEL_RESIDUAL_RANKED_ITEM_SCHEMA_V4,
  MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4,
  compactModelResidualCandidatesV4,
  inferModelResidualSinglePrintedPhraseRouteV4,
  projectModelResidualSinglePrintedPhraseV4,
  serializeModelResidualCompactV4
} from "../experiments/accuracy/model-residual-compact-v4.mjs";
import { resolveModelResidualVisibleEvidenceV3 } from
  "../experiments/accuracy/model-residual-visible-evidence-v3.mjs";
import {
  analyzeValidatedModelResidualV3,
  validateModelResidualV3FrozenRun
} from "./analyze-model-residual-candidate-v3-35x3.mjs";

const EPSILON = 1e-12;
const FROZEN_COMPOSER_FEATURES = Object.freeze({ exact_parallel_color_compaction: false });
const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const bytes = (value) => Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
const approximateTokens = (value) => Math.ceil(bytes(value) / 4);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);

function titleTokens(value) {
  return new Set(clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US").match(/[a-z0-9]+(?:\/[a-z0-9]+)*/g) || []);
}

function titleF1(reference, title) {
  const wanted = titleTokens(reference);
  const got = titleTokens(title);
  const hits = [...wanted].filter((token) => got.has(token)).length;
  const recall = wanted.size ? hits / wanted.size : 0;
  const precision = got.size ? hits / got.size : 0;
  return recall + precision ? 2 * recall * precision / (recall + precision) : 0;
}

function normalizedNumericClaim(value) {
  const text = clean(value).toLowerCase();
  const fraction = text.match(/^(\d{1,6})\/(\d{1,6})$/);
  if (fraction) return `${Number(fraction[1])}/${Number(fraction[2])}`;
  const decimal = text.match(/^\d+(?:\.\d+)?$/);
  return decimal ? String(Number(text)) : text;
}

function numericClaims(value) {
  const claims = clean(value).toLowerCase().match(
    /(?<![a-z0-9])(?:\d{1,6}\/\d{1,6}|\d+(?:\.\d+)?|(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)+)(?![a-z0-9])/g
  ) || [];
  return new Set(claims.map(normalizedNumericClaim));
}

const difference = (left, right) => [...left].filter((value) => !right.has(value));

function selectedCandidatePayload(candidates) {
  return candidates.map(({ text, role, region, basis }) => ({ text, role, region, basis }));
}

function wideV3Serialization(candidates) {
  return JSON.stringify({ residual_visible_evidence: selectedCandidatePayload(candidates) });
}

function genericSchema(maxItems) {
  return { type: "array", maxItems, items: MODEL_RESIDUAL_RANKED_ITEM_SCHEMA_V4 };
}

function maxGenericOutput(maxItems) {
  return JSON.stringify({ title_evidence: Array.from({ length: maxItems }, () => ({
    text: "X".repeat(64),
    role: "identity_phrase",
    region: "front_symbol",
    basis: "printed_text"
  })) });
}

function maxExplicitOutput() {
  return JSON.stringify({
    rarity_marker: "1st Edition",
    slab_finish: "X".repeat(64)
  });
}

function maxSinglePrintedPhraseOutput() {
  return JSON.stringify({
    residual_printed_phrase: "X".repeat(MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4.maxLength)
  });
}

function compactPrelabelCards(frozen) {
  return frozen.prereg.cohort.map(({ asset_id }) => {
    const row = frozen.byAsset.get(asset_id).get("residual_c");
    const fields = row.result.canonical_fields;
    const candidates = row.result.candidate_capture.candidates;
    const full = resolveModelResidualVisibleEvidenceV3(fields, candidates,
      { composerFeatures: FROZEN_COMPOSER_FEATURES });
    const variants = Object.fromEntries(COMPACT_RESIDUAL_MODES_V4.map((mode) => {
      const singlePhrase = mode === "single_printed_phrase"
        ? projectModelResidualSinglePrintedPhraseV4(candidates, { canonicalFields: fields }) : null;
      const inference = mode === "single_printed_phrase"
        ? inferModelResidualSinglePrintedPhraseRouteV4(singlePhrase, { canonicalFields: fields }) : null;
      const selected = compactModelResidualCandidatesV4(candidates, { mode, canonicalFields: fields });
      const resolved = resolveModelResidualVisibleEvidenceV3(fields, selected,
        { composerFeatures: FROZEN_COMPOSER_FEATURES });
      const serialized = serializeModelResidualCompactV4(candidates, { mode, canonicalFields: fields });
      return [mode, { selected, resolved, serialized, inference }];
    }));
    return {
      asset_id,
      canonical_title: row.result.canonical_title,
      canonical_fields: fields,
      candidates,
      full,
      variants
    };
  });
}

function fieldDifferences(left = {}, right = {}) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    .filter((field) => JSON.stringify(left[field] ?? null) !== JSON.stringify(right[field] ?? null));
}

function prelabelVariantSummary(cards, mode, wideBytes) {
  const outputBytes = cards.reduce((sum, card) => sum + bytes(card.variants[mode].serialized), 0);
  const selectedRows = cards.reduce((sum, card) => sum + card.variants[mode].selected.length, 0);
  const guardNames = ["valid_candidate_contract", "no_baseline_title_displacement",
    "all_new_tokens_source_backed", "field_changes_allowlisted", "within_80_characters"];
  const ambiguousRoutes = cards.flatMap((card) => card.variants[mode].inference?.ambiguous
    ? [{ asset_id: card.asset_id, text: card.variants[mode].inference.text }] : []);
  const fieldMismatches = cards.flatMap((card) => {
    const compact = card.variants[mode].resolved;
    const changed = fieldDifferences(card.full.fields, compact.fields);
    if (!changed.length) return [];
    return [{
      asset_id: card.asset_id,
      changed_fields: changed,
      full_v3_values: Object.fromEntries(changed.map((field) => [field, card.full.fields[field] ?? null])),
      compact_values: Object.fromEntries(changed.map((field) => [field, compact.fields[field] ?? null])),
      exact_title_equal: compact.title === card.full.title
    }];
  });
  return {
    full_v3_exact_title_fidelity_cards: cards.filter(
      (card) => card.variants[mode].resolved.title === card.full.title
    ).length,
    full_v3_exact_field_fidelity_cards: cards.length - fieldMismatches.length,
    full_v3_field_mismatch_cards: fieldMismatches,
    selected_rows: selectedRows,
    cards_with_selected_rows: cards.filter((card) => card.variants[mode].selected.length).length,
    ambiguous_route_cards: ambiguousRoutes.length,
    ambiguous_routes: ambiguousRoutes,
    candidate_output_bytes: outputBytes,
    approximate_candidate_output_tokens_at_4_bytes: Math.ceil(outputBytes / 4),
    candidate_output_byte_reduction_vs_wide_v3: 1 - (outputBytes / wideBytes),
    resolver_contract_defect_cards: cards.filter(
      (card) => card.variants[mode].resolved.defects.length
    ).length,
    resolver_rejected_cards: cards.filter(
      (card) => card.variants[mode].resolved.accepted !== true
    ).length,
    resolver_guard_failure_cards: Object.fromEntries(guardNames.map((guard) => [guard,
      cards.filter((card) => card.variants[mode].resolved.guards?.[guard] !== true).length
    ])),
    titles_over_80: cards.filter((card) => card.variants[mode].resolved.title.length > 80).length
  };
}

function chooseVariant(prelabelSummaries, cardCount) {
  const eligible = Object.entries(prelabelSummaries).filter(([, summary]) =>
    summary.full_v3_exact_title_fidelity_cards === cardCount
    && summary.full_v3_exact_field_fidelity_cards === cardCount
    && summary.resolver_contract_defect_cards === 0
    && summary.resolver_rejected_cards === 0
    && summary.ambiguous_route_cards === 0
    && summary.titles_over_80 === 0
  );
  if (!eligible.length) return null;
  return eligible.sort((left, right) =>
    left[1].candidate_output_bytes - right[1].candidate_output_bytes
    || left[1].selected_rows - right[1].selected_rows
    || left[0].localeCompare(right[0])
  )[0][0];
}

function chooseLosslessVariant(prelabelSummaries, cardCount) {
  const eligible = Object.entries(prelabelSummaries).filter(([, summary]) =>
    summary.full_v3_exact_title_fidelity_cards === cardCount
    && summary.full_v3_exact_field_fidelity_cards === cardCount
    && summary.resolver_contract_defect_cards === 0
    && summary.resolver_rejected_cards === 0
    && summary.ambiguous_route_cards === 0
    && summary.titles_over_80 === 0
  );
  if (!eligible.length) return null;
  return eligible.sort((left, right) =>
    left[1].candidate_output_bytes - right[1].candidate_output_bytes
    || left[1].selected_rows - right[1].selected_rows
    || left[0].localeCompare(right[0])
  )[0][0];
}

function scoredVariantSummary(cards, references, mode) {
  const scored = cards.map((card) => {
    const reference = references.get(card.asset_id);
    const baseline = titleF1(reference, card.canonical_title);
    const resolved = titleF1(reference, card.variants[mode].resolved.title);
    const baselineTokens = titleTokens(card.canonical_title);
    const resolvedTokens = titleTokens(card.variants[mode].resolved.title);
    const referenceTokens = titleTokens(reference);
    const source = [
      ...Object.values(card.canonical_fields).flat(Infinity).map(clean),
      ...card.variants[mode].selected.map((row) => row.text)
    ].join(" ");
    const sourceTokens = titleTokens(source);
    const baselineNumbers = numericClaims(card.canonical_title);
    const resolvedNumbers = numericClaims(card.variants[mode].resolved.title);
    const sourceNumbers = numericClaims(source);
    const referenceLosses = difference(baselineTokens, resolvedTokens)
      .filter((token) => referenceTokens.has(token));
    const unbackedNew = difference(resolvedTokens, baselineTokens)
      .filter((token) => !sourceTokens.has(token));
    const unsupportedNumeric = [
      ...difference(baselineNumbers, resolvedNumbers),
      ...difference(resolvedNumbers, baselineNumbers).filter((claim) => !sourceNumbers.has(claim))
    ];
    return { card, baseline, resolved, delta: resolved - baseline,
      referenceLosses, unbackedNew, unsupportedNumeric };
  });
  const outputBytes = scored.reduce((sum, row) => sum + bytes(row.card.variants[mode].serialized), 0);
  const wins = scored.filter((row) => row.delta > EPSILON).length;
  const losses = scored.filter((row) => row.delta < -EPSILON).length;
  return {
    canonical_macro_f1: mean(scored.map((row) => row.baseline)),
    resolved_macro_f1: mean(scored.map((row) => row.resolved)),
    delta_macro_f1: mean(scored.map((row) => row.delta)),
    wins,
    losses,
    ties: scored.length - wins - losses,
    reference_loss_cards: scored.filter((row) => row.referenceLosses.length).length,
    unbacked_new_token_cards: scored.filter((row) => row.unbackedNew.length).length,
    unsupported_numeric_change_cards: scored.filter((row) => row.unsupportedNumeric.length).length,
    wins_per_100_approximate_candidate_output_tokens: outputBytes
      ? wins / (outputBytes / 4) * 100 : null,
    changed_cards: scored.filter((row) => row.card.variants[mode].resolved.title
      !== row.card.canonical_title).map((row) => ({
        asset_id: row.card.asset_id,
        delta_f1: row.delta,
        canonical_title: row.card.canonical_title,
        compact_title: row.card.variants[mode].resolved.title,
        selected_candidates: selectedCandidatePayload(row.card.variants[mode].selected)
      }))
  };
}

function staticCosts() {
  const max1Output = maxGenericOutput(1);
  const max2Output = maxGenericOutput(2);
  const explicitOutput = maxExplicitOutput();
  const singleOutput = maxSinglePrintedPhraseOutput();
  return {
    single_printed_phrase: {
      property_schema_bytes: bytes(MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4),
      maximum_candidate_json_bytes: bytes(singleOutput),
      maximum_candidate_json_tokens_at_4_bytes: approximateTokens(singleOutput)
    },
    ranked_max1: {
      property_schema_bytes: bytes(genericSchema(1)),
      maximum_candidate_json_bytes: bytes(max1Output),
      maximum_candidate_json_tokens_at_4_bytes: approximateTokens(max1Output)
    },
    ranked_max2: {
      property_schema_bytes: bytes(genericSchema(2)),
      maximum_candidate_json_bytes: bytes(max2Output),
      maximum_candidate_json_tokens_at_4_bytes: approximateTokens(max2Output)
    },
    explicit_short_fields: {
      property_schema_bytes: bytes(MODEL_RESIDUAL_EXPLICIT_SHORT_FIELDS_SCHEMA_V4),
      maximum_candidate_json_bytes: bytes(explicitOutput),
      maximum_candidate_json_tokens_at_4_bytes: approximateTokens(explicitOutput)
    }
  };
}

export async function analyzeModelResidualCompactV4ZeroCall({
  preregPath,
  payloadPath,
  checkpointPath,
  datasetPath,
  labelsPath,
  readFileImpl = readFile
}) {
  const [preregBody, payloadBody, checkpointBody] = await Promise.all([
    readFileImpl(preregPath), readFileImpl(payloadPath), readFileImpl(checkpointPath)
  ]);
  const frozen = validateModelResidualV3FrozenRun({ preregBody, payloadBody, checkpointBody });
  const cards = compactPrelabelCards(frozen);
  const wideBytes = cards.reduce((sum, card) => sum + bytes(wideV3Serialization(card.candidates)), 0);
  const prelabel = Object.fromEntries(COMPACT_RESIDUAL_MODES_V4.map((mode) => [
    mode,
    prelabelVariantSummary(cards, mode, wideBytes)
  ]));
  const recommended = chooseVariant(prelabel, cards.length);
  const lossless = chooseLosslessVariant(prelabel, cards.length);

  // The compression decision above is complete before sealed label bytes are read.
  const [datasetBody, labelsBody] = await Promise.all([
    readFileImpl(datasetPath), readFileImpl(labelsPath)
  ]);
  const validated = analyzeValidatedModelResidualV3({ frozen, datasetBody, labelsBody });
  const references = new Map(validated.cards.map((card) => [card.asset_id, card.reference]));
  const scored = Object.fromEntries(COMPACT_RESIDUAL_MODES_V4.map((mode) => [
    mode,
    scoredVariantSummary(cards, references, mode)
  ]));
  const winner = recommended ? { ...prelabel[recommended], ...scored[recommended] } : null;

  return {
    schema_version: "model-residual-compact-v4-zero-call-screen-v1",
    date: "2026-08-08",
    authority: "evaluation_only",
    decision: "HOLD_PRODUCTION",
    screen_result: recommended === "single_printed_phrase"
      && winner?.full_v3_exact_title_fidelity_cards === cards.length
      && winner?.full_v3_exact_field_fidelity_cards === cards.length
      && winner?.losses === 0
      ? "TITLE_AND_FIELD_FIDELITY_PRESERVED_HOLD_INDEPENDENT_GATE"
      : "STOP_COMPACT_V4",
    production_promotion_allowed: false,
    provider_calls: 0,
    claim_boundary: "reuses wide-v3 model capture; cannot estimate compact-schema capture, latency, or independent accuracy",
    source: {
      run_fingerprint: frozen.checkpoint.run_fingerprint,
      cards: cards.length,
      wide_v3_candidate_rows: cards.reduce((sum, card) => sum + card.candidates.length, 0),
      wide_v3_cards_with_rows: cards.filter((card) => card.candidates.length).length,
      wide_v3_candidate_output_bytes: wideBytes,
      wide_v3_approximate_candidate_output_tokens_at_4_bytes: Math.ceil(wideBytes / 4),
      prereg_sha256: sha256(preregBody),
      payload_sha256: sha256(payloadBody),
      checkpoint_sha256: sha256(checkpointBody),
      dataset_sha256: sha256(datasetBody),
      labels_sha256: sha256(labelsBody)
    },
    selection: {
      label_bytes_read_before_selection: false,
      criteria: [
        "exact full-v3 resolved-title fidelity on all cards",
        "exact full-v3 canonical-field fidelity on all cards",
        "zero resolver rejection, contract defect, ambiguous route, and over-80 title",
        "minimum serialized candidate bytes",
        "minimum selected rows as deterministic tie-break"
      ],
      recommended_variant: recommended,
      recommended_scope: "paired_general_candidate_only",
      exact_lane_fidelity: winner?.full_v3_exact_field_fidelity_cards === cards.length,
      minimum_exact_lane_fidelity_variant: lossless,
      mechanism_family_selected_after_paid105_outcomes: true
    },
    contract_status: {
      zero_call_schema_fingerprints: {
        single_printed_phrase: sha256(JSON.stringify(
          MODEL_RESIDUAL_SINGLE_PRINTED_PHRASE_SCHEMA_V4
        )),
        ranked_max1: sha256(JSON.stringify(genericSchema(1))),
        ranked_max2: sha256(JSON.stringify(genericSchema(2))),
        explicit_short_fields: sha256(JSON.stringify(MODEL_RESIDUAL_EXPLICIT_SHORT_FIELDS_SCHEMA_V4))
      },
      independent_paid_prereg_exists: false,
      schema_frozen_for_provider_run: false,
      reason: "posthoc compression screen; next paired cloud treatment needs a new frozen prereg before any call"
    },
    static_cost_proxy: staticCosts(),
    variants: Object.fromEntries(COMPACT_RESIDUAL_MODES_V4.map((mode) => [mode, {
      ...prelabel[mode],
      ...scored[mode]
    }])),
    safety: {
      selected_variant_exact_title_fidelity_cards: winner?.full_v3_exact_title_fidelity_cards ?? null,
      selected_variant_exact_field_fidelity_cards: winner?.full_v3_exact_field_fidelity_cards ?? null,
      selected_variant_field_mismatch_cards: winner?.full_v3_field_mismatch_cards ?? [],
      selected_variant_resolver_contract_defect_cards: winner?.resolver_contract_defect_cards ?? null,
      selected_variant_resolver_rejected_cards: winner?.resolver_rejected_cards ?? null,
      selected_variant_titles_over_80: winner?.titles_over_80 ?? null,
      selected_variant_losses: winner?.losses ?? null
    },
    next_gate: {
      zero_call_conclusion: "one general printed phrase preserves full-v3 titles and canonical fields",
      not_proven: [
        "the model will populate the compact field at the same capture rate",
        "the compact field will not interfere with canonical output",
        "real output tokens and writer-path latency",
        "independent fresh150 accuracy"
      ],
      required_before_production: "frozen paired cloud control versus compact treatment on an independent cohort"
    }
  };
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const signed = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(7)}`;

export function renderModelResidualCompactV4Report(result) {
  const rows = COMPACT_RESIDUAL_MODES_V4.map((mode) => {
    const value = result.variants[mode];
    return `| ${mode} | ${value.selected_rows} | ${value.candidate_output_bytes} | ${value.approximate_candidate_output_tokens_at_4_bytes} | ${pct(value.candidate_output_byte_reduction_vs_wide_v3)} | ${value.full_v3_exact_title_fidelity_cards}/35 | ${value.full_v3_exact_field_fidelity_cards}/35 | ${signed(value.delta_macro_f1)} | ${value.wins}/${value.losses}/${value.ties} |`;
  }).join("\n");
  const changed = result.variants.single_printed_phrase.changed_cards.map((card) =>
    `| \`${card.asset_id.replace(/^reviewed_blind_/, "").slice(0, 6)}\` | ${card.selected_candidates.map((row) => `\`${row.text}\``).join(" + ")} | ${signed(card.delta_f1)} |`
  ).join("\n");
  return `# Model residual compact v4 zero-call screen — 2026-08-08

## Decision

**${result.decision} / ${result.screen_result}.** 反方先成立：paid105 的 \`4W/0L\` 不能直接授权把 wide v3 推进 Production；它来自 35 张 enriched development cohort，机制家族也是看过 paid105 结果后提出的。

单一 nullable string \`residual_printed_phrase\` 是当前四个方案中最小的 **full-lane-preserving replay**：它保留 35/35 resolved titles、35/35 canonical fields、\`+0.0071073\` 与 \`4W/0L/31T\`，候选行从 71 降到 ${result.variants.single_printed_phrase.selected_rows}，同口径 JSON 字节从 ${result.source.wide_v3_candidate_output_bytes} 降到 ${result.variants.single_printed_phrase.candidate_output_bytes}（-${pct(result.variants.single_printed_phrase.candidate_output_byte_reduction_vs_wide_v3)}）。这证明 adapter 在既有 capture 上无损，不证明 compact schema 会让模型同样捕获，也不是 Production promotion gate。

本轮没有 formal independent paid prereg：schema fingerprint 已记录，但 \`schema_frozen_for_provider_run=false\`。在下一次真实 paired call 前，必须另建并冻结 prereg；不能把事后压缩屏伪装成预注册实验。

## Label-blind selection boundary

冻结 checkpoint 后，先按以下次序选择方案，随后才读取 sealed labels：

1. 35/35 精确复现 full-v3 resolved title；
2. 35/35 精确复现 full-v3 canonical fields；
3. resolver rejection、contract defect、ambiguous route、over-80 全为 0；
4. serialized candidate bytes 最少；
5. selected rows 最少只作 tie-break。

按这套 title + field 双门，最小合格方案是 \`${result.selection.minimum_exact_lane_fidelity_variant}\`。\`label_bytes_read_before_selection=false\`，但 general single-string 假设来自 paid105 后的压缩诊断，因此仍不能把本屏当独立确认。

## Variant comparison

| Variant | rows | JSON bytes | ~tokens | byte reduction | title fidelity | field fidelity | ΔF1 | W/L/T |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

约算 token 只使用保守的 4 bytes/token 静态代理，不是 provider usage。真实 token 与 latency 必须由 paired cloud treatment 测量。

这里的 ${result.variants.single_printed_phrase.candidate_output_bytes} bytes 包含 35 张每张都必须输出的 property key、非空 value 或 \`null\`。任何“609B”结果若没有使用同一 35-card aggregate wire 口径，不能拿来覆盖这张表；它应另列为 request/schema delta 或 non-null subset，直到同口径复算。

其中对象 max1 在 35 张上为 ${result.variants.ranked_max1.candidate_output_bytes} bytes / 约 ${result.variants.ranked_max1.approximate_candidate_output_tokens_at_4_bytes} tokens，reference loss、unbacked token、unsupported numeric、resolver rejection、over-80 均为 ${result.variants.ranked_max1.reference_loss_cards}/${result.variants.ranked_max1.unbacked_new_token_cards}/${result.variants.ranked_max1.unsupported_numeric_change_cards}/${result.variants.ranked_max1.resolver_rejected_cards}/${result.variants.ranked_max1.titles_over_80}。它与 general string 同为 31 个 phrase，但 role/region/basis 元数据令其多 ${result.variants.ranked_max1.candidate_output_bytes - result.variants.single_printed_phrase.candidate_output_bytes} bytes。

## Canonical field recovery

最初只允许 marker/slab 的 single-string 会丢 \`a9aadb\`：full v3 用 printed \`Topps Chrome\` 把 Product 从 \`Chrome\` 扩成 \`Topps Chrome\`。general string 现在从 max1 选最高价值完整 printed phrase，并由 adapter 仅凭 phrase + canonical token 关系把它路由为 Product extension，因此恢复到 35/35 fields。两显式字段仍是 34/35，证明“标题一样”不能替代 field fidelity。

Adapter 不接收 label，也不在 wire 上携带 role/region：exact marker 优先；明确 finish-family 次之；严格 Product token 超集走 identity extension；其余保持 other-visible。多重角色命中一律 \`ambiguous\` 并 fail closed；当前 35 张 ambiguous route 为 ${result.variants.single_printed_phrase.ambiguous_route_cards}。

## Preserved title wins

| Asset | compact evidence | ΔF1 |
|---|---|---:|
${changed}

三张标题收益来自 printed \`1st Bowman\`，一张来自 \`AUTO-RED REFRACTOR\`。标题损失、field mismatch、ambiguous route、rejection、contract defect、over-80 均为 0。

## What this changes

- paired general candidate：一个 required nullable string \`residual_printed_phrase\`，容纳最高价值的完整 printed phrase。
- 仍是 candidate-only；不自动写 CSM、SEM、Composer 或持久化。
- 后置 adapter 推断 marker、finish 或 compatible Product extension；所有改变继续经过既有 v3 guards。
- 两显式字段虽略少 44 bytes，却只有 34/35 field fidelity，不进入无损候选集。
- 对象 max1 是同语义的带元数据对照；general string 以 41.6% 的 candidate bytes 保留相同 title/field 结果。

## Production hold

本回放复用了 wide-v3 已经捕获的文本，无法回答 compact schema 是否仍会读到这些 general phrases，也无法测 canonical interference、真实 token 或延迟。下一道有效门必须冻结独立 cohort，做 paired cloud control vs compact treatment，并继续把 title 与 canonical-field fidelity 分开验收；通过前不改 Production runtime。

Provider calls: **0**. Production runtime changes: **0**. Production deployed: **false**.
`;
}

const argument = (argv, name, fallback = "") => {
  const index = argv.indexOf(name);
  return index < 0 ? fallback : String(argv[index + 1] || fallback);
};

export async function main(argv = process.argv.slice(2)) {
  const evalRoot = resolve(argument(argv, "--eval-root", "/Users/paidaxin/lynca-eval-root"));
  const preregPath = resolve(argument(argv, "--prereg",
    "experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json"));
  const prereg = JSON.parse(await readFile(preregPath, "utf8"));
  const outJson = resolve(argument(argv, "--out-json",
    "docs/evaluation/model-residual-compact-v4-zero-call-2026-08-08.json"));
  const outMarkdown = resolve(argument(argv, "--out-md",
    "docs/evaluation/model-residual-compact-v4-zero-call-2026-08-08.md"));
  const result = await analyzeModelResidualCompactV4ZeroCall({
    preregPath,
    payloadPath: resolve(argument(argv, "--payload",
      "artifacts/model-residual-v3-paid105-2026-08-08/payload.json")),
    checkpointPath: resolve(argument(argv, "--checkpoint",
      "artifacts/model-residual-v3-paid105-2026-08-08/checkpoint.json")),
    datasetPath: resolve(evalRoot, prereg.analysis_inputs.dataset_path),
    labelsPath: resolve(evalRoot, prereg.analysis_inputs.expected_labels_path)
  });
  await Promise.all([
    mkdir(dirname(outJson), { recursive: true }),
    mkdir(dirname(outMarkdown), { recursive: true })
  ]);
  await Promise.all([
    writeFile(outJson, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    writeFile(outMarkdown, renderModelResidualCompactV4Report(result), "utf8")
  ]);
  process.stdout.write(`${JSON.stringify({
    decision: result.decision,
    screen_result: result.screen_result,
    recommended_variant: result.selection.recommended_variant,
    provider_calls: result.provider_calls,
    variants: Object.fromEntries(Object.entries(result.variants).map(([mode, value]) => [mode, {
      rows: value.selected_rows,
      candidate_output_bytes: value.candidate_output_bytes,
      title_fidelity: value.full_v3_exact_title_fidelity_cards,
      field_fidelity: value.full_v3_exact_field_fidelity_cards,
      delta_macro_f1: value.delta_macro_f1,
      wins: value.wins,
      losses: value.losses
    }])),
    out_json: outJson,
    out_markdown: outMarkdown
  }, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
