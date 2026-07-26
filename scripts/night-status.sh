#!/bin/bash
# What is running right now, and for how long.
#
#   bash scripts/night-status.sh
#   watch -n 30 bash scripts/night-status.sh
#
# Written for an unattended overnight run so the morning question -- "did it
# actually do anything, or did it queue a task and die?" -- has a one-command
# answer. Three Codex tasks were dispatched earlier today and every one of them
# reported "forwarded" and then produced nothing, so a running process is the
# only evidence worth trusting.

cd "$(dirname "$0")/.." || exit 1

hr() { printf '%s\n' "────────────────────────────────────────────────────────────"; }
age() {  # seconds since a pid started, as h:mm
  local pid=$1 started elapsed
  started=$(ps -o lstart= -p "$pid" 2>/dev/null) || return
  [ -z "$started" ] && return
  elapsed=$(( $(date +%s) - $(date -j -f "%a %b %d %T %Y" "$started" +%s 2>/dev/null || echo "$(date +%s)") ))
  printf '%dh%02dm' $((elapsed/3600)) $(((elapsed%3600)/60))
}

echo
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
hr

# --- running work -----------------------------------------------------------
running=0
# A run shows up as a shell wrapper and the node process under it; report the
# eval once, timed from whichever started first.
seen_labels=""
while read -r pid _; do
  [ -z "$pid" ] && continue
  label=$(ps -o command= -p "$pid" | grep -oE '\-\-label [^ ]+' | awk '{print $NF}')
  label=${label:-?}
  case " $seen_labels " in *" $label "*) continue ;; esac
  seen_labels="$seen_labels $label"
  running=$((running+1))
  echo "  ▶ RUNNING  paired eval  ${label}   elapsed $(age "$pid")"
done < <(pgrep -f "run-paired-eval" | sed 's/$/ /')

while read -r pid _; do
  [ -z "$pid" ] && continue
  running=$((running+1))
  echo "  ▶ RUNNING  codex        elapsed $(age "$pid")"
done < <(pgrep -f "codex exec|codex-companion" | sed 's/$/ /')

[ "$running" -eq 0 ] && echo "  ⏸  nothing running"

# --- ablation progress ------------------------------------------------------
hr
echo "  component ablation"
found=0
for f in artifacts/smoke/paired-eval/ablate-*.json /tmp/evidence-ab.log; do
  [ -e "$f" ] || continue
  found=1
  case "$f" in
    *.log)
      v=$(grep -oE '^(IMPROVED|NOT_PROVEN|WORSE)' "$f" | tail -1)
      r=$(grep -cE 'score=' "$f")
      echo "    evidence-completion        ${v:-running}   ($((r/2))/6 rounds)" ;;
    *)
      name=$(basename "$f" .json)
      case "$name" in *-baseline-r*|*-candidate-r*) continue ;; esac
      v=$(python3 -c "import json,sys;print(json.load(open('$f'))['decision']['verdict'])" 2>/dev/null)
      echo "    ${name#ablate-}   ${v:-?}" ;;
  esac
done
[ "$found" -eq 0 ] && echo "    (no results yet)"

# --- what changed on disk ---------------------------------------------------
hr
echo "  commits since the night began"
git log --oneline --since="8 hours ago" 2>/dev/null | head -12 | sed 's/^/    /'
echo
echo "  uncommitted"
if [ -n "$(git status --short 2>/dev/null)" ]; then
  git status --short | head -8 | sed 's/^/    /'
else
  echo "    (clean)"
fi
hr
echo
