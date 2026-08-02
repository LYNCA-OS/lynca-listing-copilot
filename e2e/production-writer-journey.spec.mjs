import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { launchGateImageSourceRecords } from "../lib/listing/evaluation/launch-gate-image-source-index.generated.mjs";

const artifactDir = path.resolve("artifacts/production-writer-journey");
const evidencePath = path.join(artifactDir, "evidence.json");
const screenshotPath = path.join(artifactDir, "failure.png");
const tracePath = path.join(artifactDir, "failure-trace.zip");
const harPath = path.join(artifactDir, "journey.har");

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function cleanBaseUrl(value) {
  return String(value || "https://listing.lyncafei.team").replace(/\/+$/, "");
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
  await mkdir(artifactDir, { recursive: true });
  const baseUrl = cleanBaseUrl(process.env.WRITER_JOURNEY_BASE_URL);
  const username = requiredEnv("METAVERSE_USERNAME");
  const password = requiredEnv("METAVERSE_PASSWORD");
  const launchGateSecret = requiredEnv("LAUNCH_GATE_EVAL_SECRET");
  const evidence = {
    schema_version: "production-writer-journey-evidence-v1",
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
  const responseCaptureTasks = new Set();
  let loginContext;
  let loginPage;
  let journeyContext;
  let journeyPage;
  let journeyTracing = false;

  try {
    const healthResponse = await fetch(`${baseUrl}/api/health`, { headers: { accept: "application/json" } });
    const health = await healthResponse.json();
    expect(healthResponse.ok, "production health must be reachable").toBeTruthy();
    evidence.deployment_id = deploymentId(health);
    const healthRequestId = healthResponse.headers.get("x-request-id") || healthResponse.headers.get("x-vercel-id");
    if (healthRequestId) requestIds.add(healthRequestId);
    evidence.stages.health = { passed: true, http_status: healthResponse.status };

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
    const files = await materializeRealSourceImages(baseUrl, launchGateSecret);
    evidence.stages.real_image_materialization = { passed: true, image_count: files.length };
    const storageState = await loginContext.storageState();
    evidence.stages.login = { passed: true, final_path: new URL(loginPage.url()).pathname };
    await loginContext.close();
    loginContext = null;
    loginPage = null;

    journeyContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1000 },
      storageState,
      recordHar: { path: harPath, mode: "full", content: "attach" }
    });
    await journeyContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
    journeyTracing = true;
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
    await expect(startButton).toBeHidden();
    evidence.stages.upload = { passed: true, image_count: files.length };
    const titleInput = journeyPage.getByTestId("writer-title-input").first();
    await expect(titleInput).toBeEnabled({ timeout: 6 * 60 * 1000 });
    // The disabled/empty state uses a visible placeholder-like fallback value
    // in the input. Waiting only for a non-empty value races the async CSM
    // response and can submit that fallback as writer feedback. Wait for a
    // real resolved title, then read it once for the persistence assertion.
    await expect.poll(
      async () => (await titleInput.inputValue()).trim(),
      { timeout: 6 * 60 * 1000, intervals: [250, 500, 1_000, 2_000] }
    ).toMatch(/^(?!标题暂不可用$).{1,80}$/);
    const title = await titleInput.inputValue();
    expect(title.length).toBeLessThanOrEqual(80);
    evidence.stages.recognition = { passed: true, route: "/api/csm-listing-title", title_length: title.length };

    // Exercise edit handling without changing the generated commercial title.
    await titleInput.fill(title);
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
    evidence.stages.persistence = { passed: true, http_status: persistenceResponse.status() };

    // A persisted writer card intentionally leaves the visible eight-card
    // workbench immediately, so its transient status node may already be gone.
    // The HTTP transaction proof above is the durable persistence assertion.
    await Promise.allSettled([...responseCaptureTasks]);
    const statusObserved = apiPaths.has("/api/csm-listing-title");
    expect(statusObserved, "the UI must receive the direct CSM recognition response before L2").toBe(true);
    expect(ids.asset_id.size, "asset_id must be captured").toBeGreaterThan(0);
    expect(ids.session_id.size, "session_id must be captured").toBeGreaterThan(0);
    expect(requestIds.size, "request_id must be captured").toBeGreaterThan(0);
    evidence.stages.status = { passed: true, endpoint: "/api/csm-listing-title" };
    evidence.passed = true;
  } catch (error) {
    evidence.error = String(error?.message || error).slice(0, 1000);
    const page = journeyPage || loginPage;
    if (page) await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    throw error;
  } finally {
    evidence.finished_at = new Date().toISOString();
    await Promise.allSettled([...responseCaptureTasks]);
    evidence.request_ids = [...requestIds];
    evidence.asset_ids = [...ids.asset_id];
    evidence.batch_ids = [...ids.batch_id];
    evidence.job_ids = [...ids.job_id];
    evidence.session_ids = [...ids.session_id];
    if (journeyContext && journeyTracing) {
      if (evidence.passed) await journeyContext.tracing.stop().catch(() => {});
      else await journeyContext.tracing.stop({ path: tracePath }).catch(() => {});
    }
    await journeyContext?.close().catch(() => {});
    await loginContext?.close().catch(() => {});
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (!evidence.passed) {
      await testInfo.attach("writer-journey-evidence", { path: evidencePath, contentType: "application/json" }).catch(() => {});
    }
  }
});
