#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync, rmSync, symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const E1AE_PRODUCTION_SHA = "e1ae9a980e5825e6e81d5c6ce5a78d290e6d478c";
const FIXED_NOW = 1_786_665_600_000;
const verifyGitObject = process.argv.includes("--verify-git-object");
const currentRoot = process.cwd();
const oracleRoot = verifyGitObject
  ? mkdtempSync(join(tmpdir(), "lynca-e1ae-writer-oracle-"))
  : null;
const nativeDate = Date;

globalThis.Date = class OracleDate extends nativeDate {
  constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
  static now() { return FIXED_NOW; }
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: currentRoot,
    encoding: options.input == null ? "buffer" : undefined,
    maxBuffer: 64 * 1024 * 1024,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command}_failed:${String(result.stderr || result.stdout || "")}`);
  }
  return result;
};

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => [key, stableValue(value[key])]));
};
const stableJson = (value) => JSON.stringify(stableValue(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const load = (root, path, identity) => import(
  `${pathToFileURL(join(root, path)).href}?e1ae-oracle=${identity}`
);
const CAPTURED_E1AE_MANIFEST = Object.freeze({
  e1ae_production_sha: E1AE_PRODUCTION_SHA,
  writer_cases: {
    baseline: "a19fe6f0aecde553918c6b894bb338b8d0d7c5817915c8bfa6ae1eff768ce036",
    first_bowman: "899578c4a436bb75e9da374323e5ec6390ad24a2c4734a56ba5829309719c854",
    foreign_finish: "6bb2ecf56134de294ad07498ea985585591ec717d79f1923bd95e96f58393f5c",
    tcg: "23c87011d5962419d406fff3b80e83f6e8e4a3d09390c5ddb107d926e03dc6b1",
    lot: "7f9ddd241c810113b3f1a1ea6e76940c80152d45b4c850ce202f3dae664040c3",
    grading: "1cc5cf5fa1b02a5b4d65b831a5a9d89d17660b2563336816b621ef5cc108d191",
    special_stamp: "2e68d5316329e91f62eb88dd42a086eb5098935d0fd49266821f43a0b8e57916",
    description: "0e23cebd839ceb7c285aa7646676ba2f5c2efd99e5b49be779387f2a0737c10a",
    special_stamp_and_description:
      "b8bb7d7250fc6fc8da0dd5910e41f9d81f459931efbbcc54db950b7e13bf6f21",
    duplicate: "ebb23395fade900b1bba942b5ed7039cfc8339a62ae6242343af90575311f686",
    multi_codes: "929a8f97a0ac364b4354896347d110b8828f34e03fbe65ba21aeb073aac87509",
    overlay_v1: "71228a7df76caec98fec57ab63d10b58a8bee2624e30b66ca8fd8df8fb8f99e6",
    external_v2: "043353f1631553ee17e34d0f64adde2d6d6700f5d726c9e5fbf8124676b0ccab"
  },
  provider_http_wire_sha256:
    "229537d26afe033def9d6df2a5d2f28e914a2e152a6fa9f213f2cc4f08757e67",
  checkpoint_sha256:
    "1c9464e1323f1e7f17fee69269668a5215cc1f57f0b99dd5f1496eab0b20b0d1",
  persisted_owner_sha256:
    "8d62a928450a877becc7aeba6824ba4c9e692777666d89ca693db3c343240cab",
  resolution_views: {
    baseline: "b00c9db727ae29ee43e49f329adb2fe5cb9906b1afe974afd72d3cb7e27069cb",
    first_bowman: "55da06febb20b7eb8cb19fc28d0574de17c4335a54925873d0f562ff9665a55e",
    tcg: "2e642c5c50df70722d0327b66d43840ae740f10d70ff809e5ec0fc9e121cc4ac",
    lot: "c09a66d224b2eb92d417a1e78fba4483773dfbf6972cfb2d09c7129fabdea7a9",
    grading: "fe0340c793991ff6dbe5dcd94c45f955aaf76cdd62e75ebaac1360479c966bf5",
    overlay_v1: "73bc24c9a5a83d8670740acf1c53972f8981ce25353a3e5cbddb1121f91f11bd"
  }
});

try {
  if (verifyGitObject) {
    run("git", ["cat-file", "-e", `${E1AE_PRODUCTION_SHA}^{commit}`]);
    const archive = run("git", ["archive", "--format=tar", E1AE_PRODUCTION_SHA]);
    run("tar", ["-x", "-C", oracleRoot], { input: archive.stdout });
    symlinkSync(join(currentRoot, "node_modules"), join(oracleRoot, "node_modules"));
  }

  const roots = verifyGitObject
    ? { e1ae: oracleRoot, bridge: currentRoot }
    : { bridge: currentRoot };
  const modules = {};
  for (const [name, root] of Object.entries(roots)) {
    modules[name] = {
      orchestration: await load(root, "lib/listing/thin/csm-orchestration.mjs", name),
      execution: await load(root, "lib/listing/thin/csm-model-execution-contract.mjs", name),
      adapter: await load(root, "lib/listing/thin/csm-provider-adapter.mjs", name),
      api: await load(root, "api/csm-listing-title.js", name),
      view: await load(root, "api/csm-resolution-view.js", name),
      verified: await load(
        root, "lib/listing/thin/verified-original-observation-support.mjs", name
      )
    };
  }

  const base = {
    year: "2023", manufacturer: "Topps", product: "Chrome", set: "",
    subjects: ["Shohei Ohtani"], team: "Dodgers", card_name: "",
    release_variant: "", surface_color: "", parallel_family: "", parallel_exact: "",
    descriptive_rarity: "", card_number: "1", serial: "", attributes: [],
    grading_info: { company: "", card_grade: "", auto_grade: "", grade_type: "" },
    grammar: "standard", lot_count: "", language: "", unreadable: [],
    low_confidence: [], special_stamp: "", description: ""
  };
  const cases = {
    baseline: base,
    first_bowman: {
      ...base, year: "2024", subjects: ["Walker Jenkins"], descriptive_rarity: "1st Bowman"
    },
    foreign_finish: {
      ...base, manufacturer: "Pokémon", product: "Pokemon", subjects: ["Charizard"],
      surface_color: "Gold", parallel_family: "Refractor", parallel_exact: "Gold Refractor",
      grammar: "tcg", language: "EN", card_number: "4/102"
    },
    tcg: {
      ...base, manufacturer: "Pokémon", product: "Pokemon", set: "Scarlet & Violet",
      subjects: ["Pikachu"], grammar: "tcg", language: "EN", card_number: "025/165"
    },
    lot: {
      ...base, subjects: ["A", "B"], grammar: "lot", lot_count: "2",
      card_number: "", serial: "", team: "", attributes: ["RC"]
    },
    grading: {
      ...base,
      grading_info: { company: "PSA", card_grade: "9", auto_grade: "10", grade_type: "CARD_AND_AUTO" },
      attributes: ["Auto"]
    },
    special_stamp: { ...base, special_stamp: "Promo" },
    description: { ...base, description: "Case Hit" },
    special_stamp_and_description: {
      ...base, special_stamp: "Promo", description: "Case Hit"
    },
    duplicate: { ...base, subjects: ["A", "A", "B"], attributes: ["Auto", "Auto", "RC"] },
    multi_codes: {
      ...base, subjects: ["A", "B", "C"], card_number: "BCP-1; BCP-2; BCP-3"
    }
  };
  const overlayImageSha256 = [
    "161f0d97df619f8d34b2453551567a0473d3e477c3e0ec9295029fbce8c59e44",
    "cef46b5d761d2d20f5cd21d611cab8d8037721bcdb4ae8c1a0d4441439a6fdc3"
  ];
  const externalImageSha256 = [
    "8641baae2722318061dc7d9431e8764e4fe72d809bf1d668294c823c1105811a",
    "7551abbd6a90f94771396eb46f726f20c49b0745d23db4f82a8db5c82296ca01"
  ];
  const specialCases = {
    overlay_v1: {
      raw: { ...base, serial: "30/50" },
      originalImageSha256: overlayImageSha256
    },
    external_v2: {
      raw: {
        ...base, year: "1994-95", manufacturer: "Topps", product: "Stadium Club",
        set: "Hardwood Heroes", subjects: ["Michael Jordan"], team: "Chicago Bulls",
        parallel_family: "Foil", parallel_exact: "Members Only", card_number: "HR14"
      },
      originalImageSha256: externalImageSha256
    }
  };

  const providerResponse = (name, raw) => ({
    ok: true,
    status: 200,
    headers: { get: (header) => header === "x-request-id" ? `request-${name}` : "" },
    json: async () => ({
      id: `response-${name}`,
      status: "completed",
      model: "gpt-5.6-luna",
      reasoning: { effort: "low" },
      output_text: JSON.stringify(raw),
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 2 },
        output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 5 },
        total_tokens: 30
      }
    })
  });

  const preparedCases = {};
  async function preparePair(name, raw, { originalImageSha256 = null } = {}) {
    const pair = {};
    for (const [runtime, mod] of Object.entries(modules)) {
      let providerRequest;
      const signed = Array.isArray(originalImageSha256);
      pair[runtime] = await mod.orchestration.prepareCanonicalListingPath({
        tenantId: "oracle-tenant",
        recognitionSessionId: `oracle-session-${name}`,
        imageUrls: signed
          ? ["https://example.test/front.jpg", "https://example.test/back.jpg"]
          : ["data:image/jpeg;base64,AA=="],
        transportProfile: signed
          ? mod.execution.CSM_CANONICAL_SIGNED_URL_TRANSPORT_PROFILE
          : mod.execution.CSM_ORIGINAL_INLINE_TRANSPORT_PROFILE,
        registryReleaseId: "registry_thin_sem_v25",
        createdAt: "2026-08-14T00:00:00.000Z",
        providerClientRequestId: `client-${name}`,
        ...(signed ? { externalIdentityContext: { originalImageSha256 } } : {}),
        callProvider: async (request) => {
          providerRequest = request;
          return providerResponse(name, raw);
        }
      });
      pair[runtime].__provider_request = providerRequest;
    }
    if (verifyGitObject) {
      assert.deepEqual(pair.bridge, pair.e1ae, `${name}: complete prepared writer result`);
    }
    preparedCases[name] = pair;
  }

  for (const [name, raw] of Object.entries(cases)) await preparePair(name, raw);
  for (const [name, options] of Object.entries(specialCases)) {
    await preparePair(name, options.raw, options);
  }

  const wirePair = {};
  for (const [runtime, mod] of Object.entries(modules)) {
    const calls = [];
    const caller = mod.adapter.CSM_OPENAI_RESPONSES_ADAPTER.createCaller({
      env: { OPENAI_API_KEY: "oracle-key" },
      operationKey: "oracle-operation",
      payloadHash: "a".repeat(64),
      attempt: 2,
      clientRequestId: "oracle-client-request",
      timeoutMs: 12_345,
      fetchImpl: async (url, init) => {
        calls.push({ url, method: init.method, headers: init.headers, body: init.body });
        return { ok: true, status: 200 };
      }
    });
    await caller(preparedCases.baseline[runtime].__provider_request);
    wirePair[runtime] = calls[0];
  }
  if (verifyGitObject) {
    assert.deepEqual(wirePair.bridge, wirePair.e1ae, "actual provider HTTP wire bytes");
  }

  const firstBowman = preparedCases.first_bowman;
  const checkpointPair = {};
  const persistedPair = {};
  for (const [runtime, mod] of Object.entries(modules)) {
    const prepared = firstBowman[runtime];
    delete prepared.__provider_request;
    checkpointPair[runtime] = mod.api.buildCsmPersistenceCheckpoint({
      prepared,
      tenantId: "oracle-tenant",
      operationKey: "oracle-operation",
      payloadHash: "b".repeat(64),
      recognitionSessionId: "oracle-session-first_bowman",
      executionContractSha256: prepared.execution_contract_sha256,
      resolutionContractSha256: prepared.resolution_contract_sha256
    });
    mod.api.validateCsmPersistenceCheckpoint(checkpointPair[runtime], {
      tenantId: "oracle-tenant",
      operationKey: "oracle-operation",
      payloadHash: "b".repeat(64),
      recognitionSessionId: "oracle-session-first_bowman",
      executionContractSha256: prepared.execution_contract_sha256,
      resolutionContractSha256: prepared.resolution_contract_sha256
    });
    prepared.provider_attempt_number = 1;
    prepared.provider_retry_count = 0;
    let sessionPatch;
    const persisted = await mod.orchestration.persistPreparedCanonicalListingPath({
      tenantId: "oracle-tenant",
      recognitionSessionId: "oracle-session-first_bowman",
      prepared,
      writeRows: async (_rows, options) => {
        sessionPatch = options.sessionPatch;
        return { ok: true, skipped: false, replayed: false, session: { saved: true } };
      }
    });
    persistedPair[runtime] = { sessionPatch, persisted };
  }
  if (verifyGitObject) {
    assert.deepEqual(checkpointPair.bridge, checkpointPair.e1ae, "checkpoint bytes");
    assert.deepEqual(persistedPair.bridge, persistedPair.e1ae, "session patch and owner receipt");
  }

  const viewCases = ["baseline", "first_bowman", "tcg", "lot", "grading", "overlay_v1"];
  const viewManifest = {};
  for (const name of viewCases) {
    const pair = {};
    for (const [runtime, mod] of Object.entries(modules)) {
      const prepared = preparedCases[name][runtime];
      const privateVerified = prepared.verified_original_observation_support;
      const publicVerified = privateVerified == null ? null
        : mod.verified.publicVerifiedOriginalObservationReceipt(privateVerified, {
            observedFields: privateVerified.observed_fields,
            resolvedFields: prepared.fields
          });
      const record = {
        asset_id: `oracle-asset-${name}`,
        recognition_session_id: `oracle-session-${name}`,
        resolution_id: prepared.csm_rows.resolution.id,
        output_id: prepared.csm_rows.output.id,
        output_title: prepared.title,
        resolver_version: prepared.csm_rows.resolution.resolver_version,
        owner_execution_receipt: null,
        replay_rows: prepared.csm_rows,
        external_identity_support: null,
        verified_original_observation_support: publicVerified
      };
      const composed = mod.view.composeResolutionView(record);
      const publicView = await mod.view.handleResolutionViewRequest({
        tenantId: "oracle-tenant",
        assetId: record.asset_id,
        dependencies: { readRecord: async () => record }
      });
      let appended;
      const review = await mod.view.handleResolutionReviewRequest({
        tenantId: "oracle-tenant",
        reviewerId: "oracle-reviewer",
        payload: { asset_id: record.asset_id, verdict: "APPROVED" },
        dependencies: {
          readRecord: async () => record,
          appendReview: async ({ review: value }) => { appended = value; return value; }
        }
      });
      pair[runtime] = { composed, publicView, review, appended };
    }
    if (verifyGitObject) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(pair.bridge)),
        JSON.parse(JSON.stringify(pair.e1ae)),
        `${name}: current/e1ae complete serializable Resolution View`
      );
    }
    viewManifest[name] = sha256(stableJson(pair.bridge));
  }

  const futureReader = run(process.execPath, ["scripts/csm-durable-forward-reader-bridge.test.mjs"], {
    encoding: "utf8"
  });
  assert.match(futureReader.stdout, /forward-reader bridge: ok/);

  const manifest = {
    e1ae_production_sha: E1AE_PRODUCTION_SHA,
    writer_cases: Object.fromEntries(Object.entries(preparedCases).map(([name, pair]) => [
      name,
      sha256(stableJson(pair.bridge))
    ])),
    provider_http_wire_sha256: sha256(stableJson(wirePair.bridge)),
    checkpoint_sha256: sha256(stableJson(checkpointPair.bridge)),
    persisted_owner_sha256: sha256(stableJson(persistedPair.bridge)),
    resolution_views: viewManifest
  };
  if (process.env.CSM_E1AE_ORACLE_PRINT_MANIFEST === "1") {
    console.log(JSON.stringify(manifest, null, 2));
  }
  assert.deepEqual(
    manifest,
    CAPTURED_E1AE_MANIFEST,
    "current bridge must match the frozen exact-e1ae serialized manifest"
  );
  console.log(`writer-old/reader-new exact e1ae oracle: ok ${sha256(stableJson(manifest))}`);
} finally {
  globalThis.Date = nativeDate;
  if (oracleRoot) rmSync(oracleRoot, { recursive: true, force: true });
}
