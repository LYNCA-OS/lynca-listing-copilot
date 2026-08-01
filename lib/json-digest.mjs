import crypto from "node:crypto";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, stableValue(value[key])])
      .filter(([, child]) => child !== undefined));
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function stableJsonSha256(value) {
  return sha256Hex(stableJson(value));
}
