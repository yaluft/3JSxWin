# gpu-ai-stack

One container image for an OVHcloud AI Deploy GPU app: an open-weights model,
image generation, and two terminal coding agents behind a single HTTP port.

```bash
docker login && ovhai login
cd gpu-ai-stack
DOCKER_USER=yourname MODELS="qwen3:8b" ./aideploy/deploy.sh
```

## What runs inside

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

That last line is load-bearing. ComfyUI's frontend requests absolute paths
(`/api/...`, `/view`, `/assets/...`, `/ws`) and
[does not support a path prefix](https://github.com/Comfy-Org/ComfyUI/issues/14455),
so proxying it only at `/comfy/` breaks thumbnails and much of its API.
Reserving the routes above and letting everything else fall through to ComfyUI
puts those absolute paths where they belong.

## Build

The image is `linux/amd64` — OVH runs nothing else — and about 20 GB unpacked,
so give it 25–35 minutes on a first build, nearly all of it download.

```bash
DOCKER_USER=yourname BUILD_ONLY=1 ./aideploy/deploy.sh   # build + push, start nothing
```

On Windows, build from inside WSL and clone into the WSL filesystem rather than
`/mnt/c` — crossing the 9p boundary is several times slower on a context this
size. No GPU is needed to build.

`INSTALL_BOB=0` or `INSTALL_CLAUDE=0` leaves an agent out. If your Docker Hub
repo is private, add it to AI Deploy as an authorised registry first or OVH
can't pull it.

## The agents

Both authenticate at runtime, in the terminal. **No credential is baked into the
image:**

```bash
# open https://<app>.../term?key=<api key>, log in as dev / <terminal password>
claude          # then /login — uses your Claude Pro subscription
bob             # then follow the IBM login prompt
```

Worth being precise: **a Claude Pro subscription covers the Claude Code CLI, not
raw API access.** Claude is therefore the terminal agent and is deliberately not
wired into the web chat UI as a model provider — that path would call the
Anthropic API and need separate credits. The chat UI talks to local Ollama models
only.

IBM Bob installs from IBM's public installer but is an entitled product, so
signing in needs your IBM account.

## Cost guards

An AI Deploy app bills per minute for as long as it runs, and **nothing stops it
on its own.**

```bash
./aideploy/ovhai-guard.sh install <app-id>     # cron, every 2 min
./aideploy/ovhai-guard.sh status  <app-id>
```

It calls `ovhai app stop` after 50h of accumulated runtime or 60 min with no
requests. Idleness comes from the container's own `/healthz`, which reports 0
while anything is still streaming — a long generation or a running ComfyUI job
counts as busy, a parked browser tab does not. Tune with `MAX_RUNTIME_HOURS=24
IDLE_MINUTES=30`.

The cron only runs while your machine is awake. For an unattended budget, put the
guard on an always-on box.

## Keeping state

The container is ephemeral: without a volume every restart re-pulls models and
loses agent logins.

```bash
VOLUME="my-container@GRA/workspace:/workspace:rw:cache" \
  DOCKER_USER=yourname ./aideploy/deploy.sh
```

`/workspace` holds Ollama models, ComfyUI output, and `~/.claude` / `~/.bob`.

## Security

- `APP_API_KEY` gates `/v1`, `/ollama`, `/comfy` and `/term`. Browser navigations
  can't send a header, so the router also accepts `?key=` or an `app_key` cookie;
  the chat UI sets both once you paste the key into settings.
- The terminal is a **root shell in the container**. It stays off entirely unless
  `TERMINAL_PASSWORD` is set, and ttyd requires basic auth on top of the app key.
- The app URL is reachable from the internet. Don't run it without a key.
- The image runs as UID `42420` with `/workspace` as home, which is what AI Deploy
  requires — changing that breaks writes to the model cache.

---

A plain-Debian VM variant of the same stack (vLLM + systemd + nginx, with
`poweroff`-based guards instead of `ovhai app stop`) lives on the
`claude/ovh-gpu-vm-setup-56zn0d` branch under `gpu-vm/`.
