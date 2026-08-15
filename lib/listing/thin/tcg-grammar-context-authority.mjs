import { createHash } from "node:crypto";

export const TCG_GRAMMAR_CONTEXT_REGISTRY_SCHEMA_VERSION =
  "tcg-grammar-context-registry.v1";
export const TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_ID =
  "registry_tcg_grammar_context_trainer_gallery_v1";
export const TCG_GRAMMAR_CONTEXT_POLICY_VERSION =
  "tcg-grammar-context-policy-v1";
export const TCG_GRAMMAR_CONTEXT_RESOLVER_VERSION =
  "thin-path-tcg-grammar-context-v1";
export const TCG_GRAMMAR_CONTEXT_NORMALIZATION_VERSION =
  "tcg-grammar-context-normalization-v1";
export const TCG_FIELD_SOURCE_AUTHORITY_RECEIPT_VERSION =
  "tcg-field-source-authority-receipt.v1";
export const TCG_GRAMMAR_CONTEXT_CLAIM_RECEIPT_VERSION =
  "tcg-grammar-context-claim-receipt.v1";
export const TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT_SCHEMA_VERSION =
  "tcg-grammar-context-resolution-contract.v1";

const DECISION_DOCUMENT_SHA256 =
  "e3bdcbee1b37c17fda2446b1f877ee652b230b35e9e089290433c50410b63705";
const CLAIM_ID = "trainer-gallery-tg30-membership-v1";
const TRACKED_FIELDS = Object.freeze(["card_number", "set"]);
const GRAMMARS = new Set(["standard", "tcg", "lot"]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(
    typeof value === "string" ? value : stableJson(value),
    "utf8"
  ).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clean(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}

function requiredSha256(value, name) {
  const text = clean(value).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new TypeError(`${name}_invalid`);
  return text;
}

function normalizedImageFingerprints(values, name) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 2) {
    throw new TypeError(`${name}_invalid`);
  }
  return values.map((value) => {
    const fingerprint = clean(value).toLowerCase();
    if (!/^sha256:[0-9a-f]{64}$/.test(fingerprint)) {
      throw new TypeError(`${name}_invalid`);
    }
    return fingerprint;
  });
}

export function tcgGrammarContextSessionIdentitySha256({
  tenantId,
  recognitionSessionId
} = {}) {
  const tenant = clean(tenantId);
  const session = clean(recognitionSessionId);
  if (!tenant) throw new TypeError("tcg_tenant_id_invalid");
  if (!session) throw new TypeError("tcg_recognition_session_id_invalid");
  return sha256({
    recognition_session_id: session,
    tenant_id: tenant
  });
}

export function tcgGrammarContextSourceExecutionBinding({
  operationPayloadSha256,
  originalImageFingerprints,
  recognitionImageFingerprints,
  providerClientRequestId,
  providerResponseId,
  tenantId,
  recognitionSessionId
} = {}) {
  const clientRequestId = clean(providerClientRequestId);
  const responseId = clean(providerResponseId);
  if (!clientRequestId) throw new TypeError("tcg_provider_client_request_id_invalid");
  if (!responseId) throw new TypeError("tcg_provider_response_id_invalid");
  return deepFreeze({
    operation_payload_sha256: requiredSha256(
      operationPayloadSha256,
      "tcg_operation_payload_sha256"
    ),
    original_image_fingerprints_sha256: sha256(normalizedImageFingerprints(
      originalImageFingerprints,
      "tcg_original_image_fingerprints"
    )),
    recognition_image_fingerprints_sha256: sha256(normalizedImageFingerprints(
      recognitionImageFingerprints,
      "tcg_recognition_image_fingerprints"
    )),
    provider_client_request_id_sha256: sha256(clientRequestId),
    provider_response_id_sha256: sha256(responseId),
    session_identity_sha256: tcgGrammarContextSessionIdentitySha256({
      tenantId,
      recognitionSessionId
    })
  });
}

function sealedReceipt(payload) {
  return deepFreeze({
    ...payload,
    receipt_sha256: sha256(payload)
  });
}

const REGISTRY_PAYLOAD = {
  schema_version: TCG_GRAMMAR_CONTEXT_REGISTRY_SCHEMA_VERSION,
  release_id: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE_ID,
  policy_version: TCG_GRAMMAR_CONTEXT_POLICY_VERSION,
  normalization_version: TCG_GRAMMAR_CONTEXT_NORMALIZATION_VERSION,
  decision_document_sha256: DECISION_DOCUMENT_SHA256,
  records: [{
    claim_id: CLAIM_ID,
    set: "Trainer Gallery",
    member_prefix: "TG",
    denominator: "TG30",
    minimum_ordinal: 1,
    maximum_ordinal: 30,
    authoring_scope: "GRAMMAR_ONLY",
    resolved_grammar: "tcg",
    ip_action: "UNCHANGED"
  }]
};

export const TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE = deepFreeze({
  ...REGISTRY_PAYLOAD,
  content_sha256: sha256(REGISTRY_PAYLOAD)
});

const RESOLUTION_CONTRACT_PAYLOAD = {
  schema_version: TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT_SCHEMA_VERSION,
  contract_id: "lynca.csm.tcg-grammar-context.closed-transition.v1",
  registry_release_id: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
  registry_content_sha256: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.content_sha256,
  resolver_version: TCG_GRAMMAR_CONTEXT_RESOLVER_VERSION,
  conflict_policy_version: TCG_GRAMMAR_CONTEXT_POLICY_VERSION,
  field_source_authority_receipt_schema_version:
    TCG_FIELD_SOURCE_AUTHORITY_RECEIPT_VERSION,
  grammar_context_claim_receipt_schema_version:
    TCG_GRAMMAR_CONTEXT_CLAIM_RECEIPT_VERSION,
  transition: {
    raw_grammar: "standard",
    resolved_grammar: "tcg",
    mutable_fields: ["grammar"],
    ip_action: "UNCHANGED",
    web_authority_used: false
  }
};

export const TCG_GRAMMAR_CONTEXT_RESOLUTION_CONTRACT = deepFreeze({
  ...RESOLUTION_CONTRACT_PAYLOAD,
  contract_sha256: sha256(RESOLUTION_CONTRACT_PAYLOAD)
});

function normalizedFieldSources(fieldSources) {
  if (!Array.isArray(fieldSources)) {
    throw new TypeError("tcg_field_sources_invalid");
  }
  const byField = new Map();
  for (const row of fieldSources) {
    const field = clean(row?.field);
    if (!field || !Array.isArray(row?.source_ids)) {
      throw new TypeError("tcg_field_sources_invalid");
    }
    const ids = byField.get(field) || [];
    for (const sourceId of row.source_ids) {
      const normalized = clean(sourceId);
      if (!normalized) continue;
      if (!ids.includes(normalized)) ids.push(normalized);
    }
    byField.set(field, ids);
  }
  return [...byField].sort(([left], [right]) => left.localeCompare(right)).map(
    ([field, sourceIds]) => ({ field, source_ids: [...sourceIds].sort() })
  );
}

function authorizedFieldValues(fields) {
  return Object.fromEntries(TRACKED_FIELDS.map((field) => [
    field,
    clean(fields?.[field])
  ]));
}

export function buildTcgFieldSourceAuthorityReceipt({
  fieldSources,
  fields,
  originalImageCount,
  semanticStateSha256,
  founderBetaWebReceipt,
  sourceExecution
} = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    throw new TypeError("tcg_authorized_field_values_invalid");
  }
  const imageCount = Number(originalImageCount);
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 2) {
    throw new TypeError("tcg_original_image_count_invalid");
  }
  const normalized = normalizedFieldSources(fieldSources);
  const allowedImages = new Set(Array.from(
    { length: imageCount }, (_, index) => `original_image_${index + 1}`
  ));
  const fieldAuthority = TRACKED_FIELDS.map((field) => {
    const sourceIds = normalized.find((row) => row.field === field)?.source_ids || [];
    return {
      field,
      current_image_source_present: sourceIds.some((id) => allowedImages.has(id)),
      web_source_present: sourceIds.some((id) => !allowedImages.has(id))
    };
  });
  const currentImageAuthority = fieldAuthority.every(
    (row) => row.current_image_source_present
  );
  return sealedReceipt({
    schema_version: TCG_FIELD_SOURCE_AUTHORITY_RECEIPT_VERSION,
    source_audit_version: "tcg-field-source-audit-v1",
    authorized_field_values_sha256: sha256(authorizedFieldValues(fields)),
    semantic_state_sha256: requiredSha256(
      semanticStateSha256,
      "tcg_semantic_state_sha256"
    ),
    normalized_field_sources_sha256: sha256(normalized),
    founder_beta_web_receipt_sha256: sha256(founderBetaWebReceipt),
    ...tcgGrammarContextSourceExecutionBinding(sourceExecution),
    field_authority: fieldAuthority,
    authority_used: currentImageAuthority ? "CURRENT_IMAGE" : "ABSTAIN"
  });
}

export function validateTcgFieldSourceAuthorityReceipt(receipt, {
  founderBetaWebReceipt = undefined,
  fields = undefined,
  sourceExecution = undefined
} = {}) {
  const keys = [
    "authority_used", "authorized_field_values_sha256", "field_authority",
    "founder_beta_web_receipt_sha256", "normalized_field_sources_sha256",
    "operation_payload_sha256", "original_image_fingerprints_sha256",
    "provider_client_request_id_sha256", "provider_response_id_sha256",
    "receipt_sha256", "recognition_image_fingerprints_sha256", "schema_version",
    "semantic_state_sha256", "session_identity_sha256", "source_audit_version"
  ];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || stableJson(Object.keys(receipt).sort()) !== stableJson(keys)
      || receipt.schema_version !== TCG_FIELD_SOURCE_AUTHORITY_RECEIPT_VERSION
      || receipt.source_audit_version !== "tcg-field-source-audit-v1"
      || !["CURRENT_IMAGE", "ABSTAIN"].includes(receipt.authority_used)
      || !Array.isArray(receipt.field_authority)
      || stableJson(receipt.field_authority.map((row) => row?.field))
        !== stableJson(TRACKED_FIELDS)
      || receipt.field_authority.some((row) => (
        stableJson(Object.keys(row || {}).sort()) !== stableJson([
          "current_image_source_present", "field", "web_source_present"
        ])
        || typeof row.current_image_source_present !== "boolean"
        || typeof row.web_source_present !== "boolean"
      ))
      || [
        receipt.authorized_field_values_sha256,
        receipt.semantic_state_sha256,
        receipt.normalized_field_sources_sha256,
        receipt.founder_beta_web_receipt_sha256,
        receipt.operation_payload_sha256,
        receipt.original_image_fingerprints_sha256,
        receipt.recognition_image_fingerprints_sha256,
        receipt.provider_client_request_id_sha256,
        receipt.provider_response_id_sha256,
        receipt.session_identity_sha256,
        receipt.receipt_sha256
      ].some((value) => !/^[0-9a-f]{64}$/.test(clean(value)))) {
    throw new TypeError("tcg_field_source_authority_receipt_invalid");
  }
  const { receipt_sha256: receiptSha256, ...payload } = receipt;
  if (sha256(payload) !== receiptSha256
      || (receipt.authority_used === "CURRENT_IMAGE")
        !== receipt.field_authority.every((row) => row.current_image_source_present)) {
    throw new TypeError("tcg_field_source_authority_receipt_invalid");
  }
  if (founderBetaWebReceipt !== undefined
      && (receipt.founder_beta_web_receipt_sha256 !== sha256(founderBetaWebReceipt)
        || receipt.semantic_state_sha256
          !== clean(founderBetaWebReceipt?.semantic_state_sha256).toLowerCase())) {
    throw new TypeError("tcg_field_source_authority_web_receipt_mismatch");
  }
  if (fields !== undefined
      && receipt.authorized_field_values_sha256 !== sha256(authorizedFieldValues(fields))) {
    throw new TypeError("tcg_field_source_authority_values_mismatch");
  }
  if (sourceExecution !== undefined) {
    const expected = tcgGrammarContextSourceExecutionBinding(sourceExecution);
    if (Object.entries(expected).some(([key, value]) => receipt[key] !== value)) {
      throw new TypeError("tcg_field_source_authority_execution_mismatch");
    }
  }
  return receipt;
}

function trainerGalleryMember(cardNumber) {
  const match = /^TG([1-9]|[12]\d|30)\/TG30$/.exec(clean(cardNumber));
  return match ? Number(match[1]) : null;
}

export function buildTcgGrammarContextClaimReceipt({
  fields,
  fieldSourceAuthorityReceipt
} = {}) {
  const sourceReceipt = validateTcgFieldSourceAuthorityReceipt(
    fieldSourceAuthorityReceipt,
    { fields }
  );
  const rawGrammar = clean(fields?.grammar || "standard").toLowerCase();
  if (!GRAMMARS.has(rawGrammar)) throw new TypeError("tcg_raw_grammar_invalid");
  const normalizedSet = clean(fields?.set);
  const normalizedCardNumber = clean(fields?.card_number);
  const uncertainFields = new Set([
    ...(Array.isArray(fields?.unreadable) ? fields.unreadable : []),
    ...(Array.isArray(fields?.low_confidence) ? fields.low_confidence : [])
  ].map(clean));
  const memberOrdinal = normalizedSet === "Trainer Gallery"
    ? trainerGalleryMember(normalizedCardNumber) : null;
  const recordMatched = memberOrdinal !== null;
  const sourceAuthorized = sourceReceipt.authority_used === "CURRENT_IMAGE"
    && !TRACKED_FIELDS.some((field) => uncertainFields.has(field));
  const applicable = rawGrammar === "standard";
  const applied = applicable && recordMatched && sourceAuthorized;
  const conflictCodes = [];
  if (applicable && recordMatched && !sourceAuthorized) {
    for (const row of sourceReceipt.field_authority) {
      if (!row.current_image_source_present) {
        conflictCodes.push(`${row.field.toUpperCase()}_CURRENT_IMAGE_SOURCE_MISSING`);
      }
    }
    for (const field of TRACKED_FIELDS) {
      if (uncertainFields.has(field)) {
        conflictCodes.push(`${field.toUpperCase()}_OBSERVATION_UNCERTAIN`);
      }
    }
  } else if (applicable && !recordMatched) {
    conflictCodes.push("REGISTRY_RECORD_NOT_MATCHED");
  }
  const status = applied ? "APPLIED" : applicable ? "ABSTAIN" : "NOT_REQUIRED";
  return sealedReceipt({
    schema_version: TCG_GRAMMAR_CONTEXT_CLAIM_RECEIPT_VERSION,
    status,
    claim_id: recordMatched ? CLAIM_ID : null,
    raw_grammar: rawGrammar,
    resolved_grammar: applied ? "tcg" : rawGrammar,
    normalized_set: normalizedSet,
    normalized_card_number: normalizedCardNumber,
    registry_release_id: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.release_id,
    registry_content_sha256: TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.content_sha256,
    registry_record_sha256: recordMatched
      ? sha256(TCG_GRAMMAR_CONTEXT_REGISTRY_RELEASE.records[0]) : null,
    normalization_version: TCG_GRAMMAR_CONTEXT_NORMALIZATION_VERSION,
    policy_version: TCG_GRAMMAR_CONTEXT_POLICY_VERSION,
    decision_document_sha256: DECISION_DOCUMENT_SHA256,
    field_source_authority_receipt_sha256: sourceReceipt.receipt_sha256,
    reason_code: applied
      ? "EXACT_JOINT_SET_NUMBER_NAMESPACE"
      : rawGrammar === "lot" ? "LOT_GRAMMAR_UNCHANGED"
        : rawGrammar === "tcg" ? "RAW_TCG_GRAMMAR_UNCHANGED"
          : recordMatched ? "CURRENT_IMAGE_AUTHORITY_MISSING"
            : "NO_REGISTERED_NAMESPACE",
    conflict_codes: conflictCodes.sort(),
    ip_action: "UNCHANGED",
    web_authority_used: false
  });
}

export function validateTcgGrammarContextClaimReceipt(receipt, {
  fields,
  fieldSourceAuthorityReceipt
} = {}) {
  const expected = buildTcgGrammarContextClaimReceipt({
    fields,
    fieldSourceAuthorityReceipt
  });
  if (stableJson(receipt) !== stableJson(expected)) {
    throw new TypeError("tcg_grammar_context_claim_receipt_invalid");
  }
  return receipt;
}

export function applyTcgGrammarContextClaim(fields, receipt, options = {}) {
  validateTcgGrammarContextClaimReceipt(receipt, {
    ...options,
    fields
  });
  return receipt.status === "APPLIED"
    ? { ...fields, grammar: "tcg" }
    : { ...fields };
}
