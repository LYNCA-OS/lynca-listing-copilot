import { expect, test } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchGateImageSourceRecords } from "../lib/listing/evaluation/launch-gate-image-source-index.generated.mjs";

const artifactDir = path.resolve("artifacts/production-writer-journey");
const evidencePath = path.join(artifactDir, "evidence.json");
const screenshotPath = path.join(artifactDir, "failure.png");
const requiredStageIds = Object.freeze([
  "health",
  "real_image_materialization",
  "login",
  "upload",
  "enqueue",
  "status",
  "l2_ready",
  "accept_edit",
  "persistence"
]);

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function cleanBaseUrl(value) {
  return String(value || "https://listing.lyncafei.team").replace(/\/+$/, "");
}

function deploymentId(health = {}) {
  return health?.deployment?.deployment_id || health?.deployment_id || null;
}

function deploymentGitCommitSha(health = {}) {
  return String(health?.deployment?.git_commit_sha || health?.git_commit_sha || "").trim().toLowerCase();
}

function requiredGitSha(name) {
  const value = requiredEnv(name).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${name} must be a full Git SHA`);
  return value;
}

function requiredWorkflowProvenance() {
  const provenance = {
    repository: requiredEnv("GITHUB_REPOSITORY"),
    workflow_ref: requiredEnv("GITHUB_WORKFLOW_REF"),
    run_id: requiredEnv("GITHUB_RUN_ID"),
    run_attempt: requiredEnv("GITHUB_RUN_ATTEMPT"),
    event: requiredEnv("GITHUB_EVENT_NAME"),
    source_ref: requiredEnv("WRITER_JOURNEY_SOURCE_REF")
  };
  for (const [field, value] of Object.entries(provenance)) {
    if (/[^\x20-\x7e]/.test(value)) throw new Error(`${field} must be a printable string`);
  }
  return provenance;
}

function sanitizedError(error, sensitiveValues = []) {
  let text = String(error?.message || error || "writer journey failed");
  for (const value of sensitiveValues.map((item) => String(item || "")).filter(Boolean)) {
    text = text.split(value).join("[REDACTED]");
  }
  return text
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:Authorization|Cookie|Set-Cookie)\b\s*[:=]\s*[^\s,;]+/gi, "[AUTH_HEADER_REDACTED]")
    .replace(/lynca_metaverse_session\s*=\s*[^\s,;]+/gi, "lynca_session=[REDACTED]")
    .slice(0, 1000);
}

function assertSensitiveValuesAbsent(serialized, sensitiveValues = []) {
  for (const value of sensitiveValues.map((item) => String(item || "")).filter(Boolean)) {
    if (serialized.includes(value)) throw new Error("Writer Journey evidence contains a sensitive value");
  }
  if (/lynca_metaverse_session|\bBearer\s+[A-Za-z0-9._~+/=-]+|"(?:authorization|cookie|set-cookie)"\s*:/i.test(serialized)) {
    throw new Error("Writer Journey evidence contains authentication material");
  }
}

async function writeSafeFailureScreenshot(page) {
  if (!page) return false;
  const sensitiveControls = page.locator('input, textarea, [contenteditable="true"]');
  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      mask: [sensitiveControls],
      maskColor: "#0b1020"
    });
    return true;
  } catch {
    return false;
  }
}

function responseRequestId(response) {
  const headers = response.headers();
  return headers["x-request-id"] || headers["x-vercel-id"] || headers["x-lynca-request-id"] || null;
}

function addIds(value, ids, key = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => addIds(item, ids, key));
    return;
  }
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    const normalized = nestedKey.toLowerCase();
    if (["asset_id", "batch_id", "job_id", "session_id", "recognition_session_id"].includes(normalized)) {
      const target = normalized === "recognition_session_id" ? "session_id" : normalized;
      const text = String(nestedValue || "").trim();
      if (text) ids[target].add(text);
    }
    addIds(nestedValue, ids, normalized || key);
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

function e2eEditedTitle(originalTitle) {
  const original = String(originalTitle || "").trim();
  const temporalToken = /\b(?:19|20)\d{2}(?:-(?:\d{2}|\d{4}))?\b/;
  const observedTemporalToken = original.match(temporalToken)?.[0] || "";
  const replacementYear = observedTemporalToken.startsWith("1999") ? "1998" : "1999";
  const edited = observedTemporalToken
    ? original.replace(temporalToken, replacementYear)
    : `1999 ${original}`.slice(0, 80).trimEnd();
  if (!original || edited === original) throw new Error("unable to build a distinct E2E edit title");
  return edited;
}

async function materializeRealSourceImages(baseUrl, secret) {
  const source = launchGateImageSourceRecords[0];
  const sourceResponse = await fetch(`${baseUrl}/api/v4/launch-gate-source-images`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lynca-launch-gate-secret": secret
    },
    body: JSON.stringify({ source_feedback_ids: [source.source_feedback_id] })
  });
  const sourcePayload = await sourceResponse.json();
  if (!sourceResponse.ok || sourcePayload.ok === false) {
    throw new Error(`real source materialization failed: HTTP ${sourceResponse.status}`);
  }
  const images = sourcePayload.sources?.[0]?.images || [];
  if (!images.length) throw new Error("real source materialization returned no images");
  return Promise.all(images.map(async (image, index) => {
    const response = await fetch(image.signed_url);
    if (!response.ok) throw new Error(`source image ${index + 1} download failed: HTTP ${response.status}`);
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    return {
      name: `${image.role || `image-${index + 1}`}.jpg`,
      mimeType,
      buffer: Buffer.from(await response.arrayBuffer())
    };
  }));
}

test("production writer journey reaches persisted L2 through the real UI", async ({ browser }, testInfo) => {
  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });
  const baseUrl = cleanBaseUrl(process.env.WRITER_JOURNEY_BASE_URL);
  const workflowProvenance = requiredWorkflowProvenance();
  const sensitiveValues = [
    process.env.METAVERSE_USERNAME,
    process.env.METAVERSE_PASSWORD,
    process.env.LAUNCH_GATE_EVAL_SECRET
  ];
  const evidence = {
    schema_version: "production-writer-journey-evidence-v3",
    passed: false,
    launch_ready_mutated: false,
    repository: workflowProvenance.repository,
    workflow_ref: workflowProvenance.workflow_ref,
    run_id: workflowProvenance.run_id,
    run_attempt: workflowProvenance.run_attempt,
    event: workflowProvenance.event,
    source_ref: workflowProvenance.source_ref,
    production_base_url: baseUrl,
    started_at: new Date().toISOString(),
    deployment_id: null,
    expected_git_commit_sha: null,
    deployment_git_commit_sha: null,
    exact_sha_match: false,
    required_stage_ids: [...requiredStageIds],
    all_required_stages_passed: false,
    request_ids: [],
    asset_ids: [],
    batch_ids: [],
    job_ids: [],
    session_ids: [],
    stages: {},
    artifact_safety: {
      safe_to_upload: false,
      har_uploaded: false,
      trace_uploaded: false,
      sensitive_value_scan_passed: false,
      storage_state_persisted: false,
      login_screenshot_recorded: false,
      failure_screenshot_created: false,
      screenshot_sensitive_controls_masked: true
    }
  };
  const ids = {
    asset_id: new Set(),
    batch_id: new Set(),
    job_id: new Set(),
    session_id: new Set()
  };
  const requestIds = new Set();
  const apiPaths = new Set();
  const responseCaptureTasks = new Set();
  let loginContext;
  let loginPage;
  let journeyContext;
  let journeyPage;

  try {
    const username = requiredEnv("METAVERSE_USERNAME");
    const password = requiredEnv("METAVERSE_PASSWORD");
    const launchGateSecret = requiredEnv("LAUNCH_GATE_EVAL_SECRET");
    const expectedGitCommitSha = requiredGitSha("WRITER_JOURNEY_EXPECTED_GIT_SHA");
    evidence.expected_git_commit_sha = expectedGitCommitSha;
    const healthResponse = await fetch(`${baseUrl}/api/v4/health`, { headers: { accept: "application/json" } });
    const health = await healthResponse.json();
    expect(healthResponse.ok, "production health must be reachable").toBeTruthy();
    evidence.deployment_id = deploymentId(health);
    evidence.deployment_git_commit_sha = deploymentGitCommitSha(health);
    evidence.exact_sha_match = evidence.deployment_git_commit_sha === expectedGitCommitSha;
    expect(evidence.deployment_id, "production deployment ID must be present").toBeTruthy();
    expect(evidence.exact_sha_match, "production health must match the requested Git SHA").toBe(true);
    const healthRequestId = healthResponse.headers.get("x-request-id") || healthResponse.headers.get("x-vercel-id");
    if (healthRequestId) requestIds.add(healthRequestId);
    evidence.stages.health = {
      passed: true,
      http_status: healthResponse.status,
      deployment_id: evidence.deployment_id,
      exact_sha_match: true
    };

    const files = await materializeRealSourceImages(baseUrl, launchGateSecret);
    evidence.stages.real_image_materialization = { passed: true, image_count: files.length };

    // Login is a real browser journey, but is intentionally isolated from HAR
    // and trace so administrator credentials can never enter uploaded artifacts.
    loginContext = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1440, height: 1000 } });
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
    journeyPage = await journeyContext.newPage();
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
    const uploadInput = journeyPage.getByTestId("image-upload-input");
    await uploadInput.setInputFiles(files);
    const startButton = journeyPage.getByTestId("start-recognition");
    await expect(startButton).toBeEnabled({ timeout: 90_000 });
    evidence.stages.upload = { passed: true, image_count: files.length };

    await startButton.click();
    evidence.stages.enqueue = { passed: true };

    const titleInput = journeyPage.getByTestId("writer-title-input").first();
    await expect(titleInput).toBeEnabled({ timeout: 6 * 60 * 1000 });
    await expect(titleInput).not.toHaveValue("");
    const title = await titleInput.inputValue();
    expect(title.length).toBeLessThanOrEqual(80);
    await Promise.allSettled([...responseCaptureTasks]);
    const observedJobIds = [...ids.job_id];
    expect(observedJobIds.length, "job_id must be captured before validating Worker completion").toBeGreaterThan(0);
    const jobStatusResponse = await journeyContext.request.get(
      `/api/v4/listing-job-status?job_ids=${encodeURIComponent(observedJobIds.join(","))}`
    );
    const jobStatusPayload = await jobStatusResponse.json();
    addIds(jobStatusPayload, ids);
    expect(jobStatusResponse.ok(), "full job status read must succeed").toBeTruthy();
    const l2Job = (jobStatusPayload.jobs || []).find((job) => (
      String(job?.status || "").toUpperCase() === "L2_READY"
      && String(job?.l2_status || "").toUpperCase() === "READY"
    ));
    expect(l2Job, "a durable L2_READY job must exist").toBeTruthy();
    expect(l2Job.recognition_started_at, "Worker recognition start must be recorded").toBeTruthy();
    expect(l2Job.recognition_completed_at, "Worker recognition completion must be recorded").toBeTruthy();
    const workerNode = l2Job.end_to_end_node_ledger?.nodes?.find((node) => node?.node_id === "worker_execution");
    expect(workerNode?.status, "Worker execution must be proven by the node ledger").toBe("COMPLETED");
    evidence.stages.status = {
      passed: true,
      endpoint: "job",
      terminal_job_status: "L2_READY",
      worker_execution_status: "COMPLETED"
    };
    evidence.stages.l2_ready = {
      passed: true,
      title_length: title.length,
      recognition_started_recorded: true,
      recognition_completed_recorded: true
    };

    // This is an administrator-only production Journey. A deliberately distinct
    // edit proves the EDIT path, while the API contract below proves it remains
    // excluded from training and production promotion.
    const editedTitle = e2eEditedTitle(title);
    await titleInput.fill(editedTitle);
    const acceptButton = journeyPage.getByTestId("accept-writer-title").first();
    await expect(acceptButton).toBeEnabled();
    const persistenceResponsePromise = journeyPage.waitForResponse((response) => (
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v4/listing-feedback"
    ), { timeout: 45_000 });
    await acceptButton.click();
    const persistenceResponse = await persistenceResponsePromise;
    const persistencePayload = await persistenceResponse.json();
    addIds(persistencePayload, ids);
    expect(persistenceResponse.ok(), "feedback persistence request must succeed").toBeTruthy();
    expect(persistencePayload?.v4_persistence?.transaction?.saved, "feedback transaction must be durable").toBe(true);
    expect(persistencePayload.status, "the Journey must exercise EDIT rather than ACCEPT").toBe("EDITED");
    expect(persistencePayload.writer_raw_title, "the server must retain the submitted edit for audit").toBe(editedTitle);
    expect(persistencePayload.writer_final_title, "the edited title must remain distinct after canonicalization").not.toBe(title);
    const persistedEditedTitle = String(persistencePayload.writer_final_title || "").trim();
    expect(persistedEditedTitle).toBeTruthy();
    expect(persistencePayload.training_eligible, "administrator Journey output must never enter training").toBe(false);
    expect(persistencePayload.production_promotion_eligible, "administrator Journey output must never be promoted").toBe(false);
    expect(persistencePayload.dataset_disposition, "outer feedback event remains observation-only").toBe("OBSERVE_ONLY");
    expect(persistencePayload.feedback_data_use, "the embedded writer feedback must remain admin-test only").toBe("ADMIN_TEST_ONLY");
    const adminTestProof = persistencePayload.admin_test_persistence_proof;
    expect(adminTestProof?.verified, "PostgreSQL must prove the administrator edit stayed outside replay authority").toBe(true);
    expect(adminTestProof?.feedback_event_verified).toBe(true);
    expect(adminTestProof?.learning_event_verified).toBe(true);
    expect(adminTestProof?.session_projection_verified).toBe(true);
    expect(adminTestProof?.image_generation_hash_verified).toBe(true);
    expect(adminTestProof?.writer_final_replay_excluded).toBe(true);
    expect(adminTestProof?.active_writer_final_replay_source_count).toBe(0);
    expect(adminTestProof?.active_admin_test_replay_for_image_count).toBe(0);
    evidence.stages.accept_edit = {
      passed: true,
      action: "EDIT",
      title_changed: true,
      training_eligible: false,
      production_promotion_eligible: false,
      feedback_data_use: "ADMIN_TEST_ONLY",
      admin_test_persistence_verified: true,
      writer_final_replay_excluded: true
    };

    const sessionId = String(persistencePayload.recognition_session_id || l2Job.recognition_session_id || "").trim();
    expect(sessionId, "recognition_session_id must be available for read-after-write").toBeTruthy();
    const persistedSessionResponse = await journeyContext.request.get(
      `/api/v4/listing-session-status?recognition_session_id=${encodeURIComponent(sessionId)}`
    );
    const persistedSessionPayload = await persistedSessionResponse.json();
    addIds(persistedSessionPayload, ids);
    expect(persistedSessionResponse.ok(), "session read-after-write must succeed").toBeTruthy();
    expect(persistedSessionPayload?.session?.status).toBe("EDITED");
    expect(persistedSessionPayload?.session?.writer_final_title).toBe(persistedEditedTitle);
    expect(persistedSessionPayload?.session?.writer_feedback_event_id).toBe(persistencePayload.feedback_event_id);
    evidence.stages.persistence = {
      passed: true,
      http_status: persistenceResponse.status(),
      read_after_write: true,
      persisted_status: "EDITED",
      feedback_event_link_verified: true
    };

    // A persisted writer card intentionally leaves the visible eight-card
    // workbench immediately, so its transient status node may already be gone.
    // The HTTP transaction proof above is the durable persistence assertion.
    await Promise.allSettled([...responseCaptureTasks]);
    const statusObserved = apiPaths.has("/api/v4/listing-job-status") || apiPaths.has("/api/v4/listing-session-status");
    expect(statusObserved, "the UI must observe durable job/session status before L2").toBe(true);
    expect(ids.asset_id.size, "asset_id must be captured").toBeGreaterThan(0);
    expect(ids.batch_id.size, "batch_id must be captured").toBeGreaterThan(0);
    expect(ids.job_id.size, "job_id must be captured").toBeGreaterThan(0);
    expect(ids.session_id.size, "session_id must be captured").toBeGreaterThan(0);
    expect(requestIds.size, "request_id must be captured").toBeGreaterThan(0);
    evidence.all_required_stages_passed = requiredStageIds.every((stageId) => evidence.stages[stageId]?.passed === true);
    expect(evidence.all_required_stages_passed, "all required Writer Journey stages must pass").toBe(true);
    evidence.passed = true;
  } catch (error) {
    evidence.error = sanitizedError(error, sensitiveValues);
    // Login pages contain credential inputs and are never screenshotted. Once
    // authenticated, screenshots mask every editable control and contain no
    // HTTP headers, cookies, storage state, HAR, or trace data.
    evidence.artifact_safety.failure_screenshot_created = await writeSafeFailureScreenshot(journeyPage);
    throw error;
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
    const provisional = JSON.stringify(evidence);
    assertSensitiveValuesAbsent(provisional, sensitiveValues);
    evidence.artifact_safety.sensitive_value_scan_passed = true;
    evidence.artifact_safety.safe_to_upload = true;
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    assertSensitiveValuesAbsent(serialized, sensitiveValues);
    await writeFile(evidencePath, serialized, { encoding: "utf8", mode: 0o600 });
    if (!evidence.passed) {
      await testInfo.attach("writer-journey-evidence", { path: evidencePath, contentType: "application/json" }).catch(() => {});
    }
  }
});
