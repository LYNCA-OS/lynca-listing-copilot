#!/usr/bin/env bash
# Environment assembly for the paired thin-path evaluation.
#
#   scripts/run-thin-path-eval.sh --arms thin_budgeted,thin_canonical --limit 150
#
# Every step below has cost a run:
#
#   * Empty values are SKIPPED. `vercel env pull` writes encrypted variables as
#     "", and sourcing those blanks the real values exported earlier.
#   * SUPABASE_URL is set explicitly. No local file carries the real one, so a
#     run that trusts the env file fails on the first signed URL.
#   * The network is forked: OpenAI must go through the proxy, Supabase must
#     not. Hence `--use-env-proxy` AND `.supabase.co` in NO_PROXY.
#   * EVAL_ROOT is a local copy, not the external volume. The volume dropped
#     twice in one session, and the dataset plus scorer are 24MB with no
#     business living behind a connector. Not the main repo either: its
#     evaluate-cloud-listing-api.mjs lacks the recognitionBenchmarkProfile
#     wrapper, and quietly changing the scorer between runs is the confound the
#     paired design exists to avoid.
#
# Secrets stay outside the repository and are read at run time.
set -euo pipefail

SECRETS_DIR="${THIN_PATH_SECRETS_DIR:-$HOME/.lynca-eval-secrets}"
EVAL_ROOT="${THIN_PATH_EVAL_ROOT:-$HOME/lynca-eval-root}"

for required in "$SECRETS_DIR/eval.env" "$SECRETS_DIR/openai.key"; do
  [ -f "$required" ] || { echo "missing: $required" >&2; exit 1; }
done
[ -d "$EVAL_ROOT" ] || { echo "missing eval root: $EVAL_ROOT" >&2; exit 1; }

# Skip blanks rather than sourcing the file wholesale.
while IFS='=' read -r name value; do
  case "$name" in ''|\#*) continue ;; esac
  [ -n "$value" ] || continue
  export "$name=$value"
done < "$SECRETS_DIR/eval.env"

export OPENAI_API_KEY="$(cat "$SECRETS_DIR/openai.key")"
export SUPABASE_URL="${SUPABASE_URL:-https://osrrujmpxxiefppjfgpd.supabase.co}"
export NO_PROXY="${NO_PROXY:-},.supabase.co"

exec node --use-env-proxy "$(dirname "$0")/run-thin-path-eval.mjs" --eval-root "$EVAL_ROOT" "$@"
