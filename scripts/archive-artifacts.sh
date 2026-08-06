#!/usr/bin/env bash
# Copy run artifacts to the external archive. Run after every batch.
#
# Not optional and not tidiness: a full day of per-card run output was lost on
# 2026-08-01 because it lived only under /private/tmp. Per-card jsonl is bought
# with real money and real wall-clock; the code can be rewritten, the run cannot
# be re-derived without paying again.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)/artifacts"
DST="${THIN_PATH_ARCHIVE:-/Volumes/musician/lynca-offload/thin-path-artifacts}"
[ -d "$SRC" ] || { echo "no artifacts yet: $SRC" >&2; exit 0; }
[ -d "$(dirname "$DST")" ] || { echo "archive volume not mounted: $DST" >&2; exit 1; }
mkdir -p "$DST"
rsync -a "$SRC/" "$DST/"
echo "archived $(find "$SRC" -type f | wc -l | tr -d ' ') files -> $DST"
