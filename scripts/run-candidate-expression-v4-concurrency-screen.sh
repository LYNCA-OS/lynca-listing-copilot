#!/usr/bin/env bash
# Isolated latency screen for the paid v4 expression request.
# The four levels are intentionally sequential: concurrent levels would
# measure each other instead of the level being screened.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COHORT="${1:-$REPO_ROOT/artifacts/bounded-evidence-v2/cohorts/development-150.asset-ids.json}"
SCREEN_ROOT="${2:-$REPO_ROOT/artifacts/candidate-expression-v4/concurrency-screen-20-2026-08-01}"

[ -f "$COHORT" ] || { echo "missing cohort: $COHORT" >&2; exit 1; }
mkdir -p "$SCREEN_ROOT"

for level in 2 4 6 8; do
  out_dir="$SCREEN_ROOT/c${level}"
  "$REPO_ROOT/scripts/run-thin-path-eval.sh" \
    --arms candidate_expression_v4_high \
    --selection-role "concurrency_screen_v4_c${level}" \
    --concurrency "$level" \
    --limit 20 \
    --asset-ids-file "$COHORT" \
    --out-dir "$out_dir"
done

node "$REPO_ROOT/scripts/analyze-candidate-expression-v4-concurrency-screen.mjs" \
  --root "$SCREEN_ROOT" \
  --out "$SCREEN_ROOT/report.json"
