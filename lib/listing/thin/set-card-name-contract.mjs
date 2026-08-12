export const SET_CARD_NAME_RELATION_CONTRACT_VERSION = "set-card-name-relations-v1";
export const SET_MEMBERSHIP_PREDICATE = "CURRENT_CARD_MEMBER_OF_SET";
export const CARD_NAME_PREDICATE = "CURRENT_CARD_NAMED_BY_DESIGN";

const clean = (value) => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
const comparable = (value) => clean(value).toLocaleLowerCase("en-US")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function validateSetCardNameRelationReceipt(receipt, fields = {}) {
  const exactKeys = ["card_name", "schema_version", "set"];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
      || JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(exactKeys)
      || receipt.schema_version !== SET_CARD_NAME_RELATION_CONTRACT_VERSION) {
    throw new TypeError("set_card_name_relation_receipt_invalid");
  }
  for (const [field, predicate] of [
    ["set", SET_MEMBERSHIP_PREDICATE],
    ["card_name", CARD_NAME_PREDICATE]
  ]) {
    const value = clean(fields[field]);
    const relation = receipt[field];
    if (!value) {
      if (relation !== null) throw new TypeError(`set_card_name_relation_unexpected:${field}`);
      continue;
    }
    if (!relation || typeof relation !== "object" || Array.isArray(relation)
        || JSON.stringify(Object.keys(relation).sort())
          !== JSON.stringify(["predicate", "value"])
        || relation.predicate !== predicate || clean(relation.value) !== value) {
      throw new TypeError(`set_card_name_relation_required:${field}`);
    }
  }
  if (fields.set && fields.card_name
      && comparable(fields.set) === comparable(fields.card_name)) {
    throw new TypeError("set_card_name_duplicate_role_value");
  }
  return receipt;
}
