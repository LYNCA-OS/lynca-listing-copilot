import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const artifactDir = path.resolve("artifacts/production-writer-journey");
const evidencePath = path.join(artifactDir, "evidence.json");
const recognitionPaths = new Set(["/api/csm-listing-title", "/api/csm-listing-title-ingest"]);
const productionOrigin = "https://listing.lyncafei.team";
const verifierErrorCodes = Object.freeze({
  GENERIC: "WRITER_JOURNEY_FAILED",
  TITLE_NOT_READY: "TITLE_NOT_READY",
  TITLE_UI_RECOGNITION_MISMATCH: "TITLE_UI_RECOGNITION_MISMATCH",
  TITLE_STORED_UI_MISMATCH: "TITLE_STORED_UI_MISMATCH",
  TITLE_CHANGED_AFTER_GLASS_BOX: "TITLE_CHANGED_AFTER_GLASS_BOX",
  VERSION_CONTRACT_MISMATCH: "VERSION_CONTRACT_MISMATCH",
  VERSION_RESOLVER_MISMATCH: "VERSION_RESOLVER_MISMATCH",
  VERSION_COMPOSER_MISMATCH: "VERSION_COMPOSER_MISMATCH",
  FEEDBACK_EXCHANGE_MISMATCH: "FEEDBACK_EXCHANGE_MISMATCH",
  FEEDBACK_SESSION_MISMATCH: "FEEDBACK_SESSION_MISMATCH",
  FEEDBACK_ACTION_MISMATCH: "FEEDBACK_ACTION_MISMATCH",
  FEEDBACK_REQUEST_TITLE_MISMATCH: "FEEDBACK_REQUEST_TITLE_MISMATCH",
  FEEDBACK_RESPONSE_TITLE_MISMATCH: "FEEDBACK_RESPONSE_TITLE_MISMATCH"
});
const allowedVerifierErrorCodes = new Set(Object.values(verifierErrorCodes));

function verifierFailure(code) {
  const safeCode = allowedVerifierErrorCodes.has(code) ? code : verifierErrorCodes.GENERIC;
  return Object.assign(new Error(safeCode), { verifier_error_code: safeCode });
}

function requireInvariant(value, code) {
  if (!value) throw verifierFailure(code);
}

function sanitizedFailureCode(error) {
  const code = String(error?.verifier_error_code || "").trim();
  return allowedVerifierErrorCodes.has(code) ? code : verifierErrorCodes.GENERIC;
}

function titleSha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function requestExchangeReceipt(request) {
  return {
    method: request.method(),
    url: request.url(),
    body_sha256: titleSha256(request.postData() || "")
  };
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function cleanBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || productionOrigin));
  } catch {
    throw verifierFailure(verifierErrorCodes.GENERIC);
  }
  if (url.origin !== productionOrigin || url.pathname !== "/" || url.search || url.hash
    || url.username || url.password) {
    throw verifierFailure(verifierErrorCodes.GENERIC);
  }
  return productionOrigin;
}

function deploymentId(health = {}) {
  return health?.deployment?.deployment_id
    || health?.deployment?.git_commit_sha
    || health?.deployment_id
    || null;
}

function responseRequestId(response) {
  const headers = response.headers();
  return headers["x-request-id"] || headers["x-vercel-id"] || headers["x-lynca-request-id"] || null;
}

function addIds(value, ids) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => addIds(item, ids));
    return;
  }
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    const normalized = nestedKey.toLowerCase();
    if (["asset_id", "batch_id", "job_id", "session_id", "recognition_session_id"].includes(normalized)) {
      const target = normalized === "recognition_session_id" ? "session_id" : normalized;
      const text = String(nestedValue || "").trim();
      if (text) ids[target].add(text);
    }
    addIds(nestedValue, ids);
  }
}

async function jsonOrNull(response) {
  try {
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("application/json")) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function validateSourceCasesManifest(manifest) {
  if (manifest?.schema_version !== "writer-journey-cases-v2"
    || manifest?.evidence_scope !== "LIVE_CONTRACT_RECEIPT_ONLY"
    || manifest?.accuracy_claim !== null
    || !Array.isArray(manifest.cases) || manifest.cases.length !== 2
    || new Set(manifest.cases.map((entry) => entry?.case_id)).size !== 2
    || new Set(manifest.cases.map((entry) => entry?.expected_grammar)).size !== 2) {
    throw new Error("WRITER_JOURNEY_CASES_MANIFEST invalid");
  }
  for (const entry of manifest.cases) {
    if (!["NON_TCG", "TCG"].includes(entry.case_id)
      || (entry.case_id === "NON_TCG" && entry.expected_grammar !== "NON_TCG")
      || (entry.case_id === "TCG" && entry.expected_grammar !== "TCG")
      || entry.evaluation_cohort !== "INTERNAL_REVIEWED_GT"
      || !entry.source_feedback_id || !entry.hash_provenance
      || !Array.isArray(entry.files) || entry.files.length !== 2
      || entry.image_count !== entry.files.length
      || entry.files[0]?.role !== "front_original"
      || entry.files[1]?.role !== "back_original") {
      throw new Error("WRITER_JOURNEY_CASES_MANIFEST case invalid");
    }
  }
  return manifest.cases;
}

async function localSourceCases(filePath) {
  const manifest = JSON.parse(await readFile(filePath, "utf8"));
  const cases = [];
  for (const entry of validateSourceCasesManifest(manifest)) {
    const images = [];
    for (const [index, file] of entry.files.entries()) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.content_type)) {
        throw new Error("WRITER_JOURNEY_CASES_MANIFEST content type invalid");
      }
      const bytes = await readFile(file.path);
      const contentSha256 = createHash("sha256").update(bytes).digest("hex");
      if (!/^[0-9a-f]{64}$/.test(file.content_sha256) || file.content_sha256 !== contentSha256) {
        throw new Error("WRITER_JOURNEY_CASES_MANIFEST hash mismatch");
      }
      images.push({
        name: path.basename(file.path) || `image-${index + 1}.jpg`,
        mimeType: file.content_type,
        buffer: bytes
      });
    }
    cases.push({ ...entry, images });
  }
  return cases;
}

function cookieDomainMatches(hostname, domain) {
  const normalized = String(domain || "").trim().toLowerCase();
  if (!normalized) return false;
  const bare = normalized.replace(/^\./, "");
  return hostname === bare || (normalized.startsWith(".") && hostname.endsWith(`.${bare}`));
}

function cookiePathMatches(pathname, cookiePath) {
  const normalized = String(cookiePath || "/");
  if (!normalized.startsWith("/") || !pathname.startsWith(normalized)) return false;
  return normalized.endsWith("/") || pathname.length === normalized.length
    || pathname[normalized.length] === "/";
}

function cookieHeaderForUrl(state, target, { nowSeconds = Date.now() / 1000 } = {}) {
  const url = new URL(target);
  return (state?.cookies || []).flatMap((cookie) => {
    const name = String(cookie?.name || "");
    const value = String(cookie?.value || "");
    const expires = Number(cookie?.expires);
    const unexpired = expires === -1 || (Number.isFinite(expires) && expires > nowSeconds);
    const safe = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)
      && value && !/[\u0000-\u001f\u007f;]/.test(value);
    return safe && unexpired
      && cookieDomainMatches(url.hostname, cookie.domain)
      && cookiePathMatches(url.pathname, cookie.path)
      && (!cookie.secure || url.protocol === "https:")
      ? [`${name}=${value}`] : [];
  }).join("; ");
}

async function cookieHeaderFromStorageState(filePath, target) {
  if (!filePath) return "";
  const state = JSON.parse(await readFile(filePath, "utf8"));
  return cookieHeaderForUrl(state, target);
}

function recognitionVersionReceipt(recognition, view) {
  const rows = recognition?.csm_rows || {};
  const rowContract = String(rows.output?.contract_version || "").trim();
  const resolutionContract = String(rows.resolution?.contract_version || "").trim();
  const owner = recognition?.csm_owner_versions || {};
  const contract = String(recognition?.csm_contract_version || rowContract).trim();
  const rowResolver = String(rows.resolution?.resolver_version || "").trim();
  const rowComposer = String(rows.output?.composer_version || "").trim();
  const resolver = String(owner.resolver || rowResolver).trim();
  const composer = String(owner.composer || rowComposer).trim();
  if (recognition?.csm_owner_versions != null) {
    requireInvariant(Boolean(owner.resolver) && Boolean(owner.composer),
      verifierErrorCodes.VERSION_CONTRACT_MISMATCH);
  }
  requireInvariant(Boolean(contract) && contract === rowContract && contract === resolutionContract,
    verifierErrorCodes.VERSION_CONTRACT_MISMATCH);
  if (recognition?.csm_contract_version) {
    requireInvariant(recognition.csm_contract_version === contract,
      verifierErrorCodes.VERSION_CONTRACT_MISMATCH);
  }
  requireInvariant(view?.schema_version === "csm-resolution-view-v1"
    && view.schema_version === view?.grammar?.contract_version,
    verifierErrorCodes.VERSION_CONTRACT_MISMATCH);
  requireInvariant(Boolean(resolver) && resolver === rowResolver
    && view?.grammar?.resolver_version === resolver,
    verifierErrorCodes.VERSION_RESOLVER_MISMATCH);
  requireInvariant(Boolean(composer) && composer === rowComposer
    && view?.composer?.composer_version === composer,
    verifierErrorCodes.VERSION_COMPOSER_MISMATCH);
  return {
    resolution_view_schema: view.schema_version,
    csm_contract: contract,
    resolver,
    composer
  };
}

function feedbackReceipt({
  requestPayload,
  responsePayload,
  requestMatchesResponse,
  recognitionSessionId,
  expectedTitleSha256
}) {
  requireInvariant(requestMatchesResponse, verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH);
  requireInvariant(Boolean(requestPayload?.feedback_submission_id)
    && responsePayload?.feedback_submission_id === requestPayload.feedback_submission_id,
    verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH);
  requireInvariant(requestPayload?.recognition_session_id === recognitionSessionId
    && responsePayload?.recognition_session_id === recognitionSessionId,
    verifierErrorCodes.FEEDBACK_SESSION_MISMATCH);
  requireInvariant(requestPayload?.action === "ACCEPT",
    verifierErrorCodes.FEEDBACK_ACTION_MISMATCH);
  requireInvariant(titleSha256(requestPayload?.writer_final_title) === expectedTitleSha256,
    verifierErrorCodes.FEEDBACK_REQUEST_TITLE_MISMATCH);
  requireInvariant(titleSha256(responsePayload?.writer_final_title) === expectedTitleSha256,
    verifierErrorCodes.FEEDBACK_RESPONSE_TITLE_MISMATCH);
  return {
    action: "ACCEPT",
    exchange_bound: true,
    session_matches: true,
    request_title_matches: true,
    response_title_matches: true
  };
}

function titleEvidenceReceipt({ titleBeforePanel, titleAfterPanel, expectedTitleSha256, feedback }) {
  return {
    title_length: titleBeforePanel.length,
    title_unchanged: titleSha256(titleAfterPanel) === expectedTitleSha256,
    feedback_action: feedback.action,
    feedback_exchange_bound: feedback.exchange_bound,
    feedback_session_matches: feedback.session_matches,
    feedback_request_title_matches: feedback.request_title_matches,
    feedback_response_title_matches: feedback.response_title_matches
  };
}

test("production writer journey renders reliable Glass Box traces for NON_TCG and TCG", async ({ browser }, testInfo) => {
  test.setTimeout(15 * 60 * 1000);
  await mkdir(artifactDir, { recursive: true });
  const baseUrl = cleanBaseUrl(process.env.WRITER_JOURNEY_BASE_URL);
  const expectedSha = requiredEnv("WRITER_JOURNEY_EXPECTED_SHA");
  const username = requiredEnv("METAVERSE_USERNAME");
  const password = requiredEnv("METAVERSE_PASSWORD");
  const initialStorageState = String(
    process.env.WRITER_JOURNEY_INITIAL_STORAGE_STATE || ""
  ).trim() || undefined;
  const healthUrl = `${baseUrl}/api/health`;
  const initialCookieHeader = await cookieHeaderFromStorageState(initialStorageState, healthUrl);
  const sourceCases = await localSourceCases(requiredEnv("WRITER_JOURNEY_CASES_MANIFEST"));
  const evidence = {
    schema_version: "production-writer-journey-evidence-v2",
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    field_ground_truth_available: false,
    accuracy_claim: null,
    passed: false,
    launch_ready_mutated: false,
    base_url: baseUrl,
    started_at: new Date().toISOString(),
    deployment_id: null,
    request_ids: [],
    asset_ids: [],
    batch_ids: [],
    job_ids: [],
    session_ids: [],
    cases: [],
    stages: {}
  };
  const ids = {
    asset_id: new Set(),
    batch_id: new Set(),
    job_id: new Set(),
    session_id: new Set()
  };
  const requestIds = new Set();
  const apiPaths = new Set();
  const resolutionRequests = [];
  const responseCaptureTasks = new Set();
  let loginContext;
  let loginPage;
  let journeyContext;

  try {
    const healthResponse = await fetch(healthUrl, {
      headers: {
        accept: "application/json",
        ...(initialCookieHeader ? { cookie: initialCookieHeader } : {})
      }
    });
    const health = await healthResponse.json();
    expect(healthResponse.ok, "production health must be reachable").toBeTruthy();
    expect(health?.deployment?.environment,
      "ordinary Preview deployments are not production-target candidates").toBe("production");
    expect(health?.deployment?.git_commit_sha, "production target must match the release under test")
      .toBe(expectedSha);
    evidence.deployment_id = deploymentId(health);
    evidence.deployment_git_commit_sha = health.deployment.git_commit_sha;
    evidence.deployment_environment = health.deployment.environment;
    const healthRequestId = healthResponse.headers.get("x-request-id") || healthResponse.headers.get("x-vercel-id");
    if (healthRequestId) requestIds.add(healthRequestId);
    evidence.stages.health = { passed: true, http_status: healthResponse.status };

    // Login is isolated from uploaded artifacts so credentials never enter a trace.
    loginContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1000 },
      ...(initialStorageState ? { storageState: initialStorageState } : {})
    });
    loginPage = await loginContext.newPage();
    await loginPage.goto("/app/login.html?next=%2Fapp%2F", { waitUntil: "domcontentloaded" });
    await loginPage.getByTestId("login-username").fill(username);
    await loginPage.getByTestId("login-password").fill(password);
    await loginPage.getByTestId("login-submit").click();
    await loginPage.waitForURL((url) => !url.pathname.endsWith("/login.html"), { timeout: 45_000 });
    await expect(loginPage.getByTestId("image-upload-input")).toBeAttached();
    const storageState = await loginContext.storageState();
    evidence.stages.login = { passed: true, final_path: new URL(loginPage.url()).pathname };
    await loginContext.close();
    loginContext = null;
    loginPage = null;

    journeyContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1000 },
      storageState
    });
    const journeyPage = await journeyContext.newPage();
    journeyPage.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/csm-resolution-view") {
        resolutionRequests.push({ method: request.method(), asset_id: url.searchParams.get("asset_id") });
      }
    });
    journeyPage.on("response", (response) => {
      const task = (async () => {
        const requestId = responseRequestId(response);
        if (requestId) requestIds.add(requestId);
        const pathname = new URL(response.url()).pathname;
        if (!pathname.startsWith("/api/")) return;
        apiPaths.add(pathname);
        const payload = await jsonOrNull(response);
        if (payload) addIds(payload, ids);
      })();
      responseCaptureTasks.add(task);
      void task.finally(() => responseCaptureTasks.delete(task));
    });

    await journeyPage.goto("/app/", { waitUntil: "domcontentloaded" });
    await journeyPage.waitForLoadState("networkidle");
    const uploadInput = journeyPage.getByTestId("image-upload-input");
    await expect(journeyPage.getByTestId("start-recognition")).toBeHidden();

    for (const sourceCase of sourceCases) {
      const uploadStartedAt = Date.now();
      const recognitionResponsePromise = journeyPage.waitForResponse((response) => (
        response.request().method() === "POST"
        && recognitionPaths.has(new URL(response.url()).pathname)
      ), { timeout: 6 * 60 * 1000 });
      const resolutionResponsePromise = journeyPage.waitForResponse((response) => (
        response.request().method() === "GET"
        && new URL(response.url()).pathname === "/api/csm-resolution-view"
      ), { timeout: 6 * 60 * 1000 });
      await uploadInput.setInputFiles(sourceCase.images);

      const recognitionResponse = await recognitionResponsePromise;
      const recognitionPayload = await recognitionResponse.json();
      addIds(recognitionPayload, ids);
      expect(recognitionResponse.ok(), "direct CSM recognition must succeed").toBeTruthy();
      expect(recognitionPayload?.trace_status, "recognition trace must be durable").toBe("PERSISTED");
      expect(recognitionPayload?.provider_attempt_number, "live verifier requires the first provider attempt")
        .toBe(1);
      expect(recognitionPayload?.provider_retry_count, "live verifier excludes provider retries").toBe(0);
      expect(String(recognitionPayload?.asset_id || "")).not.toBe("");
      expect(String(recognitionPayload?.recognition_session_id || "")).not.toBe("");

      const result = journeyPage.getByTestId("writer-title-result").first();
      const titleInput = result.getByTestId("writer-title-input");
      await expect(titleInput).toBeEnabled({ timeout: 6 * 60 * 1000 });
      await expect.poll(
        async () => /^(?!标题暂不可用$).{1,80}$/.test((await titleInput.inputValue()).trim()),
        { timeout: 6 * 60 * 1000, intervals: [250, 500, 1_000, 2_000] }
      ).toBe(true).catch(() => { throw verifierFailure(verifierErrorCodes.TITLE_NOT_READY); });
      const titleBeforePanel = await titleInput.inputValue();
      const generatedTitleSha256 = titleSha256(recognitionPayload.title);
      const panelTitleSha256 = titleSha256(titleBeforePanel);
      requireInvariant(panelTitleSha256 === generatedTitleSha256,
        verifierErrorCodes.TITLE_UI_RECOGNITION_MISMATCH);

      const resolutionResponse = await resolutionResponsePromise;
      const resolutionView = await resolutionResponse.json();
      addIds(resolutionView, ids);
      expect(resolutionResponse.ok(), "resolution view must be readable in the live writer journey").toBeTruthy();
      expect(resolutionView?.asset_id).toBe(recognitionPayload.asset_id);
      expect(resolutionView?.recognition_session_id).toBe(recognitionPayload.recognition_session_id);
      expect(resolutionView?.grammar?.value).toBe(sourceCase.expected_grammar);
      const versions = recognitionVersionReceipt(recognitionPayload, resolutionView);
      requireInvariant(titleSha256(resolutionView?.composer?.stored_title) === generatedTitleSha256,
        verifierErrorCodes.TITLE_STORED_UI_MISMATCH);
      expect(resolutionView?.composer?.recomposed_matches_stored).toBe(true);
      expect(resolutionView?.composer?.trace_reliable).toBe(true);
      expect(Array.isArray(resolutionView?.brackets)).toBe(true);
      expect(resolutionView.brackets.length).toBeGreaterThan(0);

      const glassBox = result.locator("details.glass-box");
      await expect(glassBox, "Glass Box panel must render after its GET completes").toBeAttached();
      await glassBox.locator("summary").click();
      await expect(glassBox.locator("tbody tr")).toHaveCount(resolutionView.brackets.length);
      const titleAfterPanel = await titleInput.inputValue();
      requireInvariant(titleSha256(titleAfterPanel) === generatedTitleSha256,
        verifierErrorCodes.TITLE_CHANGED_AFTER_GLASS_BOX);

      const assetResolutionRequests = resolutionRequests.filter((request) => (
        request.asset_id === recognitionPayload.asset_id
      ));
      expect(assetResolutionRequests).toHaveLength(1);
      expect(assetResolutionRequests[0].method).toBe("GET");
      expect(resolutionRequests.some((request) => request.method !== "GET"),
        "the writer journey must never submit a semantic review").toBe(false);

      // Persist the unchanged generated title as writer feedback.
      await titleInput.fill(titleBeforePanel);
      const persistenceRequestPromise = journeyPage.waitForRequest((request) => (
        request.method() === "POST"
        && new URL(request.url()).pathname === "/api/v4/listing-feedback"
      ), { timeout: 45_000 });
      const persistenceResponsePromise = journeyPage.waitForResponse((response) => (
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/v4/listing-feedback"
      ), { timeout: 45_000 });
      await result.getByTestId("accept-writer-title").click();
      const [persistenceRequest, persistenceResponse] = await Promise.all([
        persistenceRequestPromise,
        persistenceResponsePromise
      ]);
      let persistenceRequestPayload;
      try {
        persistenceRequestPayload = persistenceRequest.postDataJSON();
      } catch {
        throw verifierFailure(verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH);
      }
      const persistencePayload = await persistenceResponse.json();
      addIds(persistencePayload, ids);
      const responseRequest = persistenceResponse.request();
      const feedback = feedbackReceipt({
        requestPayload: persistenceRequestPayload,
        responsePayload: persistencePayload,
        requestMatchesResponse: persistenceRequest === responseRequest
          && JSON.stringify(requestExchangeReceipt(persistenceRequest))
            === JSON.stringify(requestExchangeReceipt(responseRequest)),
        recognitionSessionId: recognitionPayload.recognition_session_id,
        expectedTitleSha256: panelTitleSha256
      });
      expect(persistenceResponse.ok(), "feedback persistence request must succeed").toBeTruthy();
      expect(persistencePayload?.v4_persistence?.transaction?.saved,
        "feedback transaction must be durable").toBe(true);

      evidence.cases.push({
        case_id: sourceCase.case_id,
        expected_grammar: sourceCase.expected_grammar,
        source_feedback_id: sourceCase.source_feedback_id,
        hash_provenance: sourceCase.hash_provenance,
        image_sha256: sourceCase.files.map(({ role, content_sha256: contentSha256 }) => ({
          role,
          content_sha256: contentSha256
        })),
        recognition_route: new URL(recognitionResponse.url()).pathname,
        asset_id: recognitionPayload.asset_id,
        recognition_session_id: recognitionPayload.recognition_session_id,
        trace_status: recognitionPayload.trace_status,
        provider_attempt_number: recognitionPayload.provider_attempt_number,
        provider_retry_count: recognitionPayload.provider_retry_count,
        resolution_http_method: assetResolutionRequests[0].method,
        resolution_request_count: assetResolutionRequests.length,
        glass_box_rendered: true,
        bracket_count: resolutionView.brackets.length,
        trace_reliable: resolutionView.composer.trace_reliable,
        recomposed_matches_stored: resolutionView.composer.recomposed_matches_stored,
        versions,
        ...titleEvidenceReceipt({
          titleBeforePanel,
          titleAfterPanel,
          expectedTitleSha256: generatedTitleSha256,
          feedback
        }),
        feedback_saved: persistencePayload.v4_persistence.transaction.saved,
        upload_to_feedback_ms: Date.now() - uploadStartedAt
      });
      await expect(journeyPage.getByTestId("writer-title-result")).toHaveCount(0, { timeout: 45_000 });
    }

    const finalHealthResponse = await fetch(healthUrl, {
      headers: {
        accept: "application/json",
        ...(initialCookieHeader ? { cookie: initialCookieHeader } : {})
      }
    });
    const finalHealth = await finalHealthResponse.json();
    expect(finalHealthResponse.ok, "production health must remain reachable").toBeTruthy();
    expect(finalHealth?.deployment?.environment).toBe("production");
    expect(finalHealth?.deployment?.git_commit_sha, "production target changed during Writer Journey")
      .toBe(expectedSha);
    evidence.stages.release_stability = { passed: true, git_commit_sha: expectedSha };

    await Promise.allSettled([...responseCaptureTasks]);
    expect(apiPaths.has("/api/csm-listing-title") || apiPaths.has("/api/csm-listing-title-ingest"),
      "the UI must receive direct CSM recognition before feedback").toBe(true);
    expect(resolutionRequests).toHaveLength(2);
    expect(resolutionRequests.every((request) => request.method === "GET")).toBe(true);
    expect(evidence.cases.map((entry) => entry.case_id).sort()).toEqual(["NON_TCG", "TCG"]);
    expect(ids.asset_id.size, "asset_id must be captured").toBeGreaterThanOrEqual(2);
    expect(ids.session_id.size, "recognition_session_id must be captured").toBeGreaterThanOrEqual(2);
    expect(requestIds.size, "request_id must be captured").toBeGreaterThan(0);
    evidence.stages.live_contract = { passed: true, case_count: evidence.cases.length };
    evidence.passed = true;
  } catch (error) {
    const errorCode = sanitizedFailureCode(error);
    evidence.error_code = errorCode;
    throw verifierFailure(errorCode);
  } finally {
    evidence.finished_at = new Date().toISOString();
    await Promise.allSettled([...responseCaptureTasks]);
    evidence.request_ids = [...requestIds];
    evidence.asset_ids = [...ids.asset_id];
    evidence.batch_ids = [...ids.batch_id];
    evidence.job_ids = [...ids.job_id];
    evidence.session_ids = [...ids.session_id];
    await journeyContext?.close().catch(() => {});
    await loginContext?.close().catch(() => {});
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (!evidence.passed) {
      await testInfo.attach("writer-journey-evidence", {
        path: evidencePath,
        contentType: "application/json"
      }).catch(() => {});
    }
  }
});

test("offline verifier boundaries redact titles and reject identity drift @offline", async () => {
  const hash = "a".repeat(64);
  const manifest = {
    schema_version: "writer-journey-cases-v2",
    evidence_scope: "LIVE_CONTRACT_RECEIPT_ONLY",
    accuracy_claim: null,
    cases: [
      { case_id: "NON_TCG", expected_grammar: "NON_TCG" },
      { case_id: "TCG", expected_grammar: "TCG" }
    ].map((entry) => ({
      ...entry,
      source_feedback_id: `source-${entry.case_id}`,
      evaluation_cohort: "INTERNAL_REVIEWED_GT",
      hash_provenance: "TEST_EXACT_BYTES",
      image_count: 2,
      files: ["front_original", "back_original"].map((role) => ({
        path: `/not-read/${entry.case_id}/${role}.jpg`,
        role,
        content_type: "image/jpeg",
        content_sha256: hash
      }))
    }))
  };
  requireInvariant(validateSourceCasesManifest(manifest).every((entry) => (
    entry.files.map((file) => file.role).join(",") === "front_original,back_original"
  )), verifierErrorCodes.GENERIC);
  for (const invalidFiles of [
    [manifest.cases[0].files[1], manifest.cases[0].files[0]],
    [manifest.cases[0].files[0], manifest.cases[0].files[0]]
  ]) {
    let roleDriftRejected = false;
    try {
      validateSourceCasesManifest({
        ...manifest,
        cases: [{ ...manifest.cases[0], files: invalidFiles }, manifest.cases[1]]
      });
    } catch {
      roleDriftRejected = true;
    }
    requireInvariant(roleDriftRejected, verifierErrorCodes.GENERIC);
  }

  const nowSeconds = 1_800_000_000;
  const cookieState = { cookies: [
    { name: "valid", value: "kept", domain: "listing.lyncafei.team", path: "/api", secure: true, expires: nowSeconds + 60 },
    { name: "domain", value: "kept", domain: ".lyncafei.team", path: "/api", secure: true, expires: -1 },
    { name: "evil", value: "drop", domain: "listing.lyncafei.team.evil", path: "/api", secure: true, expires: nowSeconds + 60 },
    { name: "expired", value: "drop", domain: "listing.lyncafei.team", path: "/api", secure: true, expires: nowSeconds - 1 },
    { name: "wrong_path", value: "drop", domain: "listing.lyncafei.team", path: "/app", secure: true, expires: nowSeconds + 60 },
    { name: "path_prefix", value: "drop", domain: "listing.lyncafei.team", path: "/apiary", secure: true, expires: nowSeconds + 60 }
  ] };
  requireInvariant(cookieHeaderForUrl(cookieState, `${productionOrigin}/api/health`, { nowSeconds })
    === "valid=kept; domain=kept", verifierErrorCodes.GENERIC);
  requireInvariant(cookieHeaderForUrl({ cookies: [{
    name: "secure_only", value: "drop", domain: "listing.lyncafei.team", path: "/api",
    secure: true, expires: nowSeconds + 60
  }] }, "http://listing.lyncafei.team/api/health", { nowSeconds }) === "",
  verifierErrorCodes.GENERIC);
  for (const forbiddenBase of [
    "https://listing.lyncafei.team.evil/",
    "https://preview.example.vercel.app/",
    "http://listing.lyncafei.team/",
    "https://listing.lyncafei.team/app/"
  ]) {
    let rejected = false;
    try { cleanBaseUrl(forbiddenBase); } catch { rejected = true; }
    requireInvariant(rejected, verifierErrorCodes.GENERIC);
  }

  const recognition = {
    csm_contract_version: "csm-stage-v-test",
    csm_owner_versions: { resolver: "resolver-v-test", composer: "composer-v-test" },
    csm_rows: {
      resolution: { contract_version: "csm-stage-v-test", resolver_version: "resolver-v-test" },
      output: { contract_version: "csm-stage-v-test", composer_version: "composer-v-test" }
    }
  };
  const view = {
    schema_version: "csm-resolution-view-v1",
    grammar: { contract_version: "csm-resolution-view-v1", resolver_version: "resolver-v-test" },
    composer: { composer_version: "composer-v-test" }
  };
  const versions = recognitionVersionReceipt(recognition, view);
  requireInvariant(versions.resolver === "resolver-v-test"
    && versions.composer === "composer-v-test", verifierErrorCodes.GENERIC);
  let versionDriftCode = "";
  try {
    recognitionVersionReceipt(recognition, {
      ...view,
      composer: { composer_version: "drifted-composer" }
    });
  } catch (error) {
    versionDriftCode = sanitizedFailureCode(error);
  }
  requireInvariant(versionDriftCode === verifierErrorCodes.VERSION_COMPOSER_MISMATCH,
    verifierErrorCodes.GENERIC);

  const expectedTitleHash = titleSha256("PRIVATE FEEDBACK TITLE");
  const validFeedback = {
    recognition_session_id: "session-test",
    feedback_submission_id: "feedback-test",
    action: "ACCEPT",
    writer_final_title: "PRIVATE FEEDBACK TITLE"
  };
  const feedback = feedbackReceipt({
    requestPayload: validFeedback,
    responsePayload: validFeedback,
    requestMatchesResponse: true,
    recognitionSessionId: "session-test",
    expectedTitleSha256: expectedTitleHash
  });
  requireInvariant(feedback.exchange_bound && feedback.session_matches
    && feedback.request_title_matches && feedback.response_title_matches,
    verifierErrorCodes.GENERIC);
  for (const counterexample of [
    { requestMatchesResponse: false, code: verifierErrorCodes.FEEDBACK_EXCHANGE_MISMATCH },
    {
      requestPayload: { ...validFeedback, action: "EDIT" },
      code: verifierErrorCodes.FEEDBACK_ACTION_MISMATCH
    },
    {
      responsePayload: { ...validFeedback, writer_final_title: "PRIVATE DRIFTED TITLE" },
      code: verifierErrorCodes.FEEDBACK_RESPONSE_TITLE_MISMATCH
    }
  ]) {
    let feedbackFailureCode = "";
    try {
      feedbackReceipt({
        requestPayload: counterexample.requestPayload || validFeedback,
        responsePayload: counterexample.responsePayload || validFeedback,
        requestMatchesResponse: counterexample.requestMatchesResponse ?? true,
        recognitionSessionId: "session-test",
        expectedTitleSha256: expectedTitleHash
      });
    } catch (error) {
      feedbackFailureCode = sanitizedFailureCode(error);
    }
    requireInvariant(feedbackFailureCode === counterexample.code, verifierErrorCodes.GENERIC);
  }

  const expectedTitle = "PRIVATE EXPECTED TITLE";
  const receivedTitle = "PRIVATE RECEIVED TITLE";
  const unsafeMatcherError = new Error(`Expected ${expectedTitle}; received ${receivedTitle}`);
  const failureArtifact = JSON.stringify({ error_code: sanitizedFailureCode(unsafeMatcherError) });
  requireInvariant(!failureArtifact.includes(expectedTitle)
    && !failureArtifact.includes(receivedTitle)
    && failureArtifact === `{"error_code":"${verifierErrorCodes.GENERIC}"}`,
    verifierErrorCodes.GENERIC);
  const titleArtifact = JSON.stringify(titleEvidenceReceipt({
    titleBeforePanel: expectedTitle,
    titleAfterPanel: expectedTitle,
    expectedTitleSha256: titleSha256(expectedTitle),
    feedback
  }));
  requireInvariant(!titleArtifact.includes(expectedTitle)
    && !titleArtifact.includes("title_sha256")
    && !titleArtifact.includes("writer_final_title")
    && !titleArtifact.includes("stored_title"),
    verifierErrorCodes.GENERIC);
});
