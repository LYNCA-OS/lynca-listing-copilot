# Compact residual v4 paid105 runbook — 2026-08-09

## Decision boundary

This runbook authorizes one isolated Singapore Preview screen only: 70 compact
treatments plus 35 contemporaneous paired controls, exactly 105 provider
attempts, concurrency 1, and zero retries. It cannot authorize Production. A
PASS only permits inclusion in a later independent fresh150 bundle.

The paid run must STOP before the first provider call unless every receipt below
passes. An `ATTEMPTED` or `FAILED` job is permanently spent; never delete the
checkpoint or invoke that job again.

## 1. Local zero-network freeze

Run from `/Users/paidaxin/lynca-thin-path` on a clean committed `codex/*`
branch. Do not deploy an uncommitted working tree because the deployment receipt
binds the Preview to the Git SHA.

```bash
node experiments/vercel-capacity-probe/verify-cloud-sim-context.mjs --require-link --require-data
node experiments/vercel-capacity-probe/residual-compact-v4.test.mjs
node scripts/model-residual-compact-v4-cloud-gate.test.mjs
git diff --check
git status --short --branch
```

Create the internal artifact directory, then project the 70 physical image sets
and label references without opening the sealed-label file:

```bash
export COMPACT_V4_OUT=/Users/paidaxin/lynca-thin-path/artifacts/model-residual-compact-v4-paid105-2026-08-09
mkdir -p "$COMPACT_V4_OUT"
node experiments/vercel-capacity-probe/build-residual-compact-v4-inputs.mjs \
  --dataset /Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json \
  --prereg experiments/accuracy/model-residual-compact-v4-cloud-prereg.json \
  --v3-prereg experiments/accuracy/model-residual-candidate-v3-35x3-prereg.json \
  --assets-out "$COMPACT_V4_OUT/assets-only.json" \
  --label-ref-out "$COMPACT_V4_OUT/label-ref-receipt.json" \
  --control-template-out "$COMPACT_V4_OUT/control-template.json" \
  --treatment-template-out "$COMPACT_V4_OUT/treatment-template.json"
```

Expected stdout: `provider_calls=0`, `network_calls=0`, `label_files_read=0`,
and `cards=70`. The physical split is 69 front/back pairs plus one front-only
card, or 139 signed objects total.

## 2. Immutable capacity-lab Preview

Deploy only `experiments/vercel-capacity-probe` to the already linked
`lynca-capacity-lab` project. Never use the Production project or hostname.

```bash
cd /Users/paidaxin/lynca-thin-path/experiments/vercel-capacity-probe
export COMPACT_V4_SOURCE_SHA=$(git -C /Users/paidaxin/lynca-thin-path rev-parse HEAD)
vercel deploy --yes --scope lyncafei-s-projects \
  -e LYNCA_RELEASE_GIT_SHA="$COMPACT_V4_SOURCE_SHA"
```

Copy the immutable deployment URL printed by Vercel, then bind it to the clean
source SHA. The endpoint must report `preview`, `sin1`, one-card batches,
concurrency 1, both compact arms, and all three configured secrets without
revealing their values.

```bash
export COMPACT_V4_PREVIEW_URL=https://REPLACE-WITH-IMMUTABLE-DEPLOYMENT.vercel.app
vercel curl /api/accuracy --deployment "$COMPACT_V4_PREVIEW_URL" > "$COMPACT_V4_OUT/readiness.json"
cd /Users/paidaxin/lynca-thin-path
node scripts/build-model-residual-compact-v4-deployment-receipt.mjs \
  --readiness "$COMPACT_V4_OUT/readiness.json" \
  --deployment "$COMPACT_V4_PREVIEW_URL" \
  --source-git-sha "$COMPACT_V4_SOURCE_SHA" \
  --out "$COMPACT_V4_OUT/deployment-receipt.json"
```

## 3. Singapore Storage materialization

Use the already configured Singapore Supabase secret key. The command reads it
from `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`; never put the value in
argv, stdout, a tracked file, or this document.

```bash
node experiments/vercel-capacity-probe/materialize-residual-compact-v4-payload.mjs \
  --prereg experiments/accuracy/model-residual-compact-v4-cloud-prereg.json \
  --assets-manifest "$COMPACT_V4_OUT/assets-only.json" \
  --label-ref-receipt "$COMPACT_V4_OUT/label-ref-receipt.json" \
  --control-template "$COMPACT_V4_OUT/control-template.json" \
  --treatment-template "$COMPACT_V4_OUT/treatment-template.json" \
  --out "$COMPACT_V4_OUT/payload.json"
```

Expected stdout: `provider_calls=0`, `storage_sign_calls=139`,
`storage_read_calls=139`, `cards=70`. Each signed object is read once at
materialization; only its SHA-256 and byte length are retained. Materialize
immediately before the run; the initial payload gate requires at least three
hours remaining and every job separately requires at least 180 seconds
remaining.

## 4. Zero-call Preview preflight and authorization

The Preview run token is read from the existing macOS Keychain item; no token is
accepted through argv or stdout.

```bash
export COMPACT_V4_RUN_ID=compact-v4-paid105-20260809-v1
node experiments/vercel-capacity-probe/run-cloud-residual-compact-v4.mjs \
  --prereg experiments/accuracy/model-residual-compact-v4-cloud-prereg.json \
  --payload "$COMPACT_V4_OUT/payload.json" \
  --assets-manifest "$COMPACT_V4_OUT/assets-only.json" \
  --label-ref-receipt "$COMPACT_V4_OUT/label-ref-receipt.json" \
  --deployment-receipt "$COMPACT_V4_OUT/deployment-receipt.json" \
  --deployment "$COMPACT_V4_PREVIEW_URL" \
  --out "$COMPACT_V4_OUT/checkpoint.json" \
  --run-id "$COMPACT_V4_RUN_ID" \
  --dry-run
node scripts/authorize-model-residual-compact-v4-cloud.mjs \
  --prereg experiments/accuracy/model-residual-compact-v4-cloud-prereg.json \
  --payload "$COMPACT_V4_OUT/payload.json" \
  --assets-manifest "$COMPACT_V4_OUT/assets-only.json" \
  --label-ref-receipt "$COMPACT_V4_OUT/label-ref-receipt.json" \
  --deployment-receipt "$COMPACT_V4_OUT/deployment-receipt.json" \
  --checkpoint "$COMPACT_V4_OUT/checkpoint.json" \
  --out "$COMPACT_V4_OUT/authorization.json"
```

The preflight must end `PREFLIGHT_COMPLETE` with zero attempts/calls/retries.
Authorization binds the prereg, payload, 70 physical image sets, label mapping,
sealed-label hash, immutable Preview, run ID, run fingerprint, 35/35 zero-call
fidelity, and the explicit 2026-08-09 user approval.

## 5. Exactly 105 paid calls

```bash
node experiments/vercel-capacity-probe/run-cloud-residual-compact-v4.mjs \
  --prereg experiments/accuracy/model-residual-compact-v4-cloud-prereg.json \
  --payload "$COMPACT_V4_OUT/payload.json" \
  --assets-manifest "$COMPACT_V4_OUT/assets-only.json" \
  --label-ref-receipt "$COMPACT_V4_OUT/label-ref-receipt.json" \
  --deployment-receipt "$COMPACT_V4_OUT/deployment-receipt.json" \
  --deployment "$COMPACT_V4_PREVIEW_URL" \
  --out "$COMPACT_V4_OUT/checkpoint.json" \
  --run-id "$COMPACT_V4_RUN_ID" \
  --authorization "$COMPACT_V4_OUT/authorization.json"
```

Success is only `COMPLETE`, `provider_attempts=105`, `provider_calls=105`, and
`provider_retries=0`. A transport ambiguity, provider failure, response identity
mismatch, served-effort drift, request drift, duplicate response ID, TTL breach,
or raw-response replay mismatch is a terminal STOP, not a reason to retry. The
checkpoint retains the complete provider response bytes and re-derives status,
model, served effort, usage, and structured output on resume.

## 6. Offline sealed-label analysis

Only after the complete checkpoint validates may the analyzer open sealed
labels. First re-read the 139 signed Storage objects without invoking the model;
this creates a post-run byte-identity receipt. The analyzer then replays every
complete raw provider response and validates authorization, deployment,
preflight, physical assets, and the post-run byte receipt before label loading.

```bash
node scripts/reverify-model-residual-compact-v4-assets.mjs \
  --payload "$COMPACT_V4_OUT/payload.json" \
  --out "$COMPACT_V4_OUT/asset-reverify.json"
node scripts/analyze-model-residual-compact-v4-cloud.mjs \
  --prereg experiments/accuracy/model-residual-compact-v4-cloud-prereg.json \
  --payload "$COMPACT_V4_OUT/payload.json" \
  --assets-manifest "$COMPACT_V4_OUT/assets-only.json" \
  --label-ref-receipt "$COMPACT_V4_OUT/label-ref-receipt.json" \
  --deployment-receipt "$COMPACT_V4_OUT/deployment-receipt.json" \
  --authorization "$COMPACT_V4_OUT/authorization.json" \
  --checkpoint "$COMPACT_V4_OUT/checkpoint.json" \
  --asset-reverify "$COMPACT_V4_OUT/asset-reverify.json" \
  --dataset /Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-image-only.json \
  --labels /Users/paidaxin/lynca-eval-root/data/eval/reviewed-title-blind/reviewed-title-sealed-labels.jsonl \
  --out "$COMPACT_V4_OUT/analysis.json"
shasum -a 256 "$COMPACT_V4_OUT"/*.json
```

The reviewed-title proxy can produce an internal
`capture_economics_decision=PASS_FOR_FRESH150_BUNDLE_ONLY` only with at least
+0.003 resolver macro F1, at least 6 wins, 0 losses, exact sign `p<=.05`, every
title-proxy safety counter zero, canonical interference no worse than -0.002,
and all token/latency ratios inside the frozen bounds.

The total decision remains `HOLD_TYPED_GOLD_REQUIRED`: this 70-card cohort has
`typed_gold_coverage=0/70`, so critical factual errors, typed-field precision and
recall, required-field missing, and wrong-role counts remain `null`. Independent
typed gold must be completed and the frozen analyzer rerun before this mechanism
can enter a fresh150 bundle. Neither outcome authorizes Production.
