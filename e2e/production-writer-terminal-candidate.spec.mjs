// Candidate-only acceptance for the conversation Writer Terminal (COS-64).
//
// This is deliberately not an ordinary CI test: it spends thirty real model
// calls and writes an isolated tenant. Authentication is a short-lived session
// minted from the server secret for the synthetic principal; no operator
// password or browser profile is read.
//
// Required inputs:
//   WRITER_TERMINAL_BASE_URL=https://<candidate>.vercel.app
//   WRITER_TERMINAL_EXPECTED_SHA=<40 hex git sha>
//   WRITER_TERMINAL_INITIAL_STORAGE_STATE=/tmp/vercel-candidate-state.json
//   WRITER_TERMINAL_GAMMA_MANIFEST=/path/to/gamma/manifest.json
//   WRITER_TERMINAL_TITLE_PROJECTION=/path/to/founder-ebay-title-projection-v1.json
//   WRITER_TERMINAL_SOURCE_ROOT=/path/to/Gamma\ Training
//   METAVERSE_AUTH_SECRET=...
//   SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=...
//
// The tenant/user membership must already exist and be ACTIVE:
//   tenant_acceptance_cos64 / user_acceptance_cos64
//
// Run:
//   npm run test:e2e:writer-terminal-candidate:chrome
//
// The evidence file never contains cookies, secrets, response headers, signed
// download URLs, or full provider payloads. Cleanup is not automatic: the
// exact tenant, row ids, and storage prefix are sealed into the evidence first.

import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "../lib/vendor/exceljs-browser/exceljs.min.js";
import { createListingSessionToken, cookieName } from "../lib/listing-session.mjs";
import { readV4Rows } from "../lib/listing/v4/session/supabase-rest.mjs";

const artifactDir = path.resolve("artifacts/production-writer-terminal-candidate");
const evidencePath = path.join(artifactDir, "evidence.json");
const workbookPath = path.join(artifactDir, "writer-terminal-29.xlsx");
const fixtureSize = 30;
const firstTurnSize = 10;
const rejectedAssetIndex = 2;
const retryAssetIndex = 3;
const defaultTenantId = "tenant_acceptance_cos64";
const defaultUserId = "user_acceptance_cos64";
const defaultEmail = "acceptance-cos64@listing.lynca.test";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function candidateOrigin(value) {
  const url = new URL(String(value || "").trim());
  if (url.protocol !== "https:" || url.origin !== String(value || "").trim()
      || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname)) {
    throw new Error("WRITER_TERMINAL_BASE_URL must be an exact https Vercel candidate origin");
  }
  return url.origin;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function titleSha256(value) {
  return sha256(Buffer.from(String(value || ""), "utf8"));
}

function clientAssetIndex(value) {
  const match = String(value || "").match(/^asset-(\d+)(?:-generation-\d+)?$/);
  return match ? Number(match[1]) : null;
}

function decodeIngestMetadata(request) {
  const encoded = request.headers()["x-lynca-ingest-metadata"];
  if (!encoded) return null;
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function safeError(error) {
  return String(error?.message || error || "unknown_error")
    .replace(/https?:\/\/\S+/gi, "[url-redacted]")
    .replace(/(token|secret|cookie)=[^\s&]+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function exactKeys(value, expected) {
  return value && typeof value === "object"
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

async function loadGammaFixture({ manifestPath, projectionPath, sourceRoot }) {
  const [manifestBytes, projectionBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(projectionPath)
  ]);
  const manifest = JSON.parse(manifestBytes);
  const projection = JSON.parse(projectionBytes);
  if (manifest.schema_version !== "csm-gamma-training-cohort-manifest-v1"
      || manifest.case_count !== 53 || manifest.image_count !== 106
      || projection.schema_version !== "csm-gamma-founder-ebay-title-projection-v1"
      || projection.summary?.total !== 53 || projection.summary?.within_budget !== 53
      || projection.policy?.title_authority !== "PRIMARY_FOR_GAMMA_53_EBAY_COMPOSER"
      || projection.policy?.all_cases_share_equal_authority !== true) {
    throw new Error("Gamma 53 authority contract invalid");
  }
  const sourceById = new Map(manifest.cases.map((entry) => [entry.case_id, entry]));
  if (sourceById.size !== 53 || new Set(projection.cases.map((entry) => entry.case_id)).size !== 53) {
    throw new Error("Gamma 53 case identity invalid");
  }

  const selected = [];
  for (const [offset, titleCase] of projection.cases.slice(0, fixtureSize).entries()) {
    const sourceCase = sourceById.get(titleCase.case_id);
    if (!sourceCase || !Array.isArray(sourceCase.images) || sourceCase.images.length !== 2
        || sourceCase.images[0]?.role !== "FRONT" || sourceCase.images[1]?.role !== "BACK"
        || !/^.{1,80}$/u.test(String(titleCase.ebay_title || ""))) {
      throw new Error(`Gamma fixture case invalid: ${titleCase.case_id}`);
    }
    const images = [];
    for (const image of sourceCase.images) {
      const absolutePath = path.resolve(sourceRoot, image.relative_path);
      const rootPrefix = `${path.resolve(sourceRoot)}${path.sep}`;
      if (!absolutePath.startsWith(rootPrefix)) throw new Error("Gamma image path escaped source root");
      const buffer = await readFile(absolutePath);
      if (buffer.byteLength !== Number(image.bytes) || sha256(buffer) !== image.sha256) {
        throw new Error(`Gamma image hash mismatch: ${titleCase.case_id}/${image.role}`);
      }
      images.push({
        name: `${String(offset + 1).padStart(2, "0")}-${image.role.toLowerCase()}.webp`,
        mimeType: "image/webp",
        buffer,
        role: image.role,
        sha256: image.sha256,
        relative_path: image.relative_path
      });
    }
    selected.push({
      asset_index: offset + 1,
      case_id: titleCase.case_id,
      expected_title: titleCase.ebay_title,
      images
    });
  }
  return Object.freeze({
    manifest_sha256: sha256(manifestBytes),
    projection_sha256: sha256(projectionBytes),
    collection_sha256: manifest.collection_sha256,
    cases: Object.freeze(selected)
  });
}

async function candidateStorageState({ baseUrl, initialStatePath, token }) {
  const hostname = new URL(baseUrl).hostname;
  const initial = initialStatePath
    ? JSON.parse(await readFile(initialStatePath, "utf8"))
    : { cookies: [], origins: [] };
  if (!Array.isArray(initial.cookies) || !Array.isArray(initial.origins)
      || initial.origins.length !== 0
      || initial.cookies.some((cookie) => (
        String(cookie.domain || "").replace(/^\./, "").toLowerCase() !== hostname
        || cookie.path !== "/" || cookie.secure !== true
      ))) {
    throw new Error("WRITER_TERMINAL_INITIAL_STORAGE_STATE is not candidate-bound");
  }
  return {
    cookies: [
      ...initial.cookies.filter((cookie) => cookie.name !== cookieName),
      {
        name: cookieName,
        value: token,
        domain: hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        expires: -1
      }
    ],
    origins: []
  };
}

function sourceFiles(cases) {
  return cases.flatMap((entry) => entry.images.map(({ name, mimeType, buffer }) => ({
    name, mimeType, buffer
  })));
}

async function waitForDirectory(page, { assets, results }) {
  await page.waitForFunction(({ expectedAssets, expectedResults }) => {
    const snapshot = globalThis.__writerTerminalAcceptanceHooks?.listingCopilotStateSnapshot?.();
    return snapshot?.assetIndexes?.length === expectedAssets
      && snapshot?.resultIndexes?.length === expectedResults
      && snapshot.preparingFiles === false
      && snapshot.processing === false;
  }, { expectedAssets: assets, expectedResults: results }, { timeout: 20 * 60 * 1000 });
}

async function waitForTitle(page, index) {
  const input = page.locator(`[data-title-input="${index}"]`);
  await expect(input).toBeEnabled({ timeout: 10 * 60 * 1000 });
  await expect.poll(async () => String(await input.inputValue()).trim(), {
    timeout: 10 * 60 * 1000,
    intervals: [500, 1_000, 2_000]
  }).toMatch(/^.{1,80}$/u);
  return String(await input.inputValue()).trim();
}

async function responseJson(response) {
  try { return await response.json(); } catch { return null; }
}

function sanitizedRecognition(payload = {}) {
  return {
    asset_id: String(payload.asset_id || ""),
    client_asset_ref: String(payload.client_asset_ref || ""),
    recognition_session_id: String(payload.recognition_session_id || ""),
    route: String(payload.route || ""),
    title_sha256: titleSha256(payload.title),
    title_length: String(payload.title || "").length,
    trace_status: String(payload.trace_status || "")
  };
}

function inFilter(values) {
  const safe = [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  if (safe.some((value) => !/^[a-zA-Z0-9_-]+$/.test(value))) throw new Error("unsafe readback id");
  return `in.(${safe.map((value) => `"${value}"`).join(",")})`;
}

async function requireReadback(options) {
  const result = await readV4Rows(options);
  if (!result.ok) throw new Error(`${options.table} readback failed: ${result.error}`);
  return result.rows;
}

test("@candidate authenticated 10 + 20 Writer Terminal journey seals export and DB receipts", async ({ browser }) => {
  test.setTimeout(40 * 60 * 1000);
  await mkdir(artifactDir, { recursive: true });

  const baseUrl = candidateOrigin(requiredEnv("WRITER_TERMINAL_BASE_URL"));
  const expectedSha = requiredEnv("WRITER_TERMINAL_EXPECTED_SHA");
  if (!/^[0-9a-f]{40}$/.test(expectedSha)) throw new Error("WRITER_TERMINAL_EXPECTED_SHA invalid");
  const tenantId = String(process.env.WRITER_TERMINAL_TENANT_ID || defaultTenantId).trim();
  const userId = String(process.env.WRITER_TERMINAL_USER_ID || defaultUserId).trim();
  const email = String(process.env.WRITER_TERMINAL_EMAIL || defaultEmail).trim();
  if (!/^tenant_[a-z0-9][a-z0-9_-]{0,62}$/.test(tenantId)
      || !/^user_[a-z0-9][a-z0-9_-]{0,62}$/.test(userId)
      || !email.endsWith(".test")) {
    throw new Error("isolated Writer Terminal principal invalid");
  }
  const fixture = await loadGammaFixture({
    manifestPath: requiredEnv("WRITER_TERMINAL_GAMMA_MANIFEST"),
    projectionPath: requiredEnv("WRITER_TERMINAL_TITLE_PROJECTION"),
    sourceRoot: requiredEnv("WRITER_TERMINAL_SOURCE_ROOT")
  });
  const token = createListingSessionToken({
    user_id: userId,
    tenant_id: tenantId,
    email,
    session_version: 1
  }, requiredEnv("METAVERSE_AUTH_SECRET"));
  const storageState = await candidateStorageState({
    baseUrl,
    initialStatePath: String(process.env.WRITER_TERMINAL_INITIAL_STORAGE_STATE || "").trim(),
    token
  });

  const evidence = {
    schema_version: "production-writer-terminal-candidate-evidence-v1",
    evidence_scope: "AUTHENTICATED_RUNTIME_WORKFLOW_NOT_GLOBAL_ACCURACY",
    passed: false,
    base_url: baseUrl,
    deployment_git_commit_sha: expectedSha,
    tenant_id: tenantId,
    user_id: userId,
    started_at: new Date().toISOString(),
    fixture: {
      authority: "PRIMARY_FOR_GAMMA_53_EBAY_COMPOSER",
      population: 53,
      selected: fixtureSize,
      manifest_sha256: fixture.manifest_sha256,
      projection_sha256: fixture.projection_sha256,
      collection_sha256: fixture.collection_sha256,
      order: fixture.cases.map((entry) => ({
        asset_index: entry.asset_index,
        case_id: entry.case_id,
        front_sha256: entry.images[0].sha256,
        back_sha256: entry.images[1].sha256
      }))
    },
    stages: {},
    quality: null,
    cleanup_targets: {
      tenant_id: tenantId,
      storage_prefix: `tenants/${tenantId}/`,
      asset_ids: [],
      recognition_session_ids: [],
      feedback_event_ids: [],
      learning_event_ids: [],
      export_batch_ids: [],
      storage_objects: []
    }
  };

  let context;
  let failure = null;
  const captureTasks = new Set();
  const recognitionReceipts = [];
  let targetDurableAssetId = "";
  let forcedIngestAborted = false;
  let forcedDirectFailure = false;
  try {
    context = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1000 },
      storageState,
      acceptDownloads: true,
      serviceWorkers: "block"
    });

    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== baseUrl || request.method() !== "POST") {
        await route.continue();
        return;
      }
      if (url.pathname === "/api/csm-listing-title-ingest") {
        const metadata = decodeIngestMetadata(request);
        if (!forcedIngestAborted
            && clientAssetIndex(metadata?.clientAssetRef) === retryAssetIndex) {
          forcedIngestAborted = true;
          await route.abort("connectionfailed");
          return;
        }
      }
      if (url.pathname === "/api/listing-asset-create") {
        const body = request.postDataJSON();
        if (clientAssetIndex(body?.client_asset_ref) === retryAssetIndex) {
          const upstream = await route.fetch();
          const payload = await responseJson(upstream);
          targetDurableAssetId = String(payload?.asset_id || "");
          if (!/^asset_[0-9a-f-]{36}$/i.test(targetDurableAssetId)) {
            await route.fulfill({ response: upstream });
            return;
          }
          await route.fulfill({ response: upstream });
          return;
        }
      }
      if (url.pathname === "/api/csm-listing-title" && targetDurableAssetId
          && request.postDataJSON()?.asset_id === targetDurableAssetId
          && !forcedDirectFailure) {
        forcedDirectFailure = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            retryable: true,
            code: "ACCEPTANCE_FORCED_ONCE",
            message: "Controlled candidate acceptance failure"
          })
        });
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    page.on("response", (response) => {
      const request = response.request();
      const pathname = new URL(response.url()).pathname;
      if (request.method() !== "POST"
          || !["/api/csm-listing-title", "/api/csm-listing-title-ingest"].includes(pathname)) return;
      const task = responseJson(response).then((payload) => {
        if (response.ok() && payload?.ok === true && payload?.recognition_session_id) {
          recognitionReceipts.push(sanitizedRecognition(payload));
        }
      }).finally(() => captureTasks.delete(task));
      captureTasks.add(task);
    });

    const health = await context.request.get("/api/health", { failOnStatusCode: false });
    const healthPayload = await health.json();
    expect(health.ok()).toBe(true);
    expect(healthPayload.ready).toBe(true);
    expect(healthPayload.deployment?.git_commit_sha).toBe(expectedSha);
    evidence.stages.health = { passed: true, status: health.status(), exact_sha: true };

    const session = await context.request.get("/api/session", { failOnStatusCode: false });
    const sessionPayload = await session.json();
    expect(session.ok()).toBe(true);
    expect(sessionPayload).toMatchObject({
      authenticated: true,
      user_id: userId,
      tenant_id: tenantId,
      email
    });

    await page.goto("/app/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("image-upload-input")).toBeAttached();
    await page.evaluate(async () => {
      const module = await import("/app/listing-copilot.js");
      globalThis.__writerTerminalAcceptanceHooks = module.__listingCopilotAppTestHooks;
    });
    evidence.stages.auth = {
      passed: true,
      method: "server_secret_minted_isolated_session",
      user_id: userId,
      tenant_id: tenantId,
      role: String(sessionPayload.role || "")
    };

    const firstTurn = sourceFiles(fixture.cases.slice(0, firstTurnSize));
    const secondTurn = sourceFiles(fixture.cases.slice(firstTurnSize));
    expect(firstTurn).toHaveLength(20);
    expect(secondTurn).toHaveLength(40);

    await page.getByTestId("image-upload-input").setInputFiles(firstTurn);
    await waitForDirectory(page, { assets: 10, results: 10 });
    expect(forcedIngestAborted).toBe(true);
    expect(forcedDirectFailure).toBe(true);
    await expect(page.locator(`[data-retry-recognition="${retryAssetIndex}"]`)).toBeEnabled();
    evidence.stages.turn_1 = {
      passed: true,
      image_count: 20,
      card_count: 10,
      controlled_failure_asset_index: retryAssetIndex,
      failure_injected_before_provider: true
    };

    await page.getByTestId("image-upload-input").setInputFiles(secondTurn);
    await waitForDirectory(page, { assets: 30, results: 30 });
    await expect(page.locator(".terminal-result-card")).toHaveCount(30);
    evidence.stages.turn_2 = { passed: true, image_count: 40, appended_card_count: 20, directory_count: 30 };

    await page.locator(`[data-retry-recognition="${retryAssetIndex}"]`).click();
    const retriedTitle = await waitForTitle(page, retryAssetIndex);
    await expect(page.locator(`[data-retry-recognition="${retryAssetIndex}"]`)).toHaveCount(0);
    evidence.stages.retry = {
      passed: true,
      asset_index: retryAssetIndex,
      attempt_count: 2,
      final_title_length: retriedTitle.length,
      final_title_sha256: titleSha256(retriedTitle)
    };

    const observedTitles = [];
    for (const entry of fixture.cases) {
      observedTitles.push(await waitForTitle(page, entry.asset_index));
    }
    evidence.quality = {
      denominator: fixtureSize,
      exact_match_count: observedTitles.filter((title, index) => title === fixture.cases[index].expected_title).length,
      global_accuracy_claim: null,
      cases: observedTitles.map((title, index) => ({
        asset_index: index + 1,
        case_id: fixture.cases[index].case_id,
        actual_title_sha256: titleSha256(title),
        expected_title_sha256: titleSha256(fixture.cases[index].expected_title),
        exact: title === fixture.cases[index].expected_title,
        title_length: title.length
      }))
    };

    await page.setViewportSize({ width: 390, height: 844 });
    const narrowOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    ));
    expect(narrowOverflow).toBe(false);
    await page.setViewportSize({ width: 1440, height: 1000 });

    const standardButton = page.locator('button[data-workspace-mode="standard"]');
    const writerButton = page.locator('button[data-workspace-mode="writer"]');
    await standardButton.click();
    await expect(standardButton).toHaveAttribute("aria-pressed", "true");
    await writerButton.click();
    await expect(writerButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".terminal-result-card")).toHaveCount(30);
    evidence.stages.projection_switch = {
      passed: true,
      sequence: ["writer", "standard", "writer"],
      directory_count_after_return: 30,
      narrow_overflow: false
    };

    const editEntry = fixture.cases.find((entry, index) => (
      entry.asset_index !== rejectedAssetIndex
      && entry.asset_index !== retryAssetIndex
      && observedTitles[index] !== entry.expected_title
    )) || fixture.cases[0];
    const editInput = page.locator(`[data-title-input="${editEntry.asset_index}"]`);
    const generatedBeforeEdit = String(await editInput.inputValue()).trim();
    await editInput.fill("");
    await editInput.fill(editEntry.expected_title);
    const saveResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v4/listing-feedback"
      && response.request().method() === "POST"
      && response.request().postDataJSON()?.recognition_session_id
    ));
    await page.locator(`[data-save-title="${editEntry.asset_index}"]`).click();
    const saveResponse = await saveResponsePromise;
    const savePayload = await responseJson(saveResponse);
    expect(saveResponse.ok()).toBe(true);
    expect(savePayload?.ok).toBe(true);
    expect(savePayload?.v4_persistence?.transaction?.saved).toBe(true);
    expect(savePayload?.writer_final_title).toBe(editEntry.expected_title);
    expect(savePayload?.training_eligible).toBe(false);
    evidence.stages.edit_save = {
      passed: true,
      asset_index: editEntry.asset_index,
      generated_title_sha256: titleSha256(generatedBeforeEdit),
      saved_title_sha256: titleSha256(editEntry.expected_title),
      content_changed_at_least_once: true,
      feedback_submission_id: String(savePayload.feedback_submission_id || ""),
      feedback_event_id: String(savePayload.feedback_event_id || ""),
      learning_event_id: String(savePayload.learning_event_id || ""),
      transaction_saved: true,
      training_eligible: savePayload.training_eligible === true
    };

    const rejectResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v4/listing-feedback"
      && response.request().method() === "POST"
      && response.request().postDataJSON()?.action === "REJECT"
    ));
    await page.locator(`[data-reject-title="${rejectedAssetIndex}"]`).click();
    const rejectResponse = await rejectResponsePromise;
    const rejectPayload = await responseJson(rejectResponse);
    expect(rejectResponse.ok()).toBe(true);
    expect(rejectPayload?.ok).toBe(true);
    expect(rejectPayload?.status).toBe("REJECTED");
    expect(rejectPayload?.v4_persistence?.transaction?.saved).toBe(true);
    expect(rejectPayload?.training_eligible).toBe(false);
    evidence.stages.reject = {
      passed: true,
      asset_index: rejectedAssetIndex,
      feedback_submission_id: String(rejectPayload.feedback_submission_id || ""),
      feedback_event_id: String(rejectPayload.feedback_event_id || ""),
      learning_event_id: String(rejectPayload.learning_event_id || ""),
      transaction_saved: true,
      training_eligible: rejectPayload.training_eligible === true
    };

    await standardButton.click();
    await expect(standardButton).toHaveAttribute("aria-pressed", "true");
    const exportRequestPromise = page.waitForRequest((request) => (
      new URL(request.url()).pathname === "/api/v4/listing-export-workbook"
      && request.method() === "POST"
    ));
    const exportResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/v4/listing-export-workbook"
      && response.request().method() === "POST"
    ));
    const downloadPromise = page.waitForEvent("download", { timeout: 3 * 60 * 1000 });
    await page.locator("#exportWorkbookButton").click();
    const [exportRequest, exportResponse, download] = await Promise.all([
      exportRequestPromise, exportResponsePromise, downloadPromise
    ]);
    const exportRequestBody = exportRequest.postDataJSON();
    const exportPayload = await responseJson(exportResponse);
    expect(exportResponse.ok()).toBe(true);
    expect(exportPayload?.ok).toBe(true);
    expect(exportPayload?.tenant_id).toBe(tenantId);
    expect(exportPayload?.asset_count).toBe(29);
    expect(exportPayload?.item_count).toBe(29);
    expect(exportPayload?.manifest).toMatchObject({
      training_use: "operational_only_never_training",
      training_eligible: false,
      training_admission: "requires_independent_persisted_review_event"
    });
    expect(exportRequestBody?.rows).toHaveLength(29);
    expect(exportRequestBody.rows.some((row) => Number(row.asset_index) === rejectedAssetIndex)).toBe(false);
    expect(exportRequestBody.rows.every((row) => /^.{1,80}$/u.test(String(row.final_title || "")))).toBe(true);
    await download.saveAs(workbookPath);

    const workbook = new ExcelJS.Workbook();
    const workbookBytes = await readFile(workbookPath);
    await workbook.xlsx.load(workbookBytes);
    const sheet = workbook.getWorksheet("Writer Export");
    expect(sheet).toBeTruthy();
    expect(sheet.rowCount).toBe(30);
    const workbookRows = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const assetLabel = String(sheet.getCell(rowNumber, 1).value || "");
      const title = String(sheet.getCell(rowNumber, 4).value || "").trim();
      workbookRows.push({
        asset_index: Number(assetLabel.match(/^Asset (\d+)$/)?.[1]),
        final_title: title
      });
    }
    expect(workbookRows).toHaveLength(29);
    expect(workbookRows.some((row) => row.asset_index === rejectedAssetIndex)).toBe(false);
    expect(workbookRows.every((row) => /^.{1,80}$/u.test(row.final_title))).toBe(true);
    expect(workbookRows.find((row) => row.asset_index === editEntry.asset_index)?.final_title)
      .toBe(editEntry.expected_title);
    evidence.stages.export_api_and_xlsx = {
      passed: true,
      batch_id: String(exportPayload.batch_id || ""),
      tenant_id: String(exportPayload.tenant_id || ""),
      asset_count: exportPayload.asset_count,
      item_count: exportPayload.item_count,
      file_name: String(exportPayload.file_name || ""),
      file_size_bytes: workbookBytes.byteLength,
      storage_bucket: String(exportPayload.storage_bucket || ""),
      storage_object_path: String(exportPayload.storage_object_path || ""),
      rejected_asset_indexes: [rejectedAssetIndex],
      title_limit_passed: true,
      operational_only: true,
      download_url_retained: false
    };

    await Promise.all([...captureTasks]);
    const dedupedRecognitions = [...new Map(recognitionReceipts.map((row) => [
      row.recognition_session_id, row
    ])).values()];
    expect(dedupedRecognitions).toHaveLength(30);
    expect(dedupedRecognitions.every((row) => row.trace_status === "PERSISTED"
      && /^[0-9a-f]{64}$/.test(row.title_sha256)
      && row.title_length >= 1 && row.title_length <= 80)).toBe(true);

    const feedbackIds = [savePayload.feedback_event_id, rejectPayload.feedback_event_id];
    const sessionIds = dedupedRecognitions.map((row) => row.recognition_session_id);
    const [batchRows, itemRows, feedbackRows, sessionRows] = await Promise.all([
      requireReadback({
        table: "v4_writer_export_batches",
        select: "id,tenant_id,status,exported_by,asset_count,item_count,storage_bucket,storage_object_path,file_name,file_size_bytes,manifest",
        search: { tenant_id: `eq.${tenantId}`, id: `eq.${exportPayload.batch_id}`, limit: "1" }
      }),
      requireReadback({
        table: "v4_writer_export_items",
        select: "id,tenant_id,export_batch_id,recognition_session_id,asset_id,asset_index,final_title,training_use",
        search: { tenant_id: `eq.${tenantId}`, export_batch_id: `eq.${exportPayload.batch_id}`, order: "asset_index.asc", limit: "40" }
      }),
      requireReadback({
        table: "v4_writer_feedback_events",
        select: "id,tenant_id,recognition_session_id,action,writer_final_title,operator_id",
        search: { tenant_id: `eq.${tenantId}`, id: inFilter(feedbackIds), limit: "2" }
      }),
      requireReadback({
        table: "v4_recognition_sessions",
        select: "id,tenant_id,status,asset_id,final_title,writer_final_title,writer_feedback_event_id,operator_id",
        search: { tenant_id: `eq.${tenantId}`, id: inFilter(sessionIds), limit: "40" }
      })
    ]);
    expect(batchRows).toHaveLength(1);
    expect(batchRows[0]).toMatchObject({
      id: exportPayload.batch_id,
      tenant_id: tenantId,
      status: "READY",
      exported_by: userId,
      asset_count: 29,
      item_count: 29
    });
    expect(batchRows[0].manifest).toMatchObject({
      training_use: "operational_only_never_training",
      training_eligible: false,
      training_admission: "requires_independent_persisted_review_event"
    });
    expect(itemRows).toHaveLength(29);
    expect(itemRows.every((row) => row.tenant_id === tenantId
      && row.export_batch_id === exportPayload.batch_id
      && row.training_use === "operational_only_never_training"
      && /^.{1,80}$/u.test(String(row.final_title || "")))).toBe(true);
    expect(itemRows.some((row) => Number(row.asset_index) === rejectedAssetIndex)).toBe(false);
    expect(feedbackRows).toHaveLength(2);
    expect(new Set(feedbackRows.map((row) => row.action))).toEqual(new Set([
      generatedBeforeEdit === editEntry.expected_title ? "ACCEPT" : "CORRECT",
      "REJECT"
    ]));
    expect(sessionRows).toHaveLength(30);
    expect(sessionRows.every((row) => row.tenant_id === tenantId)).toBe(true);
    evidence.stages.database_readback = {
      passed: true,
      recognition_sessions: sessionRows.length,
      feedback_events: feedbackRows.length,
      export_batches: batchRows.length,
      export_items: itemRows.length,
      tenant_bound: true,
      rejected_excluded: true,
      operational_only: true
    };

    const assetIds = [...new Set(sessionRows.map((row) => String(row.asset_id || "")).filter(Boolean))];
    evidence.cleanup_targets.asset_ids = assetIds;
    evidence.cleanup_targets.recognition_session_ids = sessionIds;
    evidence.cleanup_targets.feedback_event_ids = feedbackIds;
    evidence.cleanup_targets.learning_event_ids = [
      savePayload.learning_event_id, rejectPayload.learning_event_id
    ].filter(Boolean);
    evidence.cleanup_targets.export_batch_ids = [exportPayload.batch_id];
    evidence.cleanup_targets.storage_objects = [
      ...new Set([
        ...exportRequestBody.rows.flatMap((row) => row.images || [])
          .map((image) => String(image.object_path || image.objectPath || "")).filter(Boolean),
        String(exportPayload.storage_object_path || "")
      ].filter(Boolean))
    ];

    expect(exactKeys(evidence.stages.database_readback, [
      "passed", "recognition_sessions", "feedback_events", "export_batches",
      "export_items", "tenant_bound", "rejected_excluded", "operational_only"
    ])).toBe(true);
    await page.screenshot({ path: path.join(artifactDir, "writer-terminal-30.png"), fullPage: true });
    evidence.passed = true;
  } catch (error) {
    failure = error;
    evidence.failure = { message: safeError(error) };
    throw error;
  } finally {
    evidence.finished_at = new Date().toISOString();
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await context?.close();
    if (failure) process.stderr.write(`Writer Terminal candidate acceptance failed: ${safeError(failure)}\n`);
  }
});
