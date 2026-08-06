#!/usr/bin/env bash
# Durable local entry point for the paid paired thin-path evaluation.
#
#   scripts/run-thin-path-eval.sh --arms thin_budgeted,thin_canonical --limit 150
#   (default local thin-path concurrency: c2; pass --concurrency to override)
#
# Every step below has cost a run:
#
#   * `.env.local` is the one local credential source. It is gitignored and
#     must contain OPENAI_API_KEY, SUPABASE_URL and SUPABASE_SECRET_KEY.
#   * Empty values are skipped instead of blanking an already exported value.
#   * The network is forked: OpenAI must go through the proxy, Supabase must
#     not. Hence `--use-env-proxy` AND `.supabase.co` in NO_PROXY.
#   * EVAL_ROOT is a local copy, not the external volume. The volume dropped
#     twice in one session, and the dataset plus scorer are 24MB with no
#     business living behind a connector. Not the main repo either: its
#     evaluate-cloud-listing-api.mjs lacks the recognitionBenchmarkProfile
#     wrapper, and quietly changing the scorer between runs is the confound the
#     paired design exists to avoid.
#
# This route signs source images in Supabase and calls OpenAI Responses
# directly. It has no Cloud Run, vector or OCR node.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_ENV="${THIN_PATH_LOCAL_ENV:-$REPO_ROOT/.env.local}"
EVAL_ROOT="${THIN_PATH_EVAL_ROOT:-$HOME/lynca-eval-root}"

[ -f "$LOCAL_ENV" ] || { echo "missing local credentials: $LOCAL_ENV" >&2; exit 1; }
[ -d "$EVAL_ROOT" ] || { echo "missing eval root: $EVAL_ROOT" >&2; exit 1; }

# Skip blanks rather than sourcing executable shell text.
while IFS='=' read -r name value; do
  case "$name" in ''|\#*) continue ;; esac
  [ -n "$value" ] || continue
  export "$name=$value"
done < "$LOCAL_ENV"

for required_name in OPENAI_API_KEY SUPABASE_URL SUPABASE_SECRET_KEY; do
  [ -n "${!required_name:-}" ] || { echo "missing $required_name in $LOCAL_ENV" >&2; exit 1; }
done

export NO_PROXY="${NO_PROXY:-},.supabase.co"

exec node --use-env-proxy "$(dirname "$0")/run-thin-path-eval.mjs" --eval-root "$EVAL_ROOT" "$@"
