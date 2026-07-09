// Cert lookup lane: resolve a grading cert number (INSTANCE anchor) into an
// identity candidate via the internal cert registry. The result is a
// CANDIDATE, never truth: cert labels can be forged around real numbers, so
// the caller must verify the candidate against the current image before any
// writer-visible use, and surface conflicts as REVIEW_REQUIRED.
//
// External grader lookups (PSA/BGS/SGC/CGC public verification) are exposed
// as a pluggable adapter seam but ship DISABLED: automated, cached, or
// commercial access to those services needs licensing review first
// (ENABLE_EXTERNAL_CERT_LOOKUP stays false until that clears).

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function supabaseConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function externalCertLookupEnabled(env = process.env) {
  return String(env.ENABLE_EXTERNAL_CERT_LOOKUP || "false").toLowerCase() === "true";
}

// Adapter seam for licensed external registries. Register adapters keyed by
// grader; each receives ({ certNumber, env, fetchImpl, timeoutMs }) and
// returns { found, identity, grade, canonical_title } or { found: false }.
export const externalCertAdapters = new Map();

export async function lookupCertIdentity({
  grader = "",
  certNumber = "",
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = 1200
} = {}) {
  const safeCert = cleanText(certNumber);
  const safeGrader = cleanText(grader).toUpperCase();
  if (!safeCert) return { found: false, reason: "cert_number_missing" };

  const config = supabaseConfig(env);
  if (config && typeof fetchImpl === "function") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
    try {
      const endpoint = new URL(`${config.url}/rest/v1/cert_registry`);
      endpoint.searchParams.set("select", "grader,cert_number,identity,grade,auto_grade,canonical_title,source,review_status");
      endpoint.searchParams.set("cert_number", `eq.${safeCert}`);
      if (safeGrader) endpoint.searchParams.set("grader", `eq.${safeGrader}`);
      endpoint.searchParams.set("review_status", "neq.REJECTED");
      endpoint.searchParams.set("limit", "2");
      const response = await fetchImpl(endpoint, {
        headers: {
          apikey: config.key,
          authorization: `Bearer ${config.key}`,
          "content-type": "application/json"
        },
        signal: controller.signal
      });
      if (response.ok) {
        const rows = await response.json().catch(() => []);
        if (Array.isArray(rows) && rows.length === 1) {
          const row = rows[0];
          return {
            found: true,
            source: "INTERNAL_CERT_REGISTRY",
            match_level: "INSTANCE_RECORD_MATCH",
            grader: row.grader,
            cert_number: row.cert_number,
            identity: row.identity || {},
            grade: row.grade || null,
            auto_grade: row.auto_grade || null,
            canonical_title: row.canonical_title || "",
            review_status: row.review_status
          };
        }
        if (Array.isArray(rows) && rows.length > 1) {
          // Same cert number under multiple graders without a grader hint:
          // ambiguous, fail closed.
          return { found: false, reason: "cert_ambiguous_across_graders" };
        }
      }
    } catch {
      // Registry unavailability must never block recognition.
    } finally {
      clearTimeout(timer);
    }
  }

  if (externalCertLookupEnabled(env) && safeGrader && externalCertAdapters.has(safeGrader)) {
    try {
      const adapter = externalCertAdapters.get(safeGrader);
      const result = await adapter({ certNumber: safeCert, env, fetchImpl, timeoutMs });
      if (result?.found) {
        return {
          ...result,
          source: result.source || `EXTERNAL_${safeGrader}_LOOKUP`,
          match_level: result.match_level || "INSTANCE_RECORD_MATCH",
          grader: safeGrader,
          cert_number: safeCert
        };
      }
    } catch {
      // External adapters are best-effort only.
    }
  }

  return { found: false, reason: "cert_not_in_registry" };
}

// Flywheel write-back: writer-confirmed recognitions with a cert number feed
// the registry so the NEXT time this slab (or a relisting of it) shows up,
// identity is a sub-second lookup instead of a full model pass.
export async function upsertCertRegistryEntry({
  grader = "",
  certNumber = "",
  identity = {},
  grade = "",
  autoGrade = "",
  canonicalTitle = "",
  source = "recognition_confirmed",
  reviewStatus = "REVIEW_REQUIRED",
  assetId = "",
  sessionId = "",
  metadata = {},
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const safeCert = cleanText(certNumber);
  const safeGrader = cleanText(grader).toUpperCase();
  if (!safeCert || !safeGrader) return { saved: false, reason: "cert_or_grader_missing" };
  const config = supabaseConfig(env);
  if (!config || typeof fetchImpl !== "function") return { saved: false, reason: "supabase_not_configured" };

  const endpoint = new URL(`${config.url}/rest/v1/cert_registry`);
  endpoint.searchParams.set("on_conflict", "grader,cert_number");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      apikey: config.key,
      authorization: `Bearer ${config.key}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      grader: safeGrader,
      cert_number: safeCert,
      identity: identity && typeof identity === "object" ? identity : {},
      grade: cleanText(grade) || null,
      auto_grade: cleanText(autoGrade) || null,
      canonical_title: cleanText(canonicalTitle) || null,
      source,
      review_status: reviewStatus,
      asset_id: cleanText(assetId) || null,
      session_id: cleanText(sessionId) || null,
      metadata: metadata && typeof metadata === "object" ? metadata : {}
    })
  });
  return { saved: response.ok, status: response.status };
}
