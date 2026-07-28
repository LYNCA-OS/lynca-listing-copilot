import crypto from "node:crypto";
import resolutionMapArtifact from "../../../app/resolution.json" with { type: "json" };

export const cardCodeResolutionMapContractVersion = "card-code-resolution-map-v1-server-owned";

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

const normalizedEntries = Object.entries(resolutionMapArtifact || {})
  .map(([code, label]) => [clean(code, 40).toUpperCase(), clean(label, 120)])
  .filter(([code, label]) => code && label)
  .sort(([left], [right]) => left.localeCompare(right));

export const cardCodeResolutionMap = Object.freeze(Object.fromEntries(normalizedEntries));
export const cardCodeResolutionMapRevision = crypto.createHash("sha256")
  .update(JSON.stringify(cardCodeResolutionMap))
  .digest("hex");

export function attachServerOwnedCardCodeResolutionMap(payload = {}) {
  return {
    ...(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}),
    resolutionMap: cardCodeResolutionMap,
    resolution_map_revision: cardCodeResolutionMapRevision
  };
}
