#!/usr/bin/env bash
#
# ovhai-guard.sh — the AI Deploy equivalent of the VM's auto-poweroff.
#
# An AI Deploy app bills per minute for as long as it is RUNNING, and nothing
# stops it on its own. This runs on your own machine (cron / systemd timer) and
# calls `ovhai app stop` when either limit is hit:
#
#   MAX_RUNTIME_HOURS   total metered runtime, accumulated across restarts (50)
#   IDLE_MINUTES        no completed inference request for this long      (60)
#
# Idleness comes from the container's own /healthz, which reports how long it
# has been since any request — chat, ComfyUI or terminal — touched the router.
# A long generation counts as busy; a parked browser tab does not.
#
#   ./ovhai-guard.sh check   <app-id>    one poll (what cron runs)
#   ./ovhai-guard.sh status  <app-id>    budget + idle state
#   ./ovhai-guard.sh install <app-id>    install a */2 * * * * cron entry
#   ./ovhai-guard.sh reset   <app-id>    zero the accumulated runtime
#
set -euo pipefail

MAX_RUNTIME_HOURS="${MAX_RUNTIME_HOURS:-50}"
IDLE_MINUTES="${IDLE_MINUTES:-60}"
POLL_SECONDS="${POLL_SECONDS:-120}"        # keep in step with the cron interval
API_KEY="${VLLM_API_KEY:-${LLM_API_KEY:-}}"

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/ovhai-guard"
mkdir -p "$STATE_DIR"

cmd="${1:-status}"
APP_ID="${2:-${OVHAI_APP_ID:-}}"
[[ -n "$APP_ID" ]] || { echo "usage: $0 {check|status|install|reset} <app-id>" >&2; exit 2; }

RUNTIME_FILE="$STATE_DIR/$APP_ID.runtime"     # accumulated seconds RUNNING
LASTREQ_FILE="$STATE_DIR/$APP_ID.lastreq"     # epoch of the last request served
LOG_FILE="$STATE_DIR/$APP_ID.log"

now() { date +%s; }
say() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE" >&2; }

app_json() { ovhai app get "$APP_ID" -o json 2>/dev/null; }

app_state() {
  app_json | python3 -c '
import json,sys
try: d = json.load(sys.stdin)
except Exception: print("UNKNOWN"); raise SystemExit
s = d.get("status") or {}
print(s.get("state") or s.get("phase") or "UNKNOWN")'
}

app_url() {
  app_json | python3 -c '
import json,sys
try: d = json.load(sys.stdin)
except Exception: raise SystemExit
s = d.get("status") or {}
print(s.get("url") or (s.get("http") or {}).get("url") or "")'
}

# Seconds since the container last served a request. /healthz reports 0 while
# anything is still streaming, so long generations never look idle.
idle_seconds() {
  local url="$1" out
  out="$(curl -fsS --max-time 10 "$url/healthz" 2>/dev/null)" || return 1
  python3 -c 'import json,sys; print(int(json.load(sys.stdin)["idle_seconds"]))' <<<"$out" 2>/dev/null
}

stop_app() {
  local why="$1"
  say "STOP ($why) — ovhai app stop $APP_ID"
  ovhai app stop "$APP_ID" && say "stopped; billing ends when the app leaves RUNNING"
}

do_check() {
  local state; state="$(app_state)"
  if [[ "$state" != "RUNNING" ]]; then
    say "app is $state — nothing to do"
    return
  fi

  # --- metered runtime, accumulated by sampling so restarts keep the budget ---
  local acc; acc="$(cat "$RUNTIME_FILE" 2>/dev/null || echo 0)"
  acc=$(( acc + POLL_SECONDS ))
  echo "$acc" > "$RUNTIME_FILE"

  if (( MAX_RUNTIME_HOURS > 0 && acc >= MAX_RUNTIME_HOURS * 3600 )); then
    stop_app "hit the ${MAX_RUNTIME_HOURS}h runtime budget"
    return
  fi

  # --- idleness, straight from the container ---------------------------------
  local url; url="$(app_url)"
  [[ -n "$url" ]] || { say "no app URL yet (still starting?)"; return; }

  local idle
  if ! idle="$(idle_seconds "$url")" || [[ -z "$idle" ]]; then
    # Unreachable usually means it is still booting — pulling models can take
    # a while. Treat that as busy rather than shutting down a starting app.
    say "/healthz unreachable — treating as busy (still starting?)"
    echo "$(now)" > "$LASTREQ_FILE"
    return
  fi
  echo "$(( $(now) - idle ))" > "$LASTREQ_FILE"

  if (( idle >= IDLE_MINUTES * 60 )); then
    stop_app "idle for $(( idle / 60 ))min"
  fi
}

do_status() {
  local acc idle_min left
  acc="$(cat "$RUNTIME_FILE" 2>/dev/null || echo 0)"
  left=$(( MAX_RUNTIME_HOURS * 3600 - acc ))
  idle_min=$(( ( $(now) - $(cat "$LASTREQ_FILE" 2>/dev/null || now) ) / 60 ))

  printf '  app       %s (%s)\n' "$APP_ID" "$(app_state)"
  printf '  url       %s\n' "$(app_url)"
  printf '  runtime   %dh %dm used of %sh — %dh %dm left\n' \
    $(( acc / 3600 )) $(( acc % 3600 / 60 )) "$MAX_RUNTIME_HOURS" \
    $(( left > 0 ? left / 3600 : 0 )) $(( left > 0 ? left % 3600 / 60 : 0 ))
  printf '  idle      %dmin (stops at %smin)\n' "$idle_min" "$IDLE_MINUTES"
}

case "$cmd" in
  check)  do_check ;;
  status) do_status ;;
  reset)  echo 0 > "$RUNTIME_FILE"; echo "runtime budget reset for $APP_ID" ;;
  install)
    self="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
    line="*/2 * * * * MAX_RUNTIME_HOURS=$MAX_RUNTIME_HOURS IDLE_MINUTES=$IDLE_MINUTES POLL_SECONDS=120 VLLM_API_KEY=$API_KEY $self check $APP_ID >/dev/null 2>&1"
    ( crontab -l 2>/dev/null | grep -vF "$self check $APP_ID"; echo "$line" ) | crontab -
    echo "cron installed — polls every 2 minutes:"
    echo "  $line"
    echo "this only guards while your machine is on; a tiny always-on box is safer"
    ;;
  *) echo "usage: $0 {check|status|install|reset} <app-id>" >&2; exit 2 ;;
esac
