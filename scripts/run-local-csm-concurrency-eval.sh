#!/usr/bin/env bash
# Durable local entry point for node-isolated CSM concurrency screens.
#
# Examples:
#   scripts/run-local-csm-concurrency-eval.sh --signing-only --limit 20 --levels 2,4,6,10
#   scripts/run-local-csm-concurrency-eval.sh --provider-direct-presigned --limit 20 --levels 10,2
#   scripts/run-local-csm-concurrency-eval.sh --provider-text-control --mock-cards 100 --levels 2,10,50,100
#
# This wrapper uses only Supabase image signing and, when requested, OpenAI
# Responses. It does not traverse Cloud Run, vector retrieval, or OCR.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_ENV="${THIN_PATH_LOCAL_ENV:-$REPO_ROOT/.env.local}"
EVAL_ROOT="${THIN_PATH_EVAL_ROOT:-$HOME/lynca-eval-root}"
ASSETS="${CSM_CONCURRENCY_ASSETS:-$EVAL_ROOT/data/eval/reviewed-title-blind/reviewed-title-image-only.json}"

[ -f "$LOCAL_ENV" ] || { echo "missing local credentials: $LOCAL_ENV" >&2; exit 1; }
[ -f "$ASSETS" ] || { echo "missing concurrency assets: $ASSETS" >&2; exit 1; }

while IFS='=' read -r name value; do
  case "$name" in ''|\#*) continue ;; esac
  [ -n "$value" ] || continue
  export "$name=$value"
done < "$LOCAL_ENV"

for required_name in SUPABASE_URL SUPABASE_SECRET_KEY; do
  [ -n "${!required_name:-}" ] || { echo "missing $required_name in $LOCAL_ENV" >&2; exit 1; }
done

case " $* " in
  *" --signing-only "*) ;;
  *" --provider-direct "*|*" --provider-direct-presigned "*|*" --provider-text-control "*)
    [ -n "${OPENAI_API_KEY:-}" ] || { echo "missing OPENAI_API_KEY in $LOCAL_ENV" >&2; exit 1; }
    ;;
  *)
    echo "choose --signing-only, --provider-direct, --provider-direct-presigned, or --provider-text-control" >&2
    exit 1
    ;;
esac

export NO_PROXY="${NO_PROXY:-},.supabase.co"

exec node --use-env-proxy "$REPO_ROOT/scripts/run-csm-direct-concurrency-sweep.mjs" \
  --assets "$ASSETS" "$@"
