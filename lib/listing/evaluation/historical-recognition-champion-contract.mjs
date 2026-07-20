function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const historicalRecognitionChampionContract = deepFreeze({
  schema_version: "historical-recognition-champions-user-locked-v1",
  locked_at: "2026-07-19",
  authority: "EXPLICIT_USER_DECISION",
  metric: "historical_token_recall",
  champions: {
    targeted_8: {
      role: "targeted_sample_champion",
      sample_count: 8,
      token_recall: 0.909821,
      evidence_file: "new30-c-smoke-targeted-8-e9423c8-final.json"
    },
    formal_30: {
      role: "formal_30_champion",
      sample_count: 30,
      token_recall: 0.903653,
      evidence_file: "new30-c-catalog-vector-hard-anchor-b98f9tje7-final.json"
    },
    stable_30: {
      role: "stable_30_champion",
      sample_count: 30,
      token_recall: 0.89818,
      evidence_file: "new30-c-catalog-vector-subject-token-l37nwmh1m-final.json"
    }
  },
  exclusions: {
    proxy_selected_096_to_098: {
      eligible: false,
      reason: "REFERENCE_TITLE_INFLUENCED_CANDIDATE_SELECTION",
      raw_blind_output_range: [0.74, 0.76]
    },
    legacy_0912_waterline: {
      eligible_as_replacement: false,
      role: "HISTORICAL_TARGET_WATERLINE_ONLY"
    }
  },
  mutation_policy: {
    automatic_recalculation_allowed: false,
    replacement_requires_user_confirmation: true,
    comparable_evidence_requires_same_metric: true,
    comparable_evidence_requires_no_reference_leakage: true
  },
  architecture_boundary: {
    port_actions_not_endpoints: true,
    strategy_and_execution_chain_decoupled: true,
    reusable_mechanisms: [
      "CATALOG_HARD_CONSTRAINTS",
      "CURRENT_IMAGE_DIRECT_EVIDENCE_GUARD",
      "DETERMINISTIC_RENDERING",
      "STABLE_CATALOG_VECTOR"
    ]
  }
});

export function assertHistoricalRecognitionChampionContract(contract = historicalRecognitionChampionContract) {
  const expected = [
    ["targeted_8", 8, 0.909821, "new30-c-smoke-targeted-8-e9423c8-final.json"],
    ["formal_30", 30, 0.903653, "new30-c-catalog-vector-hard-anchor-b98f9tje7-final.json"],
    ["stable_30", 30, 0.89818, "new30-c-catalog-vector-subject-token-l37nwmh1m-final.json"]
  ];
  if (contract.authority !== "EXPLICIT_USER_DECISION") {
    throw new Error("Historical recognition champions must retain explicit user authority.");
  }
  for (const [key, sampleCount, tokenRecall, evidenceFile] of expected) {
    const row = contract.champions?.[key];
    if (!row
      || row.sample_count !== sampleCount
      || row.token_recall !== tokenRecall
      || row.evidence_file !== evidenceFile) {
      throw new Error(`Historical recognition champion drift: ${key}.`);
    }
  }
  if (contract.mutation_policy?.automatic_recalculation_allowed !== false
    || contract.mutation_policy?.replacement_requires_user_confirmation !== true
    || contract.architecture_boundary?.strategy_and_execution_chain_decoupled !== true) {
    throw new Error("Historical recognition champion governance drift.");
  }
  return true;
}
