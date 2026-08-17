#!/usr/bin/env bash
#
# setup-debian-gpu.sh — provision an OVH Public Cloud GPU instance (Debian 12/13)
# into a Hugging Face model server with a browser chat UI and a terminal client.
#
# What it installs:
#   - NVIDIA driver + CUDA userspace (skipped if nvidia-smi already works)
#   - Python venv at /opt/llm/venv with vLLM (OpenAI-compatible server)
#   - A Hugging Face model, pre-downloaded into /opt/llm/hf-cache
#   - systemd unit  vllm.service      — the model server on 127.0.0.1:8000
#   - nginx on :8080                  — chat UI at /, API proxied at /v1
#   - llm-chat                        — terminal client
#   - llm-lifeguard.timer             — powers the VM off after 50h total,
#                                       or after 1h with no activity
#
# Usage:
#   sudo ./setup-debian-gpu.sh                        # full run, defaults
#   sudo ./setup-debian-gpu.sh --model Qwen/Qwen3-8B  # pick a model
#   sudo HF_TOKEN=hf_xxx ./setup-debian-gpu.sh        # for gated repos
#   sudo ./setup-debian-gpu.sh --skip-driver          # image already has CUDA
#
# The driver install needs one reboot. The script tells you, and you re-run the
# same command afterwards — it picks up where it left off.
#
set -euo pipefail

# ---------------------------------------------------------------- defaults ---

MODEL="${MODEL:-Qwen/Qwen3-8B}"
SERVED_NAME="${SERVED_NAME:-}"            # defaults to the basename of MODEL
API_PORT="${API_PORT:-8000}"              # vLLM, loopback only
WEB_PORT="${WEB_PORT:-8080}"              # nginx, public
MAX_MODEL_LEN="${MAX_MODEL_LEN:-8192}"    # KV cache is sized from this
GPU_MEM_UTIL="${GPU_MEM_UTIL:-0.90}"
TENSOR_PARALLEL="${TENSOR_PARALLEL:-auto}"
HF_TOKEN="${HF_TOKEN:-}"
CHAT_USER="${CHAT_USER:-}"                # set both to put basic auth on :8080
CHAT_PASSWORD="${CHAT_PASSWORD:-}"

MAX_LIFETIME_HOURS="${MAX_LIFETIME_HOURS:-50}"
IDLE_MINUTES="${IDLE_MINUTES:-60}"
IDLE_SHUTDOWN="${IDLE_SHUTDOWN:-on}"

SKIP_DRIVER=0
SKIP_MODEL_DOWNLOAD=0
SKIP_FIREWALL=0

LLM_HOME=/opt/llm
VENV="$LLM_HOME/venv"
HF_CACHE="$LLM_HOME/hf-cache"
STATE_DIR=/var/lib/llm-vm
CONF_DIR=/etc/llm-vm
SERVICE_USER=llm
RAW_BASE="${RAW_BASE:-https://raw.githubusercontent.com/yaluft/3JSxWin/main/gpu-vm}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# ----------------------------------------------------------------- helpers ---

log()  { printf '\033[38;5;42m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[38;5;214m warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[38;5;203m fail\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

# Fetch a companion file: prefer the copy sitting next to this script (git
# clone), fall back to the raw URL (scp'd script on its own).
fetch() {
  local rel="$1" dest="$2"
  if [[ -f "$SCRIPT_DIR/$rel" ]]; then
    install -m 0644 "$SCRIPT_DIR/$rel" "$dest"
  else
    log "fetching $rel from $RAW_BASE"
    curl -fsSL "$RAW_BASE/$rel" -o "$dest" || die "could not fetch $rel"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model)            MODEL="$2"; shift 2 ;;
    --served-name)      SERVED_NAME="$2"; shift 2 ;;
    --web-port)         WEB_PORT="$2"; shift 2 ;;
    --api-port)         API_PORT="$2"; shift 2 ;;
    --max-model-len)    MAX_MODEL_LEN="$2"; shift 2 ;;
    --gpu-mem-util)     GPU_MEM_UTIL="$2"; shift 2 ;;
    --tensor-parallel)  TENSOR_PARALLEL="$2"; shift 2 ;;
    --hf-token)         HF_TOKEN="$2"; shift 2 ;;
    --max-hours)        MAX_LIFETIME_HOURS="$2"; shift 2 ;;
    --idle-minutes)     IDLE_MINUTES="$2"; shift 2 ;;
    --no-idle-shutdown) IDLE_SHUTDOWN=off; shift ;;
    --skip-driver)      SKIP_DRIVER=1; shift ;;
    --skip-download)    SKIP_MODEL_DOWNLOAD=1; shift ;;
    --skip-firewall)    SKIP_FIREWALL=1; shift ;;
    -h|--help)          usage ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "run with sudo"
[[ -r /etc/debian_version ]] || die "this script targets Debian"

SERVED_NAME="${SERVED_NAME:-${MODEL##*/}}"
. /etc/os-release
CODENAME="${VERSION_CODENAME:-bookworm}"

# NVIDIA publishes CUDA repos per Debian release; debian12 and debian13 both exist.
case "$CODENAME" in
  bookworm) CUDA_REPO=debian12 ;;   # Debian 12, python 3.11
  trixie)   CUDA_REPO=debian13 ;;   # Debian 13, python 3.13
  *) warn "untested Debian release '$CODENAME' — falling back to the debian12 CUDA repo"
     CUDA_REPO=debian12 ;;
esac
log "Debian $CODENAME (${VERSION_ID:-?}) → NVIDIA repo $CUDA_REPO"

mkdir -p "$STATE_DIR" "$CONF_DIR"

# The 50-hour budget counts from the first run of this script, not from uptime,
# so the driver reboot doesn't hand you a fresh allowance.
if [[ ! -f "$STATE_DIR/provisioned-at" ]]; then
  date +%s > "$STATE_DIR/provisioned-at"
fi

# ------------------------------------------------------------ 1. base pkgs ---

log "installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl gnupg jq git build-essential dkms pkg-config \
  python3 python3-venv python3-dev python3-pip \
  nginx apache2-utils ufw tmux htop lsof

# --------------------------------------------------------------- 2. driver ---

have_gpu() { command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; }

if [[ $SKIP_DRIVER -eq 1 ]]; then
  log "skipping driver install (--skip-driver)"
elif have_gpu; then
  log "NVIDIA driver already working:"
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | sed 's/^/    /'
elif [[ -f "$STATE_DIR/driver-installed" ]]; then
  die "driver was installed but nvidia-smi still fails — reboot, then re-run this script"
else
  log "installing NVIDIA driver + CUDA userspace from the NVIDIA $CUDA_REPO repo"
  apt-get install -y -qq --no-install-recommends "linux-headers-$(uname -r)" || \
    warn "no headers for $(uname -r); DKMS may fail — reboot into the newest kernel and re-run"

  keyring=/tmp/cuda-keyring.deb
  curl -fsSL -o "$keyring" \
    "https://developer.download.nvidia.com/compute/cuda/repos/$CUDA_REPO/x86_64/cuda-keyring_1.1-1_all.deb" \
    || die "could not download the CUDA keyring for $CUDA_REPO"
  dpkg -i "$keyring" >/dev/null
  rm -f "$keyring"

  apt-get update -qq
  apt-get install -y -qq cuda-drivers

  touch "$STATE_DIR/driver-installed"
  cat <<EOF

  ┌───────────────────────────────────────────────────────────────┐
  │  Driver installed. Reboot, then run this exact command again. │
  │                                                               │
  │      sudo reboot                                              │
  │      sudo $0 ${*:-}
  │                                                               │
  │  Everything after this point is skipped until nvidia-smi      │
  │  reports a GPU. The 50h budget already started ticking.       │
  └───────────────────────────────────────────────────────────────┘

EOF
  exit 0
fi

if have_gpu; then
  GPU_COUNT="$(nvidia-smi -L | wc -l)"
else
  GPU_COUNT=0
  warn "no GPU visible — vLLM will fail to start until one is"
fi

if [[ "$TENSOR_PARALLEL" == "auto" ]]; then
  TENSOR_PARALLEL="$(( GPU_COUNT > 0 ? GPU_COUNT : 1 ))"
fi

# ------------------------------------------------------- 3. user + python ----

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "creating service user $SERVICE_USER"
  useradd --system --create-home --home-dir "$LLM_HOME" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
mkdir -p "$LLM_HOME" "$HF_CACHE" "$LLM_HOME/web"
chown -R "$SERVICE_USER:$SERVICE_USER" "$LLM_HOME"

PYVER="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
log "system python is $PYVER"

if [[ ! -x "$VENV/bin/python" ]]; then
  log "creating venv at $VENV"
  python3 -m venv "$VENV"
fi

install_stack() {
  "$VENV/bin/pip" install --quiet --upgrade pip wheel
  # vLLM pins its own torch build — do not install torch separately.
  "$VENV/bin/pip" install --quiet vllm "huggingface_hub[cli,hf_transfer]" transformers accelerate
}

log "installing vLLM + Hugging Face tooling (this is the slow part, ~5-10 min)"
if ! install_stack; then
  # Debian 13 ships python 3.13 and testing ships 3.14. vLLM's abi3 wheels cover
  # 3.13, but a dependency without a wheel for a very new interpreter can still
  # sink the install — in that case rebuild the venv on a uv-managed 3.12.
  warn "install failed on python $PYVER — retrying on a uv-managed python 3.12"
  curl -fsSL https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh >/dev/null
  rm -rf "$VENV"
  /usr/local/bin/uv python install 3.12
  /usr/local/bin/uv venv --python 3.12 "$VENV"
  install_stack || die "vLLM install failed on 3.12 as well — see the pip output above"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$VENV"

# ----------------------------------------------------------- 4. HF secrets ---

log "writing $CONF_DIR/server.env"
cat > "$CONF_DIR/server.env" <<EOF
# Model server config. Edit, then: sudo systemctl restart vllm
MODEL=$MODEL
SERVED_NAME=$SERVED_NAME
API_PORT=$API_PORT
MAX_MODEL_LEN=$MAX_MODEL_LEN
GPU_MEM_UTIL=$GPU_MEM_UTIL
TENSOR_PARALLEL=$TENSOR_PARALLEL
HF_HOME=$HF_CACHE
HF_HUB_ENABLE_HF_TRANSFER=1
EOF
if [[ -n "$HF_TOKEN" ]]; then
  echo "HF_TOKEN=$HF_TOKEN" >> "$CONF_DIR/server.env"
fi
chmod 0640 "$CONF_DIR/server.env"
chown root:"$SERVICE_USER" "$CONF_DIR/server.env"

# --------------------------------------------------------- 5. model weights --

if [[ $SKIP_MODEL_DOWNLOAD -eq 0 ]]; then
  log "downloading $MODEL into $HF_CACHE"
  if ! sudo -u "$SERVICE_USER" env \
        HF_HOME="$HF_CACHE" \
        HF_HUB_ENABLE_HF_TRANSFER=1 \
        ${HF_TOKEN:+HF_TOKEN="$HF_TOKEN"} \
        "$VENV/bin/hf" download "$MODEL" >/dev/null; then
    warn "download failed — gated repo without a token, or a typo in the model id."
    warn "fix it and re-run, or: sudo -u $SERVICE_USER HF_HOME=$HF_CACHE $VENV/bin/hf download $MODEL"
  fi
fi

# ------------------------------------------------------------ 6. vllm unit ---

log "installing vllm.service"
cat > /etc/systemd/system/vllm.service <<EOF
[Unit]
Description=vLLM OpenAI-compatible server ($MODEL)
After=network-online.target
Wants=network-online.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=$CONF_DIR/server.env
WorkingDirectory=$LLM_HOME
ExecStart=$VENV/bin/vllm serve \${MODEL} \\
  --served-model-name \${SERVED_NAME} \\
  --host 127.0.0.1 \\
  --port \${API_PORT} \\
  --max-model-len \${MAX_MODEL_LEN} \\
  --gpu-memory-utilization \${GPU_MEM_UTIL} \\
  --tensor-parallel-size \${TENSOR_PARALLEL}
Restart=on-failure
RestartSec=10
# Weights load slowly on a cold cache; don't let systemd give up early.
TimeoutStartSec=1800
KillSignal=SIGINT
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$LLM_HOME

[Install]
WantedBy=multi-user.target
EOF

# ------------------------------------------------------------- 7. web + ui ---

log "installing chat UI and nginx site on :$WEB_PORT"
fetch web/index.html "$LLM_HOME/web/index.html"
chown -R "$SERVICE_USER:$SERVICE_USER" "$LLM_HOME/web"
chmod -R a+rX "$LLM_HOME/web"

AUTH_BLOCK=""
if [[ -n "$CHAT_USER" && -n "$CHAT_PASSWORD" ]]; then
  htpasswd -bc "$CONF_DIR/htpasswd" "$CHAT_USER" "$CHAT_PASSWORD" >/dev/null 2>&1
  chmod 0640 "$CONF_DIR/htpasswd"
  chown root:www-data "$CONF_DIR/htpasswd"
  AUTH_BLOCK="auth_basic \"llm\"; auth_basic_user_file $CONF_DIR/htpasswd;"
  log "basic auth enabled for user '$CHAT_USER'"
else
  warn "no CHAT_USER/CHAT_PASSWORD set — :$WEB_PORT is open to anyone who can reach it"
fi

rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/sites-available/llm <<EOF
server {
    listen $WEB_PORT default_server;
    listen [::]:$WEB_PORT default_server;
    server_name _;

    # The lifeguard reads this log's mtime to decide whether the box is idle.
    access_log /var/log/nginx/llm-access.log;

    $AUTH_BLOCK

    root $LLM_HOME/web;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /v1/ {
        proxy_pass http://127.0.0.1:$API_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection "";
        # Token streaming: no buffering, long timeouts.
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        chunked_transfer_encoding on;
    }

    location /health {
        proxy_pass http://127.0.0.1:$API_PORT/health;
        auth_basic off;
        access_log off;
    }
}
EOF
ln -sf /etc/nginx/sites-available/llm /etc/nginx/sites-enabled/llm
nginx -t >/dev/null || die "nginx config test failed"

# ----------------------------------------------------------- 8. cli clients --

log "installing llm-chat and llm-vm"
fetch bin/llm-chat      /usr/local/bin/llm-chat
fetch bin/llm-vm        /usr/local/bin/llm-vm
fetch bin/llm-lifeguard /usr/local/bin/llm-lifeguard
chmod 0755 /usr/local/bin/llm-chat /usr/local/bin/llm-vm /usr/local/bin/llm-lifeguard

cat > "$CONF_DIR/client.env" <<EOF
LLM_API_BASE=http://127.0.0.1:$API_PORT/v1
LLM_MODEL=$SERVED_NAME
EOF
chmod 0644 "$CONF_DIR/client.env"

# ---------------------------------------------------------- 9. lifeguard -----

log "arming the lifeguard: ${MAX_LIFETIME_HOURS}h cap, ${IDLE_MINUTES}min idle shutdown (${IDLE_SHUTDOWN})"
cat > "$CONF_DIR/lifeguard.env" <<EOF
# Cost guards. Edit, then: sudo systemctl restart llm-lifeguard.timer
#
# Hard cap measured from $STATE_DIR/provisioned-at (first setup run), so
# reboots do not reset it. Set to 0 to disable the cap.
MAX_LIFETIME_HOURS=$MAX_LIFETIME_HOURS

# Idle shutdown: on | off. "Activity" = an HTTP request through nginx, a
# logged-in SSH/tty session, a running llm-chat, or GPU utilization above
# IDLE_GPU_PERCENT.
IDLE_SHUTDOWN=$IDLE_SHUTDOWN
IDLE_MINUTES=$IDLE_MINUTES
IDLE_GPU_PERCENT=5

# What to do when a limit is hit: poweroff, or run SHUTDOWN_HOOK instead.
# NOTE: OVH Public Cloud keeps billing a *stopped* instance. To stop the
# meter you must delete it — put an OVH API call in a hook script and point
# SHUTDOWN_HOOK at it. See gpu-vm/README.md.
SHUTDOWN_ACTION=poweroff
SHUTDOWN_HOOK=
# Minutes of "wall" warning before pulling the plug.
WARN_MINUTES=5
EOF
chmod 0644 "$CONF_DIR/lifeguard.env"

cat > /etc/systemd/system/llm-lifeguard.service <<EOF
[Unit]
Description=Power off the GPU VM when idle or past its lifetime budget

[Service]
Type=oneshot
EnvironmentFile=$CONF_DIR/lifeguard.env
ExecStart=/usr/local/bin/llm-lifeguard check
EOF

cat > /etc/systemd/system/llm-lifeguard.timer <<'EOF'
[Unit]
Description=Run the GPU VM lifeguard every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=15s

[Install]
WantedBy=timers.target
EOF

# --------------------------------------------------------- 10. firewall -----

if [[ $SKIP_FIREWALL -eq 0 ]]; then
  log "configuring ufw (ssh + $WEB_PORT)"
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow 22/tcp >/dev/null            # allow SSH *before* enabling
  ufw allow "$WEB_PORT"/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# ------------------------------------------------------------ 11. start up ---

log "starting services"
systemctl daemon-reload
systemctl enable --now llm-lifeguard.timer >/dev/null
systemctl restart nginx
systemctl enable vllm >/dev/null
systemctl restart vllm

log "waiting for the model to load (first boot can take a few minutes)"
ready=0
for _ in $(seq 1 180); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then ready=1; break; fi
  if ! systemctl is-active --quiet vllm; then
    warn "vllm.service died — journalctl -u vllm -n 50"
    break
  fi
  sleep 5
done

IP="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DEADLINE="$(date -d "@$(( $(cat "$STATE_DIR/provisioned-at") + MAX_LIFETIME_HOURS * 3600 ))" '+%Y-%m-%d %H:%M %Z' 2>/dev/null || echo unknown)"

cat <<EOF

  ─────────────────────────────────────────────────────────────────
  $( [[ $ready -eq 1 ]] && echo "ready" || echo "set up, but the model server is not answering yet" )

  model        $MODEL  (served as "$SERVED_NAME")
  gpus         $GPU_COUNT, tensor-parallel $TENSOR_PARALLEL
  chat ui      http://${IP:-<vm-ip>}:$WEB_PORT
  api          http://${IP:-<vm-ip>}:$WEB_PORT/v1   (OpenAI-compatible)
  terminal     llm-chat
  logs         journalctl -u vllm -f

  auto-off     idle ${IDLE_MINUTES}min ($IDLE_SHUTDOWN) · hard cap ${MAX_LIFETIME_HOURS}h → $DEADLINE
  controls     llm-vm status · llm-vm hold 2h · llm-vm idle off · llm-vm extend 4h

  OVH still bills a stopped instance — delete it to stop the meter.
  ─────────────────────────────────────────────────────────────────

EOF
