import {
  buildInternalLightGbmPayload,
  handleInternalSidecar
} from "../lib/data-loop/internal-sidecar-endpoints.mjs";

export default function handler(req, res) {
  return handleInternalSidecar(req, res, {
    buildPayload: buildInternalLightGbmPayload
  });
}
