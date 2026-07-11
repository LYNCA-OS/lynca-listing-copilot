import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile("app/index.html", "utf8");
const js = await readFile("app/listing-copilot.js", "utf8");
const css = await readFile("app/listing-copilot.css", "utf8");
const api = await readFile("api/listing-copilot-title.js", "utf8");
const providerOptionsModule = await readFile(new URL("../lib/listing/pipeline/provider-options.mjs", import.meta.url), "utf8");
const providerPromptModule = await readFile(new URL("../lib/listing/pipeline/provider-prompt.mjs", import.meta.url), "utf8");
const fieldNormalizationModule = await readFile(new URL("../lib/listing/pipeline/field-normalization.mjs", import.meta.url), "utf8");
const apiWithOptions = api + providerOptionsModule + providerPromptModule + fieldNormalizationModule;
const v4JobStatusApi = await readFile("api/v4/listing-job-status.js", "utf8");
const providerRegistry = await readFile("lib/listing/providers/provider-registry.mjs", "utf8");
const csmFieldLabels = await readFile("lib/listing/csm/field-labels.mjs", "utf8");

assert.match(html, /id="providerControl"/, "provider segmented control should exist");
assert.match(html, /id="providerStatusText"/, "provider status text should exist");
assert.match(html, /rel="icon"[^>]+href="\/app\/favicon\.svg"/, "main app should provide a favicon to avoid browser 404 noise");
assert.match(js, /fetch\("\/api\/listing-provider-status"/, "frontend should load provider status from the server");
assert.match(js, /state\.selectedProvider/, "frontend should keep selected provider in state");
assert.match(js, /state\.selectedProvider = payload\.default_provider \|\| ""/, "frontend should use the server default provider as the selected provider");
assert.doesNotMatch(js, /state\.selectedProvider\s*=\s*["']openai_legacy["']/, "frontend must use the server default rather than hard-code a provider");
assert.match(js, /workflowReadinessText/, "frontend should render server workflow readiness in the provider status area");
assert.match(js, /workflowAllowsGeneration/, "frontend should gate generation on the cloud workflow readiness preflight");
assert.match(js, /workflow_readiness/, "frontend should read integrated workflow readiness from provider status");
assert.doesNotMatch(js, /state\.selectedProvider \|\| state\.providerStatus\?\.fallback_available/, "frontend must not allow local fallback to bypass cloud readiness");
assert.match(js, /mode:\s*"pair"/, "frontend should default new uploads to two-image paired recognition");
assert.match(html, /name="assetMode" value="pair" checked/, "two-image paired recognition should be the checked default control");
assert.match(html, /两图配对/, "paired upload mode should be labeled without front/back judgment");
assert.match(html, /每两张图片组成一张卡/, "writer copy should explain pairing without asking for front/back labels");
assert.doesNotMatch(html, /正面|背面/, "writer surface should not expose front/back labels or decisions");
assert.doesNotMatch(js, /sideDecisionForAsset/, "frontend must not compute a front/back side decision");
assert.doesNotMatch(js, /inferredSourceSide/, "frontend crop preparation must not infer front/back from filenames or upload order");
assert.doesNotMatch(js, /sideDecisionNotice\(asset, result\)/, "result cards must not show front/back decision panels");
assert.doesNotMatch(js, /EVIDENCE_SWAPPED/, "frontend must not swap uploaded images based on side evidence");
assert.match(js, /body\.provider = provider/, "title requests should include the selected provider");
assert.match(js, /defaultProviderOptions/, "frontend should centralize default provider options");
assert.match(js, /single_model_fast:\s*false/, "frontend default path should not skip evidence completion");
assert.match(js, /enable_evidence_completion:\s*true/, "frontend default path should use evidence completion");
assert.match(js, /enable_catalog_assist:\s*true/, "frontend default path should use catalog assist");
assert.match(js, /enable_vector_assist:\s*true/, "frontend default path should use vector assist");
assert.match(js, /enable_stored_visual_features:\s*true/, "frontend default path should allow stored visual feature lookup");
assert.match(js, /enable_query_visual_embeddings:\s*true/, "frontend default path should request query visual embeddings when configured");
assert.match(js, /enable_vector_retrieval:\s*true/, "vector retrieval should be part of the default C path");
assert.match(js, /vector_retrieval_mode:\s*"assist"/, "vector retrieval should default to assist mode");
assert.match(js, /enable_advanced_retrieval:\s*true/, "frontend default path should use advanced retrieval");
assert.match(js, /enable_hybrid_retrieval:\s*true/, "frontend default path should use hybrid retrieval");
assert.doesNotMatch(js, /vectorCandidateNotice/, "writer UI should not expose raw vector candidate diagnostics");
assert.doesNotMatch(js, /vector_prompt_assist_used/, "writer UI should not surface technical prompt-assist status");
assert.match(js, /provider_options:\s*{/, "title requests should include provider options");
assert.match(js, /body\.explicitEmergency = Boolean/, "legacy explicit flag should remain backward-compatible");
assert.match(js, /provider === "openai_legacy"/, "OpenAI provider path should remain explicit in request payloads");
assert.match(js, /providerCascadeText/, "frontend should render concise provider role text");
assert.match(js, /provider\.model_id \|\| provider\.display_name/, "provider role text should use the server-reported active model");
assert.doesNotMatch(js, /GPT-4\.1 mini 生产主路径/, "provider role text must not hard-code a stale model");
assert.doesNotMatch(js, /cascade_fast|格式失败兜底/, "frontend must not expose mixed-model cascade controls");
assert.match(js, /fetch\("\/api\/listing-image-upload-url"/, "frontend should request server-signed upload URLs");
assert.match(js, /const TITLE_API_ENDPOINT = "\/api\/v4\/listing-copilot-title"/, "frontend should retain the V4 one-line title endpoint for explicit retry fallback");
assert.match(js, /const JOB_ENQUEUE_API_ENDPOINT = "\/api\/v4\/listing-job-enqueue"/, "frontend should enqueue default production recognition jobs");
assert.match(js, /const JOB_STATUS_API_ENDPOINT = "\/api\/v4\/listing-job-status"/, "frontend should poll production job status for writer-visible titles");
assert.match(js, /const FAST_SCOUT_PREWARM_API_ENDPOINT = "\/api\/v4\/fast-scout-prewarm"/, "frontend should prewarm asset-level V4 fast scout cache after image verification");
assert.match(js, /const SESSION_STATUS_API_ENDPOINT = "\/api\/v4\/listing-session-status"/, "frontend should poll the V4 session status endpoint for background assisted drafts");
assert.match(js, /fetchWithTimeout\(JOB_ENQUEUE_API_ENDPOINT/, "default title requests should enter the V4 production queue with a bounded wait");
assert.match(js, /fetch\(`\$\{JOB_STATUS_API_ENDPOINT\}\?\$\{params\.toString\(\)\}`/, "frontend should poll production job status by durable job id");
assert.match(js, /processAssetViaQueue\(asset, \{ batchId: recognitionBatchId \}\)/, "batch generation should use one shared production batch identity");
assert.match(js, /create_l1_job:\s*false/, "frontend production jobs should skip hidden L1 after it showed no stable L2 or writer benefit");
assert.match(js, /create_l2_job:\s*true/, "frontend production jobs should always enqueue the writer-visible final L2");
assert.match(js, /const \[bundle\] = await Promise\.all/, "preingestion and the free cache probe should run concurrently before the single L2 enqueue");
assert.match(js, /v4_fast_scout_cache_only:\s*true/, "the direct prewarm endpoint must remain cache-only because paid hidden L1 runs inside the capacity-controlled queue");
assert.match(js, /fastScoutPrewarm/, "L2 should reuse the free cache probe without spending a second provider call");
assert.doesNotMatch(js, /l1Body|l1Outcome|applySpeculativeL1ToPendingResult/, "writer flow must not issue or display a duplicate speculative L1 request");
assert.match(js, /fetch\(FAST_SCOUT_PREWARM_API_ENDPOINT/, "frontend should call the asset-level fast scout prewarm endpoint");
assert.match(js, /function pollV4QueuedJobsBatch/, "queued writer titles should use one batch status aggregator");
assert.match(js, /QUEUED_STATUS_BATCH_SIZE = 100/, "one status request should cover a large writer batch");
assert.match(js, /if \(elapsedMs < 30_000\) return 800/, "fresh jobs should become writer-visible within roughly one second of completion");
assert.doesNotMatch(js, /async function pollV4QueuedJob\(/, "frontend must not create one polling loop per queued card");
assert.match(js, /fetch\(`\$\{SESSION_STATUS_API_ENDPOINT\}\?\$\{params\.toString\(\)\}`/, "frontend should poll session status using the durable recognition_session_id");
assert.match(js, /startV4AssistedDraftPolling\(result\)/, "frontend should start durable L2 polling after each queued or direct response");
assert.match(js, /applyV4AssistedDraftUpdate/, "frontend should place the first writer-visible one-line title when L2 is ready");
assert.match(js, /v4WriterTitlePending/, "frontend should keep internal L1 scout output out of the writer title box");
assert.match(js, /if \(result\.title_stage === "L1_INTERNAL_SCOUT"\) return true;/, "L1 must stay pending and writer-invisible until L2 is ready");
assert.match(js, /titlePending \? "disabled" : ""/, "the title editor must stay disabled while only L1 exists");
assert.match(js, /titleWasEditedByWriter/, "L2 assisted drafts must not overwrite writer-edited titles");
assert.match(js, /stopAllV4AssistedDraftPolling/, "frontend should clear stale L2 polling when files or mode change");
assert.doesNotMatch(v4JobStatusApi, /select: "[^"]*l1_title/, "writer-facing job status API must not fetch L1 internal titles");
assert.match(v4JobStatusApi, /l1_title: ""/, "writer-facing job status API should expose an empty L1 title");
assert.match(v4JobStatusApi, /writerSafeSessionStatus/, "job status API should return a sanitized session object");
assert.match(v4JobStatusApi, /provider_token_diagnostics/, "job status API should expose provider token diagnostics for production debugging");
assert.match(v4JobStatusApi, /provider_rate_limit_diagnostics/, "job status API should expose provider rate-limit diagnostics for production debugging");
assert.match(v4JobStatusApi, /provider_request_diagnostics/, "job status API should expose provider request diagnostics for production debugging");
assert.match(js, /signed_upload_url/, "frontend should upload through signed URLs");
assert.match(js, /signatureHex/, "frontend should send first-byte signatures before receiving signed upload URLs");
assert.match(js, /width: dimensions\.width/, "frontend should send image width before receiving signed upload URLs");
assert.match(js, /height: dimensions\.height/, "frontend should send image height before receiving signed upload URLs");
assert.match(js, /fetch\("\/api\/listing-image-verify-upload"/, "frontend should verify uploaded objects server-side before provider calls");
assert.match(js, /storageVerified/, "frontend should preserve server-side storage verification state");
assert.match(js, /storageVerificationToken/, "frontend should pass server-issued storage verification tokens to title requests");
assert.match(js, /objectPath/, "frontend should preserve storage object paths for provider calls");
assert.match(js, /serializableAssetImage/, "frontend should strip browser-only File objects from title payloads");
assert.match(js, /imageHasVerifiedStorageReference/, "frontend should detect storage-backed images");
assert.match(js, /dataUrl: useStorageReference \? "" : image\.dataUrl/, "storage-backed title requests should not send large Base64 image JSON");
assert.match(js, /captureQuality: summarizeAssetImageQuality/, "title requests should include capture quality summaries");
assert.match(js, /imageQuality/, "image records should carry first-pass quality metrics");
assert.match(js, /planTargetedCrops/, "frontend should plan targeted crops from quality results");
assert.match(js, /targetedCrops/, "frontend should carry targeted crop images alongside originals");
assert.match(js, /fieldCropStrip/, "frontend should keep the crop-strip hook disabled without removing provider crops");
assert.match(js, /return "";/, "field crop thumbnails should not be shown in the main asset row");
assert.match(js, /modalImagesForAsset/, "image modal should be limited to writer-facing original images");
assert.match(js, /cropMetadata/, "frontend should preserve crop metadata through request and review payloads");
assert.match(js, /sourceBlob/, "derived crop images should be uploadable without service credentials");
assert.match(js, /storageRoleForImage\(image, imageIndex\)/, "storage upload should use crop-specific image roles");
assert.match(js, /image_\$\{imageIndex \+ 1\}_original/, "new original uploads should use neutral image slot roles instead of front/back roles");
assert.match(api, /primaryImagesFromImages/, "title API should separate primary card images from derived crops");
assert.match(apiWithOptions, /BGS\/Beckett slab discipline/, "provider prompt should explicitly separate BGS card grade and autograph grade");
assert.match(apiWithOptions, /never copy card_grade into auto_grade/, "provider prompt must forbid BGS auto-grade scaffolding");
assert.match(api, /normalizePrintedCardCodeForFields/, "title API should suppress player initials from collector/card/checklist code fields");
assert.match(apiWithOptions, /Two-letter all-alpha values are usually player initials/, "printed-code guard should document why JS/MJ-style values are rejected");
assert.match(api, /verifyListingImageVerificationToken/, "title API should require server-issued storage verification tokens before signed read URLs");
assert.match(api, /readListingImageVerificationRecord/, "title API should allow durable server verification records for later reprocessing");
assert.match(api, /Listing image storage reference has not been verified/, "title API should reject unverified storage object references");
assert.doesNotMatch(api, /createGptCriticalVerifierRunner|createCascadeFastTitle|model_to_model/, "title API should not wire automatic mixed-model paths");
assert.doesNotMatch(providerRegistry, /ENABLE_FAST_CASCADE_PROVIDER|cascade_fast/i, "provider registry should only expose the active GPT provider");
assert.match(api, /const signedImages = await imagesWithSignedReadUrls\(payload\.images \|\| \[\], timingContext\)/, "OpenAI fallback should use signed storage read URLs instead of requiring Base64 JSON");
assert.match(api, /signedImages: recognitionPreflight\.signedImages/, "provider calls should reuse signed URLs created during recognition preflight");
assert.doesNotMatch(api, /tryProviderFastPath\(\s*cascadeResult,/, "cascade fast path should not exist");
assert.match(api, /if \(fastPathResult\) return finalizeProviderResult\(fastPathResult\)/, "cascade fast path should skip slow completion while preserving open-set diagnostics and verified OCR locks");
assert.match(api, /open_set_readiness/, "title API should expose known-catalog versus catalog-gap diagnostics");
assert.match(apiWithOptions, /singleModelFastPathEnabled/, "title API should expose a single-model fast path switch");
assert.match(apiWithOptions, /envFlag\(env, "ENABLE_SINGLE_MODEL_FAST_PATH", false\)/, "pipeline should default to model plus evidence completion");
assert.match(api, /defaultProviderOptionsFromEnv/, "title API should centralize default provider options server-side");
assert.match(apiWithOptions, /ENABLE_CATALOG_ASSIST_DEFAULT", true/, "title API should default catalog assist on for the C path");
assert.match(apiWithOptions, /ENABLE_VECTOR_ASSIST_DEFAULT", true/, "title API should default vector assist on for the C path");
assert.match(apiWithOptions, /vector_retrieval_mode:\s*vectorAssistDefault \? "assist" : "off"/, "title API should default vector retrieval to assist mode when enabled");
assert.match(apiWithOptions, /vector_query_timeout_ms:\s*20000/, "title API should give vector retrieval the production-ready overlap budget before degrading");
assert.match(apiWithOptions, /vectorEmbeddingPostProviderWaitMs/, "L2 should cap post-provider vector waiting before it dominates writer-ready latency");
assert.match(apiWithOptions, /postObservationCatalogVectorHedgeMs/, "post-observation catalog should get a bounded head start before vector retrieval overlaps it");
assert.match(api, /post_observation_catalog_vector_overlap_ms/, "slow post-observation catalog and vector lookups should overlap instead of stacking their tail latency");
assert.match(api, /vector_embedding_overlap_timeout_after_provider/, "slow vector warmup after provider should degrade to a timeout packet instead of blocking the title");
assert.match(apiWithOptions, /Math\.max\(\s*20000,[\s\S]*VECTOR_QUERY_TIMEOUT_MS/, "vector warmup should get a longer overlapped window than the post-provider wait");
assert.match(apiWithOptions, /VECTOR_EMBEDDING_MAX_BLOCKING_TIMEOUT_MS[\s\S]*\|\|\s*20000/, "vector warmup hard cap should default to the overlapped 20s budget");
assert.match(api, /singleModelDraftPath/, "single-model provider requests should be able to skip Evidence Completion");
assert.match(api, /skipped_evidence_completion: true/, "single-model fast drafts should record skipped Evidence Completion");
assert.match(api, /assist_shadow_no_prompt_safe_candidates/, "assist-enabled requests with no prompt-safe candidates should stay in shadow-only mode");
assert.match(api, /assist_shadow_only: assistShadowOnly/, "assist shadow-only drafts should be distinguishable from provider fast path");
assert.match(api, /allowWhenEvidenceCompletion: assistShadowOnly/, "assist shadow-only drafts should skip Evidence Completion without enabling unsafe candidate assist");
assert.match(api, /assist_shadow_retrieval_failed/, "assist shadow telemetry failures should not fail the GPT draft");
assert.match(api, /safe_retrieval_title_assist/, "trusted selected retrieval evidence should have a bounded title scaffold path");
assert.doesNotMatch(api, /if\s*\(\s*source\.selected\s*===\s*true\s*\|\|\s*source\.__title_assist_selected_candidate\s*===\s*true\s*\)\s*return\s+true/, "selected retrieval candidates must still pass title-assist safety checks");
assert.match(api, /const selectedLane = source\.selected === true \|\| source\.__title_assist_selected_candidate === true/, "selected retrieval candidates should use the same guarded title-assist lane");
assert.match(api, /stripReferenceInstanceOnlyTerms/, "retrieval title scaffolds must strip reference serial, grade, and cert terms before use");
assert.match(api, /retrievalSourceHasDirectConflict/, "retrieval title scaffolds must fail closed on direct conflicts");
assert.match(api, /retrievalSourceHasExactIdentityAnchor/, "trusted exact-code retrieval anchors should be able to correct provider brand/product drift");
assert.match(api, /normalizeTitlePreservingSuffix/, "retrieval title scaffolds should preserve current-image serial values through title trimming");
assert.match(api, /selected_approved_candidate_title_scaffold/, "retrieval title scaffolds should be explicitly tagged in eval traces");
assert.match(apiWithOptions, /ENABLE_EVIDENCE_COMPLETION/, "slow Evidence Completion should be controlled by an explicit env flag");
assert.match(api, /vectorRetrievalActive\(env, options\)/, "title API should only run visual vector lookup when vector retrieval is active");
assert.match(api, /envFlag\(env, "ENABLE_STORED_VISUAL_FEATURE_LOOKUP", false\)/, "legacy stored visual lookup should default off");
assert.doesNotMatch(api, /runFocusedVisionImpl:\s*createGptCriticalVerifierRunner/, "automatic second-model focused vision should not be wired from the title API");
assert.match(api, /optional bounded derived crop images/, "title API should accept derived crop images without allowing unbounded inputs");
assert.match(js, /function TitleCardComponent\(result, asset = null\)/, "frontend should render the one-line title card product surface");
assert.match(js, /writerTitleOmissionNotice/, "title-only UI should explain CSM fields omitted by the 80-character policy");
assert.match(js, /已识别但因 80 字符限制省略/, "writer omission copy should be concrete and non-technical");
assert.match(js, /data-title-input/, "title cards should expose a single editable title input");
assert.match(js, /data-save-title/, "title cards should expose an accept action");
assert.match(js, /data-reject-title/, "title cards should expose a reject action");
assert.match(js, /rejectTitleFeedback/, "reject action should write a review record instead of becoming a dead UI button");
assert.match(js, /const FEEDBACK_API_ENDPOINT = "\/api\/v4\/listing-feedback"/, "V4 reviews should use the V4 learning feedback endpoint");
assert.match(js, /feedbackActionForResult/, "feedback saves should derive accept, edit, or reject actions from writer edits");
assert.doesNotMatch(js, /moduleSummary\(result\)/, "writer UI must not render structured module forms by default");
assert.doesNotMatch(js, /\$\{workflowSummaryNotice\(result\)\}/, "writer UI must not expose technical workflow summaries by default");
assert.match(js, /labelForCsmField/, "frontend should use the shared CSM field label contract");
assert.doesNotMatch(js, /const reviewFieldLabels = \{/, "frontend must not fork its own field label map");
assert.match(js, /sanitizeCollectorNumberDisplay/, "writer field evidence should suppress player initials before showing collector numbers");
assert.match(js, /\^\[A-Z\]\{1,2\}\$/, "writer field evidence should not show one- or two-letter initials as collector numbers");
assert.match(js, /gradeDisplayValue/, "writer field evidence should only show complete grading facts");
assert.doesNotMatch(js, /Capture Profile[\s\S]*Image Quality Route[\s\S]*Images Evaluated/, "writer field evidence must not render technical capture-quality rows as card modules");
assert.match(js, /data-workflow-summary/, "workflow summary should have a stable hook for UI validation");
assert.match(js, /hide_raw_candidate_details/, "workflow summary should keep raw candidate diagnostics hidden from the writer UI by default");
assert.match(js, /operator_next_actions/, "workflow summary should render explicit operator next actions");
assert.match(js, /workflowActionClass/, "workflow action kinds should be sanitized before becoming CSS classes");
assert.match(js, /aria-label="写手下一步动作"/, "workflow action queue should have a writer-facing accessibility label");
assert.match(js, /result\.modules/, "frontend should read module output from deterministic renderer responses");
assert.doesNotMatch(js, /data-module-input/, "writer UI must not expose editable structured field/module controls");
assert.doesNotMatch(js, /module-edit-hint/, "writer UI must not prompt operators to edit internal modules");
assert.doesNotMatch(js, /Enter 保存并跳到下一项/, "writer UI should not require module keyboard workflows");
assert.doesNotMatch(js, /aria-label="\$\{escapeHtml\(module\.label \|\| module\.key\)\} 模块"/, "module editors should not be exposed as product UI");
assert.match(csmFieldLabels, /numerical_rarity: "Numbered \/ Print Run \/ 数字限编"/, "workflow field summaries should label numerical rarity as numbered print run");
assert.match(csmFieldLabels, /print_run_number: "Numbered \/ Print Run \/ 数字限编"/, "workflow field summaries should prefer print_run_number terminology");
assert.match(csmFieldLabels, /card_name: "Card Name"/, "workflow field summaries should label card name clearly");
assert.match(csmFieldLabels, /collector_number: "Card Number"/, "collector number should follow the current CSM output label");
assert.doesNotMatch(js, /moduleTokenSummary/, "token-level structured module UI should remain internal");
assert.doesNotMatch(js, /draftGatePoliciesByField/, "draft gate policies should not drive an exposed field form");
assert.doesNotMatch(js, /INCLUDE_HIGHLIGHTED/, "low-confidence structured terms should not create a visible field form");
assert.doesNotMatch(js, /\$\{publicationGateNotice\(result\)\}/, "frontend should not render a separate publication gate panel in the title-only surface");
assert.match(js, /writer_required_fields/, "frontend should surface unresolved writer-required fields");
assert.match(js, /modelQuickApprovalCandidate/, "frontend should group model quick-approval candidates for writer review");
assert.match(js, /model_quick_review_recommended/, "frontend should treat model quick-review as a writer queue, not direct publishing");
assert.match(js, /低触审核/, "frontend should label low-risk model results as a low-touch writer review queue");
assert.doesNotMatch(js, /data-quick-approve-publish/, "V4 title cards must not expose direct publish actions");
assert.doesNotMatch(js, /quickApproveAndPublish/, "quick approval should be a writer review state, not a publish flow");
assert.doesNotMatch(js, /fetch\("\/api\/listing-render-title"/, "writer UI should not call renderer rerender from a structured module form");
assert.doesNotMatch(js, /module_edit/, "writer UI should not submit structured module edit payloads");
assert.match(js, /title_override/, "manual title overrides should be tracked separately from resolved fields");
assert.doesNotMatch(js, /useRenderedTitle/, "writers should not switch between module title and final title in the title-only UI");
assert.match(js, /generated_resolved_fields/, "feedback saves should include generated resolved snapshots");
assert.match(js, /corrected_resolved_fields/, "feedback saves should include corrected resolved snapshots");
assert.match(js, /review_duration_ms/, "feedback saves should include review duration");
assert.match(js, /workflow_summary/, "feedback saves should include workflow summary context");
assert.match(js, /workflow_sidecars/, "feedback saves should include sidecar context");
assert.match(js, /open_set_readiness/, "feedback saves should include open-set catalog/vector diagnostics");
assert.match(js, /reviewImageReference/, "feedback saves should pass storage object references without browser-only objects");
assert.doesNotMatch(js, /标题未修改，未写入记忆/, "unchanged reviews must not be skipped client-side");
assert.match(js, /payload\.retention_skipped/, "frontend should recognize feedback responses that are intentionally not retained");
assert.match(js, /feedbackStatus = retentionSkipped \? "skipped" : "saved"/, "skipped feedback retention must not be treated as a saved review");
assert.match(js, /未留存/, "skipped feedback retention should be visible to operators");
assert.match(js, /payload\.feedback_event_id/, "frontend should keep the durable V4 feedback event id");
assert.match(js, /payload\.learning_event_id/, "frontend should surface V4 learning event persistence");
assert.doesNotMatch(js, /buildListingDraft/, "V4 writer UI should not build publish drafts");
assert.doesNotMatch(js, /review_status: "APPROVED"/, "V4 writer UI should not mark publish drafts approved");
assert.doesNotMatch(js, /fetch\("\/api\/listing-publish-draft"/, "V4 writer UI should not publish directly");
assert.doesNotMatch(js, /data-publish-draft/, "approved reviews should not expose a publish action in the title-only surface");
assert.doesNotMatch(js, /destination: "mock_b_end"/, "V4 writer UI should not target a mock B-end adapter");
assert.doesNotMatch(js, /dry_run: true/, "publish dry-run settings should not live in the title review UI");
assert.match(js, /data-emergency-retry/, "failed assets should expose explicit GPT single-provider retry control");
assert.match(js, /retryAssetWithEmergency/, "GPT single-provider retry should be a separate action");
assert.match(js, /renderProviderControl/, "provider controls should be rendered from server status");
assert.match(js, /function renderProviderControl\(\)[\s\S]*elements\.processButton\.disabled = !canGenerateTitles\(\)/, "provider status rendering should refresh the generate button state");
assert.match(js, /processingCompletionStatus/, "batch completion should summarize success and failure counts");
assert.match(js, /已完成：\$\{succeeded\} 个成功，\$\{failed\} 个失败/, "partial failures should produce an actionable completion status");
assert.match(js, /activeAssetIndexes/, "frontend should track active assets for visible processing state");
assert.match(js, /targetFraction/, "asset progress should separate real stage targets from displayed progress");
assert.match(js, /displayFraction/, "asset progress should smooth displayed percentages instead of jumping stages");
assert.match(js, /startProgressTicker/, "progress should advance gradually while provider work is pending");
assert.match(js, /function hasLiveAssetProgress\(\)[\s\S]*v4WriterTitlePending/, "progress should remain alive after queue submission while final L2 titles are pending");
assert.doesNotMatch(js, /state\.assetProgress = new Map\(\);\n\s*stopProgressTicker\(\);\n\s*state\.completedAssetCount/, "queue submission must not erase per-card progress before final titles arrive");
assert.match(js, /已提交全部 \$\{state\.assets\.length\} 张/, "queue submission copy must not claim the batch is complete while L2 titles are pending");
assert.match(js, /progressStepForTarget/, "progress should move slowly and wait near later stages");
assert.doesNotMatch(js, /moduleRevealCount/, "title-only UI should not stage module reveal state");
assert.doesNotMatch(js, /revealResultModules/, "title-only UI should not animate structured module reveal");
assert.match(js, /loading-spinner/, "pending cards should render an obvious waiting spinner");
assert.doesNotMatch(js, /\$\{backgroundLabel \?/, "background preparation must stay invisible until the writer starts recognition");
assert.match(js, /snapshot\.active_ms \+ snapshot\.queue_ms/, "writer-visible elapsed time must cover click-to-final queue and execution time");
assert.doesNotMatch(js, /GPT‑4\.1 单模型重试/, "retry copy must follow the active server model instead of naming a stale provider model");
assert.match(js, /assistedDraftNotice/, "title cards should visibly explain pending final one-line title generation");
assert.match(js, /setStatus\(message,\s*options\s*=\s*\{\}\)/, "status updates should support explicit busy rendering");
assert.match(js, /status-spinner/, "global status should render a spinner while busy");
assert.match(js, /status-dots/, "global status should render animated waiting dots while busy");
assert.match(js, /pending-wave/, "pending cards should render a wave animation while waiting");
assert.match(js, /setProcessButtonBusy/, "generate button should show a busy state during recognition");
assert.match(js, /friendlyErrorSummary/, "failed cards should explain why title output is unavailable");
assert.match(js, /placeholder="\$\{escapeHtml\(unavailableTitle\)\}"/, "failed cards should render an editable empty title with the error as placeholder");
assert.doesNotMatch(js, /草稿|后台继续|内部 scout/, "writer-facing UI copy must not expose draft/L1 internals");
assert.match(js, /data-copy-result/, "copy buttons should read the latest edited title from state instead of stale HTML data");
assert.doesNotMatch(js, /imageSideLabel|imagePreviewLabel/, "writer UI should not render visible image slot labels");
assert.doesNotMatch(js, /<span>\$\{imageSideLabel/, "thumbnail cards should show bare images without image slot badges");
assert.doesNotMatch(js, /flushActiveModuleEditForResult/, "saving should no longer depend on hidden module edit flushing");
assert.doesNotMatch(js, /moduleInput\.dataset\.dirty = "true"/, "title-only UI should not keep module dirty state");
assert.match(api, /scope: "listing_title"[\s\S]*limit: 120/, "title generation API should default to a multi-tab friendly rate limit");
assert.match(css, /\.provider-option\.active/, "selected provider should have a visible active state");
assert.match(css, /\.provider-option:disabled/, "disabled providers should render as unavailable");
assert.match(css, /\.title-output/, "title card output should keep a stable card layout");
assert.match(css, /\.reject-button/, "reject action should have a stable UI hook");
assert.doesNotMatch(css, /\.side-decision-panel/, "front/back decision panels should be removed from the title-only UI");
assert.doesNotMatch(css, /\.side-decision-panel\.side-confirmed/, "confirmed front/back side states should not be styled");
assert.doesNotMatch(css, /\.side-decision-panel\.side-swapped/, "swapped front/back side states should not be styled");
assert.match(css, /\.module-token\.needs-review/, "low-confidence module tokens should be yellow-highlighted");
assert.match(css, /transition: width 900ms/, "progress bar width should animate slowly instead of jumping");
assert.match(css, /\.pending-module-grid span\.module-active/, "pending recognition modules should show staged active states");
assert.match(css, /\.pending-module-grid span\.module-done/, "pending recognition modules should show staged completed states");
assert.match(css, /\.pending-state/, "pending cards should have a stable waiting layout");
assert.match(css, /\.loading-spinner/, "pending cards should show a loading spinner");
assert.match(css, /\.status-spinner/, "global upload/recognition status should show a spinner");
assert.match(css, /\.status-dots i/, "global upload/recognition status should show waiting dots");
assert.match(css, /\.pending-wave/, "pending cards should include a wave loading animation");
assert.match(css, /\.sr-only/, "modal image switcher should keep accessible labels without visible image-slot text");
assert.match(css, /\.modal-side-button::before/, "modal image switcher should use compact dots instead of image-slot labels");
assert.doesNotMatch(css, /\.thumb-button span/, "thumbnail cards should not render image slot badges");
assert.match(css, /\.assisted-draft-status/, "title cards should show background assisted-draft status");
assert.match(css, /\.assisted-draft-status\.ready/, "completed L2 assisted drafts should have a distinct ready state");
assert.match(css, /\.drop-zone\.status-busy::after/, "busy upload zone should show an animated progress sweep");
assert.match(css, /\.primary-button\.is-loading::before/, "generate button should show a loading spinner");
assert.match(css, /\.title-output-pending::before/, "pending result cards should show a subtle progress sweep");
assert.match(css, /\.primary-button\.is-loading:disabled/, "busy generate button should remain visually legible while disabled");
assert.match(css, /prefers-reduced-motion/, "loading animations should respect reduced motion preferences");
assert.match(css, /\.publication-gate/, "partial writer draft gate should be visible");
assert.match(css, /\.workflow-summary/, "workflow summary should have a compact writer-facing layout");
assert.match(css, /\.title-omission-notice/, "CSM title compression notice should have a compact visual treatment");
assert.match(css, /\.workflow-step-row/, "workflow summary should show integrated pipeline steps compactly");
assert.match(css, /\.workflow-step\.workflow-warn/, "non-blocking workflow issues should be visible without exposing raw technical packets");
assert.match(css, /\.workflow-action-list/, "workflow summary should show a compact next-action list");
assert.match(css, /\.workflow-action-list \.workflow-action-conflict/, "conflict next actions should be visually prominent");
assert.match(css, /\.title-override-note/, "title override state should be visible");
assert.doesNotMatch(css, /\.publish-button/, "title-only writer UI should not keep publish button styling");
assert.doesNotMatch(css, /\.publish-status/, "title-only writer UI should not keep publish status styling");
assert.doesNotMatch(html, /name="model_id"|name="endpoint"|id="modelId"|id="providerEndpoint"/i, "frontend must not expose arbitrary model or endpoint inputs");

function makeDomElement() {
  return {
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    focus() {},
    closest() {
      return null;
    },
    querySelector() {
      return makeDomElement();
    },
    querySelectorAll() {
      return [];
    },
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    dataset: {},
    style: {},
    value: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    checked: false
  };
}

globalThis.document = {
  body: makeDomElement(),
  createElement(tagName) {
    if (tagName === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() {
              return { data: new Uint8ClampedArray(4) };
            }
          };
        },
        toDataURL() {
          return "data:image/jpeg;base64,test";
        }
      };
    }
    return makeDomElement();
  },
  querySelector() {
    return makeDomElement();
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {}
};

globalThis.fetch = async (url) => {
  if (String(url).includes("/api/listing-provider-status")) {
    return {
      ok: true,
      json: async () => ({
        default_provider: "openai_legacy",
        providers: []
      })
    };
  }
  return {
    ok: true,
    json: async () => ({})
  };
};

const { __listingCopilotAppTestHooks } = await import("../app/listing-copilot.js");
assert.equal(
  __listingCopilotAppTestHooks.generationSubmissionAllowed({
    assetCount: 10,
    providerId: "openai_legacy",
    workflowReady: true,
    processing: false,
    resultCount: 0
  }),
  true,
  "a prepared batch with no prior submission should be allowed"
);
assert.equal(
  __listingCopilotAppTestHooks.generationSubmissionAllowed({
    assetCount: 10,
    providerId: "openai_legacy",
    workflowReady: true,
    processing: false,
    resultCount: 1
  }),
  false,
  "the batch submit button must stay locked after any durable job/result exists"
);
assert.equal(
  __listingCopilotAppTestHooks.speculativeNeedsFreshEnqueue({ used: true, pending: true }),
  false,
  "a timed-out speculative enqueue must never trigger a second paid enqueue"
);
assert.equal(
  __listingCopilotAppTestHooks.speculativeNeedsFreshEnqueue({ used: false }),
  true,
  "a fresh enqueue is allowed only when no speculative submission existed"
);
const oversizedOriginal = new Blob([new Uint8Array(30)], { type: "image/png" });
const compressedFallback = new Blob([new Uint8Array(10)], { type: "image/jpeg" });
const uploadSourceImage = {
  sourceFile: oversizedOriginal,
  sourceBlob: compressedFallback,
  originalWidth: 8000,
  originalHeight: 6000,
  width: 2200,
  height: 1650
};
assert.equal(
  __listingCopilotAppTestHooks.storageSourceForImage(uploadSourceImage, 20),
  compressedFallback,
  "oversized originals should degrade to the bounded high-quality JPEG instead of failing the card"
);
assert.deepEqual(
  __listingCopilotAppTestHooks.storageDimensionsForImage(uploadSourceImage, compressedFallback),
  { width: 2200, height: 1650 },
  "compressed upload fallback must report its actual dimensions"
);
assert.equal(
  __listingCopilotAppTestHooks.storageSourceForImage(uploadSourceImage, 40),
  oversizedOriginal,
  "original image bytes should be preserved whenever they fit the production upload boundary"
);
const frontImage = {
  id: "front",
  targetedCrops: Array.from({ length: 6 }, (_, index) => ({
    id: `front-crop-${index}`,
    derived: true,
    cropPlan: { priority: 100 - index }
  }))
};
const backImage = {
  id: "back",
  targetedCrops: Array.from({ length: 6 }, (_, index) => ({
    id: `back-crop-${index}`,
    derived: true,
    cropPlan: { priority: 90 - index }
  }))
};
const providerImages = __listingCopilotAppTestHooks.imagesForProvider([frontImage, backImage]);
assert.equal(providerImages.length, 10, "pair mode provider payload should keep two originals plus a bounded balanced crop set");
assert.equal(providerImages[0], frontImage, "first uploaded original should be preserved first");
assert.equal(providerImages[1], backImage, "second uploaded original should be preserved second");
assert.equal(providerImages.filter((image) => image.derived).length, 8, "field crops should be bounded across the whole card asset");
assert.deepEqual(
  providerImages.slice(2).map((image) => image.id),
  [
    "front-crop-0",
    "back-crop-0",
    "front-crop-1",
    "back-crop-1",
    "front-crop-2",
    "back-crop-2",
    "front-crop-3",
    "back-crop-3",
  ],
  "highest-priority crops should be retained symmetrically without front/back assumptions"
);

const boundedRequestImages = __listingCopilotAppTestHooks.boundedProviderImagesForRequest([
  { id: "front" },
  { id: "back" },
  ...Array.from({ length: 20 }, (_, index) => ({ id: `crop-${index}`, derived: true }))
]);
assert.equal(boundedRequestImages.length, 14, "provider image batches must retain a production-safe hard bound");
assert.deepEqual(
  boundedRequestImages.slice(0, 2).map((image) => image.id),
  ["front", "back"],
  "bounded request batches must preserve primary paired images"
);
assert.deepEqual(
  boundedRequestImages.slice(2).map((image) => image.id),
  Array.from({ length: 12 }, (_, index) => `crop-${index}`),
  "bounded request batches should keep only the highest-priority derived evidence"
);

const explicitlyBoundedRequestImages = __listingCopilotAppTestHooks.boundedProviderImagesForRequest([
  { id: "front" },
  { id: "back" },
  ...Array.from({ length: 20 }, (_, index) => ({ id: `crop-${index}`, derived: true }))
], 14);
assert.equal(explicitlyBoundedRequestImages.length, 14, "explicit request bounds should still cap evidence images when needed");

console.log("provider UI tests passed");
