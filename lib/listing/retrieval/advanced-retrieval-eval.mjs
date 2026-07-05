export const advancedRetrievalAblationSteps = Object.freeze([
  {
    step: "A",
    name: "Vector only",
    enables: ["front_image_vector"]
  },
  {
    step: "B",
    name: "Front + Back multi-vector",
    enables: ["front_image_vector", "back_image_vector"]
  },
  {
    step: "C",
    name: "B + OCR exact retrieval",
    enables: ["front_image_vector", "back_image_vector", "ocr_exact_code"]
  },
  {
    step: "D",
    name: "C + RRF",
    enables: ["front_image_vector", "back_image_vector", "ocr_exact_code", "reciprocal_rank_fusion"]
  },
  {
    step: "E",
    name: "D + structured reranker",
    enables: ["front_image_vector", "back_image_vector", "ocr_exact_code", "reciprocal_rank_fusion", "structured_reranker"]
  },
  {
    step: "F",
    name: "E + pHash / geometric verification",
    enables: ["front_image_vector", "back_image_vector", "ocr_exact_code", "reciprocal_rank_fusion", "structured_reranker", "visual_fingerprint", "geometric_verification"]
  },
  {
    step: "G",
    name: "F + hard-negative reranker",
    enables: ["front_image_vector", "back_image_vector", "ocr_exact_code", "reciprocal_rank_fusion", "structured_reranker", "visual_fingerprint", "geometric_verification", "hard_negative_reranker"]
  }
]);

function cleanText(value) {
  return String(value || "").trim();
}

function identitySet(rows = [], k = 10) {
  return new Set(
    (Array.isArray(rows) ? rows : [])
      .slice(0, Math.max(0, Number(k) || 0))
      .map((row) => cleanText(row.candidate_identity_id || row.identity_id || row.card_identity_id))
      .filter(Boolean)
  );
}

export function annRecallAtK({ annResults = [], exactResults = [], k = 10 } = {}) {
  const exact = identitySet(exactResults, k);
  if (!exact.size) return 0;
  const ann = identitySet(annResults, k);
  const hits = [...exact].filter((identityId) => ann.has(identityId)).length;
  return hits / exact.size;
}

export function summarizeAnnRecallAudit({
  hnswResults = [],
  exactResults = [],
  indexLatencyMs = null,
  exactLatencyMs = null,
  sampleCount = null
} = {}) {
  return {
    ann_recall_at_1: Number(annRecallAtK({ annResults: hnswResults, exactResults, k: 1 }).toFixed(4)),
    ann_recall_at_5: Number(annRecallAtK({ annResults: hnswResults, exactResults, k: 5 }).toFixed(4)),
    ann_recall_at_10: Number(annRecallAtK({ annResults: hnswResults, exactResults, k: 10 }).toFixed(4)),
    index_latency_ms: Number.isFinite(Number(indexLatencyMs)) ? Number(indexLatencyMs) : null,
    exact_latency_ms: Number.isFinite(Number(exactLatencyMs)) ? Number(exactLatencyMs) : null,
    sample_count: Number.isFinite(Number(sampleCount)) ? Number(sampleCount) : Math.max(hnswResults.length, exactResults.length)
  };
}

function resultKey(item = {}) {
  return cleanText(item.query_id || item.asset_id || item.id);
}

function correctness(item = {}) {
  if (typeof item.correct === "boolean") return item.correct;
  if (typeof item.ai_card_exact === "boolean") return item.ai_card_exact;
  return false;
}

export function summarizeAblationDelta({ baselineItems = [], candidateItems = [] } = {}) {
  const baselineByKey = new Map((Array.isArray(baselineItems) ? baselineItems : []).map((item) => [resultKey(item), item]));
  let recovery = 0;
  let regression = 0;
  let unchangedCorrect = 0;
  let unchangedIncorrect = 0;

  (Array.isArray(candidateItems) ? candidateItems : []).forEach((candidate) => {
    const key = resultKey(candidate);
    if (!key || !baselineByKey.has(key)) return;
    const before = correctness(baselineByKey.get(key));
    const after = correctness(candidate);
    if (!before && after) recovery += 1;
    else if (before && !after) regression += 1;
    else if (before && after) unchangedCorrect += 1;
    else unchangedIncorrect += 1;
  });

  return {
    recovery,
    regression,
    net_benefit: recovery - regression,
    unchanged_correct: unchangedCorrect,
    unchanged_incorrect: unchangedIncorrect,
    default_enable_allowed: recovery - regression > 0 && regression === 0
  };
}
