# GPU AI app: Ollama + ComfyUI + terminal agents

A container that runs an open-weights model, image generation, and two terminal
coding agents on an OVHcloud GPU — plus the same setup as a plain Debian VM if
you ever get instance quota.

Both paths carry the same two cost guards: **stop after 50 hours** and **stop
after 1 hour idle**.

| | AI Deploy container | GPU VM (Debian) |
| --- | --- | --- |
| What it is | one image OVH runs for you | an instance you own root on |
| Billing | per minute while the app runs | per hour while the instance exists |
| Quota | AI Deploy GPU quota | Public Cloud vCPU/**RAM** quota |
| Guard | `ovhai app stop` from cron | `poweroff` from a timer on the VM |
| Start here if | you have AI Deploy credit | you need SSH and persistence |

---

## A. The container

One image, one public port, everything inside it:

| | | |
| --- | --- | --- |
| **Ollama** | `127.0.0.1:11434` | model inference, OpenAI-compatible |
| **ComfyUI** | `127.0.0.1:8188` | image generation |
| **ttyd** | `127.0.0.1:7681` | browser terminal — where `claude` and `bob` live |
| **router** | `0.0.0.0:8080` | the single public port |

AI Deploy gives an app exactly one HTTP port and forbids docker-compose, so
[`entrypoint.py`](aideploy/entrypoint.py) supervises all four processes and
[`router.py`](aideploy/router.py) fans requests out:

```text
GET /                chat UI
    /comfy           ComfyUI
    /term            browser terminal (ttyd)
    /v1/...          OpenAI-compatible API — point any client at it
    /ollama/...      Ollama's native API
    /healthz         status + idle seconds (what the guard reads)
    everything else  ComfyUI
```

That last line is the load-bearing one. ComfyUI's frontend requests absolute
paths (`/api/...`, `/view`, `/assets/...`, `/ws`) and
[does not support running under a path prefix](https://github.com/Comfy-Org/ComfyUI/issues/14455) —
proxying it at `/comfy/` alone breaks thumbnails and much of its API. Reserving
only the routes above and letting everything else fall through to ComfyUI means
those absolute paths land where they should.

### Build and deploy

```bash
docker login                  # Docker Hub
ovhai login                   # OVHcloud AI CLI

cd gpu-vm
DOCKER_USER=yourname MODELS="qwen3:8b" ./aideploy/deploy.sh
```

`deploy.sh` builds for `linux/amd64`, pushes to Docker Hub, and starts the app.
It prints an API key and a terminal password — both generated unless you pass
`APP_API_KEY` / `TERMINAL_PASSWORD`.

If your Docker Hub repo is **private**, add it to AI Deploy as an authorised
registry first, or OVH cannot pull it. Public repos need nothing.

`BUILD_ONLY=1` builds and pushes without starting an app, which is what you want
if you just wanted the image in the store.

### The agents

Both authenticate at runtime, in the terminal. **No credential is baked into the
image** — that's why they're not configured at build time:

```bash
# open https://<app>.../term?key=<api key>, log in as dev / <terminal password>
claude          # then /login — uses your Claude Pro subscription
bob             # then follow the IBM login prompt
```

Worth being precise about the Pro question: **a Claude Pro subscription covers
the Claude Code CLI, not raw API access.** So Claude is available as the terminal
agent, and is deliberately *not* wired into the web chat UI as a model provider —
that path calls the Anthropic API and needs separate API credits. The chat UI
talks to your local Ollama models only.

IBM Bob installs from IBM's public installer (`bob.ibm.com/download/bobshell.sh`,
Node 22+) but is an entitled product, so signing in needs your IBM account. Build
with `INSTALL_BOB=0` to leave it out, `INSTALL_CLAUDE=0` likewise.

### Keeping state

The container is ephemeral: without a volume, every restart re-pulls models and
loses agent logins. Mount object storage to keep them:

```bash
VOLUME="my-container@GRA/workspace:/workspace:rw:cache" \
  DOCKER_USER=yourname ./aideploy/deploy.sh
```

`/workspace` holds the Ollama models, ComfyUI output, and `~/.claude` / `~/.bob`.

### Arm the guard

Nothing stops an AI Deploy app on its own, and it bills per minute:

```bash
./aideploy/ovhai-guard.sh install <app-id>     # cron, every 2 min
./aideploy/ovhai-guard.sh status  <app-id>
```

It calls `ovhai app stop` after 50h of accumulated runtime or 60 min with no
request. Idleness comes from the container's own `/healthz`, which reports 0
while anything is still streaming — so a long generation or an open ComfyUI job
counts as busy, and a parked browser tab does not. Tune with
`MAX_RUNTIME_HOURS=24 IDLE_MINUTES=30`.

The cron only runs while your machine is awake. For an unattended budget, put the
guard on any always-on box.

### Security

- `APP_API_KEY` gates `/v1`, `/ollama`, `/comfy` and `/term`. Browser navigations
  can't send a header, so the router also accepts `?key=` or an `app_key` cookie;
  the chat UI sets both once you paste the key into its settings panel.
- The terminal is a **root shell in the container**. It stays off entirely unless
  `TERMINAL_PASSWORD` is set, and ttyd requires basic auth on top of the app key.
- The app URL is reachable from the internet. Don't run it without a key.

---

## B. GPU VM on Debian

One script, as root on a fresh Debian 12 or 13 GPU instance:

```bash
git clone https://github.com/yaluft/3JSxWin && cd 3JSxWin/gpu-vm
sudo HF_TOKEN=hf_xxx ./setup-debian-gpu.sh --model Qwen/Qwen3-8B
```

It installs the NVIDIA driver, then **tells you to reboot and re-run the same
command** — the second pass does the rest:

- `vllm.service` — model server on `127.0.0.1:8000`
- `nginx` on `:8080` — UI at `/`, API proxied at `/v1`
- `llm-chat` — terminal client, stdlib-only
- `llm-lifeguard.timer` — the auto-shutdown, every minute
- `ufw` — SSH plus the web port

Debian 13 is handled: NVIDIA publishes a `debian13` CUDA repo and current vLLM
ships abi3 wheels that run on python 3.13. If a dependency ever lacks a wheel for
the system interpreter, the script rebuilds the venv on a uv-managed 3.12.

```bash
llm-vm status                  # services, GPU, time left before shutdown
llm-vm hold 2h                 # suppress the idle shutdown while you work
llm-vm extend 4h               # push the 50h cap out
llm-vm idle off | idle 30m
llm-vm cap 24h | cap off
llm-vm model mistralai/Mistral-7B-Instruct-v0.3
```

`llm-lifeguard` treats the box as active on a manual hold, a logged-in session, a
running `llm-chat`, an HTTP request in the last minute, or GPU use above 5%. The
50h cap counts from `/var/lib/llm-vm/provisioned-at`, so the driver reboot
doesn't hand you a fresh allowance.

> **OVH keeps billing a stopped Public Cloud instance.** To stop the meter you
> must delete it. Point `SHUTDOWN_HOOK` in `/etc/llm-vm/lifeguard.env` at a script
> that calls the OVH API, and set `SHUTDOWN_ACTION=hook`.

---

## The `ram quota 44000 reached` error

A Public Cloud **project quota**, not a capacity or billing problem: the project
is capped at 44000 MB of instance RAM in that region, and every OVH GPU flavor
asks for more — the smallest V100 flavors (`t1-45`, `t2-45`) are 45 GB, L4 is
90 GB, A100 180 GB, H100 380 GB. No GPU instance fits under a 44 GB cap, so
picking a smaller GPU won't help.

1. **Control Panel → Public Cloud → project → Settings → Quota & Regions.**
   Quotas are per region. A *stopped* instance still counts against quota.
2. Hit **"Increase your quota!"** there. Manual increases are validated against
   prepaid credit; if the button isn't offered it routes to a support ticket,
   handled by hand.
3. Auto-scaling quota only reacts after 30 days above 60% usage — no help today.

None of this applies to AI Deploy, which has its own GPU quota and consumes no
instance RAM.

## OVH image requirements

The Dockerfile is built to satisfy these, and `deploy.sh` builds accordingly:

- **`linux/amd64` only** — `docker build --platform linux/amd64`.
- **No docker-compose** — one image, one entrypoint supervising the processes.
- **Runs as UID 42420:42420** — `/workspace`, `/opt/app` and `/opt/ComfyUI` are
  chowned to it, and `HOME=/workspace`.
- **Private registries must be authorised** in AI Deploy before OVH can pull.

## Sources

- [AI Deploy — getting started](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-deploy-getting-started)
- [AI Deploy billing and lifecycle](https://help.ovhcloud.com/csm/en-public-cloud-ai-deploy-billing?id=kb_article_view&sysparm_article=KB0057059)
- [Increasing Public Cloud quotas](https://docs.ovhcloud.com/en/guides/public-cloud/cross-functional/increasing-public-cloud-quota)
- [IBM Bob — install and setup](https://bob.ibm.com/docs/shell/getting-started/install-and-setup)
- [Claude Code — programmatic use](https://code.claude.com/docs/en/headless)
