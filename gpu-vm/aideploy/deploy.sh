#!/usr/bin/env bash
#
# deploy.sh — build the image, push it to Docker Hub, and start the AI Deploy app.
#
# Prerequisites, once:
#   docker login                  # Docker Hub
#   ovhai login                   # OVHcloud AI CLI
#
# If the Docker Hub repo is private, add it to AI Deploy as an authorised
# registry first (Control Panel -> AI & ML -> Registries, or `ovhai registry add`),
# otherwise OVH cannot pull the image.
#
# Usage:
#   DOCKER_USER=yourname ./deploy.sh
#   DOCKER_USER=yourname FLAVOR=l4-1-gpu MODELS="qwen3:8b granite4.1" ./deploy.sh
#   DOCKER_USER=yourname BUILD_ONLY=1 ./deploy.sh      # build + push, don't start
#
set -euo pipefail

DOCKER_USER="${DOCKER_USER:?set DOCKER_USER to your Docker Hub username}"
IMAGE="${IMAGE:-ai-app}"
TAG="${TAG:-latest}"
REF="docker.io/$DOCKER_USER/$IMAGE:$TAG"

APP_NAME="${APP_NAME:-ai-app}"
LABEL="${LABEL:-name=ai-app}"
FLAVOR="${FLAVOR:-l4-1-gpu}"
GPUS="${GPUS:-1}"
MODELS="${MODELS:-qwen3:8b}"

INSTALL_BOB="${INSTALL_BOB:-1}"
INSTALL_CLAUDE="${INSTALL_CLAUDE:-1}"
BUILD_ONLY="${BUILD_ONLY:-0}"

# Generated unless you pass them. The API key gates /v1 and ComfyUI; the
# terminal password gates the browser shell, which is a root shell in the
# container — without it the terminal stays off.
APP_API_KEY="${APP_API_KEY:-$(head -c 18 /dev/urandom | base64 | tr -d '/+=')}"
TERMINAL_PASSWORD="${TERMINAL_PASSWORD:-$(head -c 12 /dev/urandom | base64 | tr -d '/+=')}"

# Persist models, ComfyUI output and the agents' logins across restarts.
# Format: container@alias/prefix:mount_path:permission:cache
VOLUME="${VOLUME:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_CONTEXT="$(dirname "$SCRIPT_DIR")"

log() { printf '\033[38;5;42m==>\033[0m %s\n' "$*"; }

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }

log "building $REF (linux/amd64, as OVH requires)"
docker build --platform linux/amd64 \
  --build-arg INSTALL_BOB="$INSTALL_BOB" \
  --build-arg INSTALL_CLAUDE="$INSTALL_CLAUDE" \
  -f "$SCRIPT_DIR/Dockerfile" -t "$REF" "$BUILD_CONTEXT"

log "pushing to Docker Hub"
docker push "$REF"

if [[ "$BUILD_ONLY" == "1" ]]; then
  log "built and pushed — skipping the app start (BUILD_ONLY=1)"
  echo "  image: $REF"
  exit 0
fi

command -v ovhai >/dev/null || { echo "ovhai CLI not found: https://cli.gra.ai.cloud.ovh.net/" >&2; exit 1; }

# A previous app keeps billing while a new one starts.
existing="$(ovhai app list --label "$LABEL" -o json 2>/dev/null \
            | python3 -c 'import json,sys; print(" ".join(a["id"] for a in json.load(sys.stdin)))' 2>/dev/null || true)"
if [[ -n "${existing// }" ]]; then
  log "stopping previous app(s): $existing"
  for id in $existing; do ovhai app stop "$id" >/dev/null || true; done
fi

log "starting $APP_NAME on $FLAVOR — billed per minute from here"
args=(
  app run "$REF"
  --name "$APP_NAME"
  --flavor "$FLAVOR"
  --gpu "$GPUS"
  --label "$LABEL"
  --default-http-port 8080
  --probe-path /healthz
  --env APP_API_KEY="$APP_API_KEY"
  --env TERMINAL_PASSWORD="$TERMINAL_PASSWORD"
  --env OLLAMA_MODELS_PRELOAD="$MODELS"
)
[[ -n "$VOLUME" ]] && args+=(--volume "$VOLUME")

ovhai "${args[@]}"

cat <<EOF

  ─────────────────────────────────────────────────────────────────
  image     $REF
  app       $APP_NAME on $FLAVOR, models: $MODELS

  api key   $APP_API_KEY
  terminal  user "dev", password $TERMINAL_PASSWORD

  Once it reports RUNNING (ovhai app list --label $LABEL):

    https://<app>.app.<region>.ai.cloud.ovh.net/              chat UI
    https://<app>.app.<region>.ai.cloud.ovh.net/comfy         ComfyUI
    https://<app>.app.<region>.ai.cloud.ovh.net/term?key=...  terminal
    https://<app>.app.<region>.ai.cloud.ovh.net/healthz       status

  In the terminal, log the agents in with your own accounts:
    claude          then /login  — uses your Claude Pro subscription
    bob             then follow its IBM login prompt

  Nothing stops the app on its own. Arm the guard:
    ./ovhai-guard.sh install <app-id>
  ─────────────────────────────────────────────────────────────────

EOF
