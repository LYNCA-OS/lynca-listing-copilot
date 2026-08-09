// CSM Glass Box — the operator's view of field-level resolution. COS-42 stage 1.
//
// Renders one CsmResolutionView. It reads; it does not resolve. Every value,
// state and disposition here comes from the server-composed contract, because a
// UI that recomputed any of it would eventually explain a title the pipeline
// never produced.
//
// Three things this panel refuses to make look better than they are:
//
//   * An empty bracket says WHICH kind of empty. "The card has no serial" and
//     "we could not read the serial" are different failures with different
//     fixes, and one label for both hides the second.
//   * The alternatives column stays empty and says why. The resolver makes one
//     whole-card observation; a populated-looking column would imply a
//     multi-source conflict resolver that does not exist.
//   * A bracket the composer places but the grammar does not name is marked.
//     Today that is Visible Components (COS-41), and an operator reading a
//     title containing RC deserves to know the position is an inference.

const STATE_LABEL = Object.freeze({
  VALUE: "已识别",
  ABSENT: "卡上没有",
  INSUFFICIENT_EVIDENCE: "看不清"
});

const DISPOSITION_LABEL = Object.freeze({
  INCLUDED: "已进标题",
  SUPPRESSED_BY_PROFILE: "档位压制",
  DROPPED_FOR_BUDGET: "预算丢弃",
  RESTORED: "已恢复",
  NORMALIZED: "已规范化",
  NOT_APPLICABLE: "—"
});

const RATIONALE_LABEL = Object.freeze({
  OBSERVED: "读到了",
  MODEL_REPORTED_UNREADABLE: "模型报告读不出",
  MODEL_REPORTED_LOW_CONFIDENCE: "模型报告不确定",
  WITHHELD_BASE_APPEARANCE: "识别到但判为产品基础外观，未晋升",
  EXACT_EXTERNAL_IDENTITY_SUPPORT: "外部身份来源精确核验",
  NOT_OBSERVED: "未观察到"
});

const EXTERNAL_FIELD_LABEL = Object.freeze({
  year: "年份",
  manufacturer: "厂商",
  product: "产品",
  set: "系列",
  subjects: "人物",
  team: "球队",
  card_number: "卡号"
});

const escape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function bracketRowHtml(bracket) {
  const empty = bracket.state !== "VALUE";
  const classes = [
    "glass-box-row",
    empty ? `glass-box-${bracket.state.toLowerCase()}` : "",
    bracket.composer_disposition === "SUPPRESSED_BY_PROFILE" ? "glass-box-suppressed" : "",
    bracket.composer_disposition === "DROPPED_FOR_BUDGET" ? "glass-box-dropped" : "",
    bracket.outside_contract_order ? "glass-box-outside-contract" : ""
  ].filter(Boolean).join(" ");

  return `
    <tr class="${classes}" data-bracket="${escape(bracket.bracket)}">
      <th scope="row">
        ${escape(bracket.label)}
        ${bracket.outside_contract_order
          ? '<abbr title="Composer 放置了这个 bracket，但语法顺序里没有它。位置是推断的 —— COS-41。">契约外</abbr>'
          : ""}
      </th>
      <td class="glass-box-value">${empty
        ? `<span class="glass-box-state">${escape(STATE_LABEL[bracket.state] || bracket.state)}</span>`
        : escape(bracket.value)}</td>
      <td>${escape(DISPOSITION_LABEL[bracket.composer_disposition] || bracket.composer_disposition)}</td>
      <td class="glass-box-why">
        ${bracket.rationale_codes.map((code) => escape(RATIONALE_LABEL[code] || code)).join("；")}
        ${bracket.evidence?.withheld_observation
          ? `<small>观察到：${escape(bracket.evidence.withheld_observation)}</small>`
          : ""}
      </td>
      <td>${bracket.semantic_confidence === "LOW"
        ? '<span class="glass-box-low-confidence">低</span>'
        : escape(bracket.semantic_confidence || "—")}</td>
    </tr>
  `;
}

function externalIdentityHtml(support) {
  if (support?.status !== "APPLIED" || !Array.isArray(support.sources) || !support.sources.length) return "";
  const fields = (Array.isArray(support.supported_fields) ? support.supported_fields : [])
    .map((field) => EXTERNAL_FIELD_LABEL[field] || field).join("、");
  const matchBasis = support.match_basis === "VERIFIED_ORIGINAL_SET"
    ? "已验证原图集合"
    : support.match_basis === "EXACT_FOUR_ANCHOR" ? "四字段精确锚点" : "";
  if (!matchBasis) return "";
  return `
      <section class="glass-box-external" aria-label="外部身份来源">
        <div class="glass-box-external-heading">
          <strong>外部身份已核验</strong>
          <span>APPLIED</span>
        </div>
        <p>以下字段由 source-versioned exact identity receipt 支持：${escape(fields || "—")}。</p>
        <dl class="glass-box-external-versions">
          <div><dt>Match basis</dt><dd>${escape(matchBasis)}</dd></div>
          <div><dt>Registry release</dt><dd><code>${escape(support.registry_release?.id)}</code></dd></div>
          <div><dt>Index</dt><dd><code>${escape(support.index?.version)}</code></dd></div>
          <div><dt>Resolver</dt><dd><code>${escape(support.resolver_version)}</code></dd></div>
        </dl>
        <ul class="glass-box-external-sources">${support.sources.map((source) => `
          <li>
            <a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.provider)}</a>
            <code>${escape(source.source_id)}</code>
            <small>${escape(source.retrieved_at)} · ${escape((Array.isArray(source.fields) ? source.fields : []).map((field) => EXTERNAL_FIELD_LABEL[field] || field).join("、"))}</small>
          </li>`).join("")}
        </ul>
      </section>`;
}

export function renderCsmGlassBox(view, { assetIndex } = {}) {
  if (!view || !Array.isArray(view.brackets)) return "";
  const s = view.summary || {};
  const unreliable = view.composer && view.composer.trace_reliable === false;

  return `
    <details class="glass-box" data-glass-box="${escape(assetIndex)}">
      <summary>
        字段级解析
        <span class="glass-box-counts">
          已识别 ${s.with_value ?? 0} · 卡上没有 ${s.absent ?? 0} · 看不清 ${s.insufficient_evidence ?? 0}
          ${s.suppressed_by_profile ? ` · 档位压制 ${s.suppressed_by_profile}` : ""}
          ${s.dropped_for_budget ? ` · 预算丢弃 ${s.dropped_for_budget}` : ""}
        </span>
      </summary>

      ${unreliable ? `
        <p class="glass-box-warning" role="status">
          存档标题与当前 Composer 重算的结果不一致，下面的取舍轨迹描述的不是已发布的那条标题。
        </p>` : ""}

      <dl class="glass-box-grammar">
        <div><dt>语法</dt><dd>${escape(view.grammar?.value)}${view.grammar?.review_required ? "（需复核）" : ""}</dd></div>
        <div><dt>解析器</dt><dd>${escape(view.grammar?.resolver_version)}</dd></div>
        <div><dt>字符预算</dt><dd>${escape(view.composer?.length)} / ${escape(view.composer?.character_budget)}</dd></div>
      </dl>

      ${externalIdentityHtml(view.external_identity_support)}

      <table class="glass-box-table">
        <thead>
          <tr><th scope="col">Bracket</th><th scope="col">值</th><th scope="col">Composer</th><th scope="col">依据</th><th scope="col">置信</th></tr>
        </thead>
        <tbody>${view.brackets.map(bracketRowHtml).join("")}</tbody>
      </table>

      <p class="glass-box-footnote">
        ${view.external_identity_support?.status === "APPLIED"
          ? "本次解析应用了经过 allowlist 的外部身份来源；页面只展示来源摘要，不展示原始 Registry payload。"
          : `本解析器每张卡只做一次整卡观察，因此没有备选候选可比对
        （<code>${escape(view.brackets[0]?.alternates_unavailable_reason || "SINGLE_OBSERVATION_RESOLVER")}</code>）。`}
        这里展示的是决策轨迹，不是模型的内部推理过程。
      </p>
    </details>
  `;
}

/** Fetch one view. Read-only: this never triggers a provider call. */
export async function loadCsmResolutionView(assetId, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(`/api/csm-resolution-view?asset_id=${encodeURIComponent(assetId)}`, {
    headers: { accept: "application/json" }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`csm_resolution_view_${response.status}`);
  return response.json();
}
