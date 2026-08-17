#!/usr/bin/env bash
#
# deploy.sh — build the image, push it to the OVHcloud shared registry, and
# start (or restart) the AI Deploy app that serves the model + chat UI.
#
# Prerequisites, once per machine:
#   ovhai login                                  # CLI auth
#   ovhai registry list                          # copy the shared registry address
#   docker login <registry-address>              # credentials from the same output
#
# Usage:
#   REGISTRY=xxxx.c1.gra.container-registry.ovh.net/ai-deploy \
#   HF_TOKEN=hf_xxx ./deploy.sh
#
#   MODEL=Qwen/Qwen3-8B FLAVOR=l4-1-gpu ./deploy.sh
#
set -euo pipefail

REGISTRY="${REGISTRY:?set REGISTRY to your shared registry address (ovhai registry list)}"
IMAGE="${IMAGE:-llm-chat}"
TAG="${TAG:-latest}"
APP_NAME="${APP_NAME:-llm-chat}"
LABEL="${LABEL:-name=llm-chat}"

MODEL="${MODEL:-Qwen/Qwen3-8B}"
FLAVOR="${FLAVOR:-l4-1-gpu}"
GPUS="${GPUS:-1}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-8192}"
GPU_MEM_UTIL="${GPU_MEM_UTIL:-0.90}"
HF_TOKEN="${HF_TOKEN:-}"
# Any request to /v1 must carry this as a bearer token. Generated if unset —
# the UI asks for it under "settings", llm-chat takes --api-key.
VLLM_API_KEY="${VLLM_API_KEY:-$(head -c 18 /dev/urandom | base64 | tr -d '/+=' )}"

# Optional: persist the HF cache in object storage so restarts skip the download.
# Format: container@alias/prefix:mount_path:permission:cache
VOLUME="${VOLUME:-}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BUILD_CONTEXT="$(dirname "$SCRIPT_DIR")"     # gpu-vm/, so web/index.html is in context
REF="$REGISTRY/$IMAGE:$TAG"

log() { printf '\033[38;5;42m==>\033[0m %s\n' "$*"; }

command -v ovhai  >/dev/null || { echo "ovhai CLI not found: https://cli.gra.ai.cloud.ovh.net/" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }

log "building $REF"
docker build --platform linux/amd64 -f "$SCRIPT_DIR/Dockerfile" -t "$REF" "$BUILD_CONTEXT"

log "pushing to the shared registry"
docker push "$REF"

# A running app with the same name keeps billing while a second one starts.
existing="$(ovhai app list --label "$LABEL" -o json 2>/dev/null \
            | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(a["id"] for a in d))' 2>/dev/null || true)"
if [[ -n "${existing// }" ]]; then
  log "stopping previous app(s): $existing"
  for id in $existing; do ovhai app stop "$id" >/dev/null || true; done
fi

log "starting app on $FLAVOR (billed per minute while it runs)"
args=(
  app run "$REF"
  --name "$APP_NAME"
  --flavor "$FLAVOR"
  --gpu "$GPUS"
  --label "$LABEL"
  --default-http-port 8080
  --probe-path /health
  --env MODEL="$MODEL"
  --env MAX_MODEL_LEN="$MAX_MODEL_LEN"
  --env GPU_MEM_UTIL="$GPU_MEM_UTIL"
  --env VLLM_API_KEY="$VLLM_API_KEY"
)
[[ -n "$HF_TOKEN" ]] && args+=(--env HF_TOKEN="$HF_TOKEN")
[[ -n "$VOLUME"   ]] && args+=(--volume "$VOLUME")

ovhai "${args[@]}"

cat <<EOF

  ─────────────────────────────────────────────────────────────────
  app       $APP_NAME  ($MODEL on $FLAVOR)
  api key   $VLLM_API_KEY
            (paste into the UI's settings panel, or export LLM_API_KEY)

  url       ovhai app list --label $LABEL      # shows https://<id>.app.<region>.ai.cloud.ovh.net
  logs      ovhai app logs <app-id> -f
  stop      ovhai app stop <app-id>            # this is what stops the billing

  The app bills per minute for as long as it runs — nothing stops it on its
  own. Start the guard so it can't quietly eat the trial credit:

      ./ovhai-guard.sh install <app-id>
  ─────────────────────────────────────────────────────────────────

EOF
