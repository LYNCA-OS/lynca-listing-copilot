import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateGoldenDataset } from "../lib/listing/evaluation/golden-dataset.mjs";
import { createCommercialReadinessReport } from "./commercial-readiness-audit.mjs";

const defaultDatasetPath = "data/golden-dataset.json";
const defaultAgnesSmokePath = "data/smoke/agnes-smoke-latest.json";
const defaultPublicCardEvalPath = "data/eval/agnes-public-card-image-eval-latest.json";
const defaultRealPhotoPilotPath = "data/eval/agnes-real-photo-card-pilot-latest.json";
const defaultSmokeReports = Object.freeze({
  agnes: "data/smoke/agnes-smoke-latest.json",
  brave: "data/smoke/brave-smoke-latest.json",
  ebay_browse: "data/smoke/ebay-smoke-latest.json",
  openai_web_search: "data/smoke/ows-smoke-latest.json"
});

function argValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  return argv[index + 1] || fallback;
}

async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(resolve(path), "utf8"));
  } catch {
    return fallback;
  }
}

async function listFiles(dir, {
  suffix = "",
  prefix = ""
} = {}) {
  const root = resolve(dir);
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${prefix}${entry.name}`)
    .filter((name) => !suffix || name.endsWith(suffix))
    .sort();
}

function inlineList(values = []) {
  return values.length ? values.join(", ") : "none";
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function rate(value) {
  return Number.isFinite(value) ? String(value) : "n/a";
}

function thresholdSummary(gate = {}) {
  const entries = Object.entries(gate.threshold_results || {});
  if (!entries.length) return "none";
  return entries.map(([metric, result]) => {
    return `${metric}: ${result.value ?? "n/a"} ${result.operator} ${result.threshold} -> ${result.passed ? "passed" : "failed"}`;
  }).join("; ");
}

function smokeSummary(report = null) {
  if (!report) return "missing";
  const capabilities = Array.isArray(report.capabilities)
    ? report.capabilities.map((capability) => `${capability.name}:${capability.status}`).join(", ")
    : "no capabilities";
  return `${report.status || "unknown"} (${capabilities})`;
}

function bullet(lines = []) {
  return lines.map((line) => `- ${line}`).join("\n");
}

function section(number, title, body) {
  return `## ${number}. ${title}\n\n${body.trim()}\n`;
}

function smokeStatusFromReadiness(readiness, providerId) {
  const retrieval = readiness.checks
    .find((check) => check.id === "external_retrieval_live_smoke")
    ?.details?.reports || [];
  return retrieval.find((report) => report.provider === providerId)?.status || "missing";
}

function ebayCandidateSummary(readiness) {
  const check = readiness.checks.find((item) => item.id === "ebay_300_image_candidates");
  if (!check) return "missing";
  return `${check.details?.status || "unknown"} ${check.details?.collected_count ?? 0}/${check.details?.target_count ?? 300}`;
}

function publicCardEvalSummary(report = null) {
  if (!report) return "missing";
  const denominator = report.attempted_count ?? report.target_count ?? 0;
  const trustedCount = report.structured_reference_name_exact_or_corrected_count ?? report.card_name_exact_count ?? 0;
  const trustedRate = report.structured_reference_name_exact_or_corrected_rate ?? report.card_name_exact_rate ?? "n/a";
  return `${report.status || "unknown"} exact ${report.card_name_exact_count ?? 0}/${denominator} (${report.card_name_exact_rate ?? "n/a"}), trusted ${trustedCount}/${denominator} (${trustedRate})`;
}

function realPhotoPilotSummary(report = null) {
  if (!report) return "missing";
  return `${report.status || "unknown"} evaluated ${report.evaluated_count ?? 0}/${report.attempted_count ?? report.target_count ?? 0}, title accepted ${report.title_accepted_count ?? 0}/${report.evaluated_count ?? 0} (${report.title_acceptance_evaluated_rate ?? "n/a"}), provider errors ${report.provider_error_count ?? 0}, inputs controlled=${report.controlled_storage_input_count ?? "n/a"} external=${report.external_url_input_count ?? "n/a"}`;
}

function supabaseCommercialInventorySummary(readiness) {
  const check = readiness.checks.find((item) => item.id === "supabase_commercial_inventory");
  if (!check) return "missing";
  return `${check.status} rows ${check.details?.table_rows ?? 0}, image-backed ${check.details?.image_backed_rows ?? 0}, no-image ${check.details?.rows_without_images ?? 0}`;
}

function supabaseCommercialTruthSummary(readiness) {
  const check = readiness.checks.find((item) => item.id === "supabase_commercial_ground_truth");
  if (!check) return "missing";
  const coverage = Object.entries(check.details?.required_truth_field_coverage || {})
    .map(([field, count]) => `${field}=${count}`)
    .join(", ");
  return `${check.status}${coverage ? ` required fields ${coverage}` : ""}`;
}

function commercialReviewPacketSummary(readiness) {
  const check = readiness.checks.find((item) => item.id === "commercial_review_packet");
  if (!check) return "missing";
  return `${check.status} tasks ${check.details?.task_count ?? 0}, corrected-title-as-truth=${yesNo(check.details?.corrected_title_used_as_ground_truth === true)}, suggested-field-hints=${check.details?.suggested_field_task_count ?? 0}`;
}

function commercialReviewWorklistSummary(readiness) {
  const check = readiness.checks.find((item) => item.id === "commercial_review_worklist");
  if (!check) return "missing";
  return `${check.status} tasks ${check.details?.task_count ?? 0}, P0=${check.details?.priority_band_counts?.P0 ?? 0}, P1=${check.details?.priority_band_counts?.P1 ?? 0}, uses-ground-truth=${yesNo(check.details?.worklist_uses_ground_truth === true)}`;
}

function blockerLines(readiness) {
  return readiness.blockers.length
    ? readiness.blockers.map((blocker) => `${blocker.id}: ${blocker.summary}`)
    : ["none"];
}

export async function createDeliveryReport({
  datasetPath = defaultDatasetPath,
  agnesSmokePath = defaultAgnesSmokePath,
  publicCardEvalPath = defaultPublicCardEvalPath,
  realPhotoPilotPath = defaultRealPhotoPilotPath,
  now = () => new Date(),
  env = process.env
} = {}) {
  const readiness = await createCommercialReadinessReport({
    datasetPath,
    agnesSmokePath,
    env
  });
  const dataset = await readJson(datasetPath, null);
  const evaluation = dataset ? evaluateGoldenDataset(dataset) : null;
  const packageJson = await readJson("package.json", { scripts: {} });
  const migrations = await listFiles("supabase/migrations", { suffix: ".sql" });
  const architectureDocs = await listFiles("docs/architecture", { suffix: ".md", prefix: "docs/architecture/" });
  const smokeReports = {
    agnes: await readJson(env.AGNES_SMOKE_REPORT_PATH || defaultSmokeReports.agnes, null),
    brave: await readJson(env.BRAVE_SMOKE_REPORT_PATH || defaultSmokeReports.brave, null),
    ebay_browse: await readJson(env.EBAY_SMOKE_REPORT_PATH || defaultSmokeReports.ebay_browse, null),
    openai_web_search: await readJson(env.OWS_SMOKE_REPORT_PATH || defaultSmokeReports.openai_web_search, null)
  };
  const publicCardEval = await readJson(env.AGNES_PUBLIC_CARD_EVAL_OUT || publicCardEvalPath, null);
  const realPhotoPilot = await readJson(env.AGNES_REAL_PHOTO_PILOT_OUT || realPhotoPilotPath, null);
  const gate = readiness.evidence.golden_dataset?.commercial_acceptance_gate || {};
  const metrics = evaluation?.ok ? evaluation.held_out_commercial_evidence.commercial_metrics : {};
  const operational = evaluation?.ok ? evaluation.operational_metrics : {};
  const scripts = Object.keys(packageJson.scripts || {}).sort();

  const sections = [
    section(1, "Current Source Audit Result", bullet([
      `Readiness status: ${readiness.status}`,
      `Commercial claim allowed: ${yesNo(gate.passed === true)}`,
      `Held-out commercial assets: ${readiness.evidence.golden_dataset?.held_out_commercial_assets ?? "n/a"}`,
      `Blockers: ${inlineList(blockerLines(readiness))}`,
      `eBay 300-image candidate queue: ${ebayCandidateSummary(readiness)}`,
      `Public card-name reference eval: ${publicCardEvalSummary(publicCardEval)}`,
      `Marketplace real-photo pilot: ${realPhotoPilotSummary(realPhotoPilot)}`,
      `Supabase commercial inventory: ${supabaseCommercialInventorySummary(readiness)}`,
      `Supabase field-level ground truth: ${supabaseCommercialTruthSummary(readiness)}`,
      `Commercial review packet: ${commercialReviewPacketSummary(readiness)}`,
      `Commercial review worklist: ${commercialReviewWorklistSummary(readiness)}`,
      "This report is generated from current repository files and sanitized smoke/eval artifacts; it does not replace a fresh command transcript."
    ])),
    section(2, "Implementation Summary", bullet([
      "Evidence First compatibility layer, provider routing, storage verification, image-quality gates, retrieval, completion orchestration, renderer, feedback-retention gate, publishing boundary, semantic title acceptance, eval, smoke, readiness audit, and delivery-report scaffolds are present.",
      "Agnes is the primary vision provider; GPT-4.1 legacy remains an explicit emergency path.",
      "Commercial acceptance remains blocked until real held-out evidence, live external retrieval validation, and a real B-end adapter exist."
    ])),
    section(3, "Architecture Changes", bullet([
      "Provider adapters live under lib/listing/providers.",
      "Evidence, resolver, retrieval, orchestration, renderer, feedback, storage, image-quality, publishing, and evaluation layers live under lib/listing.",
      `Architecture notes: ${inlineList(architectureDocs)}`
    ])),
    section(4, "Modified And New Files", bullet([
      "Major implementation roots: api/, app/, lib/listing/, scripts/, supabase/, data/, docs/architecture/.",
      "Use git status or PR diff as the authoritative changed-file list for a final release package.",
      "Generated smoke reports live under data/smoke/; generated public card reference and real-photo pilot reports live under data/eval/."
    ])),
    section(5, "Agnes Integration Status", bullet([
      `Smoke report: ${smokeSummary(smokeReports.agnes)}`,
      `Readiness check: ${readiness.checks.find((check) => check.id === "agnes_live_smoke")?.status || "missing"}`,
      "Agnes uses Chat Completions image_url through short-lived signed read URLs when storage is configured.",
      "JSON text parsing remains a required fallback even when the tool-call smoke path passes."
    ])),
    section(6, "GPT-4.1 Emergency Status", bullet([
      `Implicit default status: ${readiness.checks.find((check) => check.id === "provider_default_policy")?.details?.gpt_implicit_default || "unknown"}`,
      "GPT-4.1 is visible only as an explicit emergency retry when enabled and configured.",
      "Normal Evidence Completion does not automatically invoke GPT-4.1."
    ])),
    section(7, "Brave Search Status", bullet([
      `Smoke status: ${smokeStatusFromReadiness(readiness, "brave")}`,
      "Brave is the default external discovery provider in the retrieval layer.",
      "Skipped smoke means the required credential was absent and is not a live validation."
    ])),
    section(8, "eBay Browse Status", bullet([
      `Smoke status: ${smokeStatusFromReadiness(readiness, "ebay_browse")}`,
      `300-image candidate queue: ${ebayCandidateSummary(readiness)}`,
      "eBay Browse is implemented as a read-only marketplace reference provider.",
      "Marketplace evidence cannot override card text, official checklist, or grading evidence."
    ])),
    section(9, "OWS Fallback Status", bullet([
      `Smoke status: ${smokeStatusFromReadiness(readiness, "openai_web_search")}`,
      "OWS is a replaceable fallback retrieval provider and is separate from GPT-4.1 emergency vision.",
      "OWS is not required for normal Agnes vision flow."
    ])),
    section(10, "Environment Variables", bullet([
      "Primary variables are documented in .env.example and README.md.",
      "Provider/model ids are allowlisted server-side.",
      "Smoke report override variables: AGNES_SMOKE_REPORT_PATH, BRAVE_SMOKE_REPORT_PATH, EBAY_SMOKE_REPORT_PATH, OWS_SMOKE_REPORT_PATH.",
      `Package scripts present: ${inlineList(scripts.filter((name) => ["check", "test", "test:mock", "eval:golden", "commercial:heldout", "readiness:audit", "public:cards", "eval:agnes-public-cards", "eval:agnes-real-photos", "smoke:agnes", "smoke:brave", "smoke:ebay", "smoke:ows"].includes(name)))}`
    ])),
    section(11, "Storage Structure", bullet([
      "Supabase Storage bucket default: listing-card-images.",
      `Supabase feedback snapshot: ${supabaseCommercialInventorySummary(readiness)}.`,
      "Image upload/verification APIs require server-side validation, content hash handling, and short-lived read URLs.",
      "Production recognition should pass Agnes only controlled storage signed read URLs, not marketplace or other external image URLs.",
      "Signed URLs are not persisted; object paths, content SHA-256 values, and verification records are the durable references.",
      "Retention cleanup exists as a server-side script and cron-protected API."
    ])),
    section(12, "Database Migration", bullet([
      `Migrations and rollbacks: ${inlineList(migrations)}`,
      "Commercial held-out export template: supabase/queries/export_commercial_heldout_reviews.sql.",
      "Live migration application is not proven by this report."
    ])),
    section(13, "Evidence Schema", bullet([
      "ProviderEvidenceResponse runtime validation and EvidenceField normalization are implemented.",
      "Legacy fields remain compatibility output generated from resolved fields.",
      "Evidence sources record source type, trust tier, image region/source, conflicts, and unresolved reasons where available."
    ])),
    section(14, "Resolver Rules", bullet([
      "Number resolver separates serial_number, collector_number, and checklist_code.",
      "Grade resolver separates card_grade, auto_grade, and grade_type.",
      "Resolver precedence treats marketplace/open-web evidence as lower trust than card, official, grading, and internal approved evidence."
    ])),
    section(15, "Retrieval Strategy", bullet([
      "Priority path: approved history, registry, official/trusted sources, Brave, eBay market reference, OWS fallback.",
      "Open web and marketplace candidates are normalized, scored, and retained as candidates rather than direct ground truth.",
      "Source fetcher is bounded and HTTP/HTTPS-only."
    ])),
    section(16, "Evidence Completion Strategy", bullet([
      "Completion state tracks missing, weak, conflicting fields and next best actions.",
      "Focused Agnes reread, retrieval constraints, candidate verification, and targeted rescan routing are wired.",
      "Budgets bound rounds, external queries, provider calls, time, and cost."
    ])),
    section(17, "Glare Handling Strategy", bullet([
      "Image-quality gate computes blur, glare, crop, readability, resolution, and critical-region occlusion signals.",
      "Derived crops support focused reread, but generated image cleanup is not used as fact evidence.",
      "Current implementation is a conservative heuristic gate, not industrial-grade glare segmentation."
    ])),
    section(18, "Writer UI Behavior", bullet([
      "Writer modules render compact editable sections rather than raw JSON.",
      "Module edits update corrected resolved fields and rerender deterministic titles.",
      "Provider controls expose Agnes default and GPT emergency action without arbitrary endpoint/model inputs."
    ])),
    section(19, "Title Renderer Behavior", bullet([
      "Final title is rendered deterministically from resolved fields.",
      "Renderer keeps serial and grade high priority and avoids semantic inference.",
      "Commercial title acceptance is semantic: non-standard wording/order can pass when critical facts are present, but wrong name, color/parallel, serial, grade, or conflicting critical fields fail.",
      "Manual title overrides are tracked separately and do not mutate resolved fields."
    ])),
    section(20, "Feedback Data Structure", bullet([
      `Feedback retention enabled: ${yesNo(env.LISTING_FEEDBACK_RETENTION_ENABLED === "true" || env.ENABLE_LISTING_FEEDBACK_RETENTION === "true")}`,
      `Approved-memory reuse enabled: ${yesNo(env.LISTING_APPROVED_MEMORY_ENABLED === "true" || env.ENABLE_LISTING_APPROVED_MEMORY === "true")}`,
      "Versioned feedback can write listing_assets, listing_analysis_runs, and listing_reviews only when feedback retention is explicitly enabled.",
      "With retention disabled, the feedback endpoint returns computed outcomes but does not write manual/agent test data into training or approved memory.",
      "When retention is enabled for commercial operation, ACCEPTED_UNCHANGED is saved as a positive review outcome.",
      "Server-side diffs compare generated and corrected resolved-field snapshots."
    ])),
    section(21, "Test Results", bullet([
      "Required command entrypoints exist: npm run check, npm test, npm run test:mock, npm run eval:golden, and provider smoke scripts.",
      "This generated report does not execute test commands; attach the current terminal output from the release run.",
      "Readiness audit status is based on current repo artifacts and remains blocked until the listed blockers are removed."
    ])),
    section(22, "Benchmark Results", bullet([
      `Commercial gate passed: ${yesNo(gate.passed === true)}`,
      `Gate reasons: ${inlineList(gate.reasons || [])}`,
      `Thresholds: ${thresholdSummary(gate)}`,
      `Held-out AI exact resolution rate: ${rate(metrics.ai_overall_exact_resolution_rate)}`,
      `Held-out AI-complete precision: ${rate(metrics.ai_complete_result_precision)}`,
      `Held-out accepted critical error rate: ${rate(metrics.accepted_critical_error_rate)}`,
      `Public card-name reference eval: ${publicCardEvalSummary(publicCardEval)}`,
      `Marketplace real-photo pilot: ${realPhotoPilotSummary(realPhotoPilot)}`,
      `Supabase field-level ground truth: ${supabaseCommercialTruthSummary(readiness)}`,
      `Commercial review packet: ${commercialReviewPacketSummary(readiness)}`,
      `Commercial review worklist: ${commercialReviewWorklistSummary(readiness)}`,
      `Public eval commercial claim allowed: ${yesNo(publicCardEval?.commercial_accuracy_claim_allowed === true)}`
    ])),
    section(23, "Cost And Latency", bullet([
      `Average provider calls: ${rate(operational.average_provider_calls)}`,
      `Average retrieval rounds: ${rate(operational.average_retrieval_rounds)}`,
      `Average latency ms: ${rate(operational.average_latency_ms)}`,
      `Cost per asset: ${rate(operational.cost_per_asset)}`,
      "Cost estimates require provider pricing env vars before they become financially meaningful."
    ])),
    section(24, "Known Limitations", bullet([
      ...blockerLines(readiness),
      "Development fixture metrics are not commercial acceptance evidence.",
      "Public card-name reference eval is a card-image recognition stress test, not held-out commercial acceptance evidence.",
      "Marketplace real-photo pilot is a realistic image stress test, not held-out commercial acceptance evidence.",
      "Current feedback retention and approved-memory reuse are default-off so manual tests are not training data.",
      "Real Supabase migration application and production storage behavior require environment validation."
    ])),
    section(25, "Not Validated Due Missing Credentials", bullet([
      `Brave smoke: ${smokeStatusFromReadiness(readiness, "brave")}`,
      `eBay Browse smoke: ${smokeStatusFromReadiness(readiness, "ebay_browse")}`,
      `eBay 300-image candidates: ${ebayCandidateSummary(readiness)}`,
      `OWS smoke: ${smokeStatusFromReadiness(readiness, "openai_web_search")}`,
      "Skipped smoke reports are explicit missing-validation evidence."
    ])),
    section(26, "B-End Pending Integration", bullet([
      "Only mock_b_end is configured in the publisher contract.",
      "No real B-end endpoint, auth scheme, payload contract, or destination URL is invented.",
      "Real adapter work requires B-end API documentation and credentials."
    ])),
    section(27, "GPT-4.1 Retirement Conditions", bullet([
      "Phase A: Agnes default with explicit GPT emergency.",
      "Phase B: GPT emergency restricted to admins or specified assets.",
      "Phase C: GPT UI hidden by environment while adapter remains.",
      "Phase D: remove adapter after production evidence shows no dependency."
    ])),
    section(28, "Next Stage Recommendations", bullet([
      "Import a real approved-review export into a held-out commercial dataset.",
      "Generate a commercial field-level review packet and import only reviewed field labels with evidence sources.",
      "Use the commercial review worklist P0/P1 queue to label high-risk/high-value cards first, then import only reviewed fields with evidence.",
      "Use the public 300-card reference misses to tune OCR/name spelling, but keep commercial gate tied to approved held-out reviews.",
      "Use the marketplace real-photo pilot failures to tune image ingestion, timeouts, and missing-critical-field routing; production tests should use self-hosted uploaded images rather than unstable marketplace image URLs.",
      "Keep feedback retention and approved-memory reuse disabled until real commercial review policy, dataset governance, and rollout approvals are in place.",
      "Run `npm run ebay:candidates -- --target 300` with official eBay Browse credentials, then label those candidates before accuracy evaluation.",
      "Run credentialed Brave, eBay Browse, and OWS smoke tests and keep their sanitized reports.",
      "Apply and verify Supabase migrations in the target environment.",
      "Obtain real B-end API documentation and implement a non-mock publisher adapter.",
      "Use failure root causes and field error distribution to improve Evidence, Retrieval, Registry, Resolver, and image-quality handling."
    ]))
  ];

  return [
    "# Listing Copilot Final Delivery Report",
    "",
    `Generated at: ${now().toISOString()}`,
    `Readiness status: ${readiness.status}`,
    "",
    ...sections
  ].join("\n");
}

export async function main(argv = process.argv, env = process.env) {
  const datasetPath = argValue(argv, "--dataset", env.GOLDEN_DATASET_PATH || defaultDatasetPath);
  const agnesSmokePath = argValue(argv, "--agnes-smoke-report", env.SMOKE_PROVIDER_REPORT_PATH || defaultAgnesSmokePath);
  const outPath = argValue(argv, "--out", env.DELIVERY_REPORT_PATH || "");
  const report = await createDeliveryReport({
    datasetPath,
    agnesSmokePath,
    env
  });

  if (outPath) {
    const resolvedOut = resolve(outPath);
    await mkdir(dirname(resolvedOut), { recursive: true });
    await writeFile(resolvedOut, `${report}\n`);
  }

  process.stdout.write(`${report}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const code = await main();
    process.exit(code);
  } catch (error) {
    console.error(`Delivery report generation failed: ${error.message}`);
    process.exit(1);
  }
}
