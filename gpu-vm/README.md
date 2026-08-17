# GPU + Hugging Face chat setup

Two ways to run an open-weights model on OVHcloud with a browser chat UI and a
terminal client. Same model server (vLLM, OpenAI-compatible API), same UI, same
two cost guards: **stop after 50 hours** and **stop after 1 hour idle**.

| | AI Deploy | GPU VM (Debian) |
| --- | --- | --- |
| What it is | a container OVH runs for you | an instance you own root on |
| Billing | per minute while the app runs | per hour while the instance exists |
| Quota needed | AI Deploy GPU quota | Public Cloud vCPU/**RAM** quota |
| Guard | `ovhai app stop` from a cron on your machine | `poweroff` from a timer on the VM |
| Use it when | you have AI Deploy credit — start here | you want SSH, persistence, other services |

---

## A. AI Deploy

Billed per minute of running app, so the discipline is: start it, use it, stop it.

```bash
ovhai login
ovhai registry list                 # copy the shared registry address
docker login <registry-address>     # credentials from that same output

cd gpu-vm
REGISTRY=<registry-address> HF_TOKEN=hf_xxx MODEL=Qwen/Qwen3-8B FLAVOR=l4-1-gpu \
  ./aideploy/deploy.sh
```

`deploy.sh` builds [`aideploy/Dockerfile`](aideploy/Dockerfile), pushes it, and
starts the app. It prints an API key and the app URL — open the URL for the chat
UI, paste the key into **settings**.

The container ([`aideploy/serve.py`](aideploy/serve.py)) runs vLLM on loopback and
fronts it with one public port, because AI Deploy exposes exactly one:

```
GET /          chat UI
    /v1/...    OpenAI-compatible API (bearer token = the printed key)
    /health    readiness — 200 once weights are loaded
    /metrics   vLLM Prometheus counters (the guard reads these)
```

The image runs as UID `42420` with `/workspace` as its home, which is what AI
Deploy requires — don't change that or the HF download fails on a read-only home.

**Arm the guard.** Nothing stops an AI Deploy app on its own:

```bash
./aideploy/ovhai-guard.sh install <app-id>     # cron, every 2 min
./aideploy/ovhai-guard.sh status  <app-id>
```

It stops the app after 50h of accumulated runtime or 60 min with no completed
inference request (from `vllm:request_success_total` and the queue depth — a long
generation counts as busy, an open browser tab doesn't). Both are env-tunable:
`MAX_RUNTIME_HOURS=24 IDLE_MINUTES=30 ./aideploy/ovhai-guard.sh install <app-id>`.

Caveat worth knowing: the cron only runs while your machine is awake. If you close
the laptop with the app running, nothing stops it. For an unattended budget, put
the guard on any always-on box.

**Weights re-download on every start** unless you mount object storage for the
cache:

```bash
VOLUME="my-container@GRA/hf-cache:/workspace/hf-cache:rw:cache" ./aideploy/deploy.sh
```

**Budget.** At the time of writing, roughly: a single-L4 flavor runs on the order
of ~€1/h and a single-H100 several times that — check
[the AI pricing page](https://www.ovhcloud.com/en/public-cloud/prices/) for the
current rate, then `credit ÷ rate = hours`. A €270 trial credit is comfortable for
50h on an L4-class flavor and tight on H100. The 50h cap exists so a forgotten app
can't quietly drain it; lower it with `MAX_RUNTIME_HOURS` if the flavor is pricier.

---

## B. GPU VM on Debian

One script, run as root on a fresh Debian 12 or 13 GPU instance:

```bash
git clone https://github.com/yaluft/3JSxWin && cd 3JSxWin/gpu-vm
sudo HF_TOKEN=hf_xxx ./setup-debian-gpu.sh --model Qwen/Qwen3-8B
```

It installs the NVIDIA driver, then **tells you to reboot and re-run the same
command** — the second pass does the rest and starts everything:

- `vllm.service` — model server on `127.0.0.1:8000`
- `nginx` on `:8080` — UI at `/`, API proxied at `/v1` (SSE buffering off)
- `llm-chat` — terminal client, stdlib-only, works with the system python
- `llm-lifeguard.timer` — the auto-shutdown, every minute
- `ufw` — SSH plus the web port, nothing else

Debian 13 (trixie) is handled: NVIDIA publishes a `debian13` CUDA repo and current
vLLM ships abi3 wheels that run on python 3.13. If a dependency ever has no wheel
for the system interpreter, the script rebuilds the venv on a uv-managed 3.12 and
carries on.

Useful flags: `--skip-driver` (image already has CUDA), `--max-model-len`,
`--tensor-parallel`, `--web-port`, `--max-hours`, `--idle-minutes`,
`--no-idle-shutdown`. Set `CHAT_USER` and `CHAT_PASSWORD` to put basic auth on the
web port — without them, anything that can reach `:8080` can use the model.

### Day-to-day

```bash
llm-chat                       # interactive; /system /model /retry /save /quit
llm-chat "explain this trace"  # one-shot
journalctl -u vllm -f          # or: llm-vm logs -f

llm-vm status                  # services, GPU, time left before shutdown
llm-vm hold 2h                 # suppress the idle shutdown while you work
llm-vm extend 4h               # push the 50h cap out
llm-vm idle off | idle 30m     # change or disable idle shutdown
llm-vm cap 24h | cap off       # change or disable the hard cap
llm-vm model mistralai/Mistral-7B-Instruct-v0.3
llm-vm off                     # stop now
```

### How the shutdown decides

`llm-lifeguard` runs every minute and treats the box as **active** if any of:
a manual hold, a logged-in SSH/tty session, a running `llm-chat`, an HTTP request
through nginx in the last minute, or GPU utilization above 5%. Otherwise the idle
clock runs, with a `wall` warning 5 minutes out.

The 50h cap counts from `/var/lib/llm-vm/provisioned-at`, written on the first
setup run — the driver reboot doesn't hand you a fresh allowance. Config lives in
`/etc/llm-vm/lifeguard.env`.

> **OVH keeps billing a stopped Public Cloud instance.** Powering off protects you
> from a runaway GPU-hour bill only if the flavor's cost is in the compute; to stop
> the meter completely you must delete the instance. Point `SHUTDOWN_HOOK` in
> `lifeguard.env` at a script that calls the OVH API to delete it, and set
> `SHUTDOWN_ACTION=hook`.

---

## The `ram quota 44000 reached` error

That's a Public Cloud **project quota**, not a capacity or billing problem: the
project is capped at 44000 MB of instance RAM in that region, and every OVH GPU
flavor asks for more than that — the smallest V100 flavors (`t1-45`, `t2-45`) are
45 GB, L4 is 90 GB, A100 is 180 GB, H100 is 380 GB. So no GPU instance fits under
a 44 GB cap, and picking a smaller GPU won't get around it.

1. **Control Panel → Public Cloud → project → Settings → Quota & Regions**, check
   the region you're deploying to (quotas are per region), and free RAM by deleting
   instances you no longer need — a *stopped* instance still counts against quota.
2. Hit **"Increase your quota!"** there. Manual increases are validated against
   prepaid Public Cloud credit; if the button isn't offered, it routes you to a
   support ticket, which is handled by hand and can take a while.
3. Auto-scaling quota exists but only reacts after 30 days above 60% usage — no
   help today.

If you're going the AI Deploy route instead, this quota is irrelevant: AI Deploy
has its own GPU quota and doesn't consume instance RAM.

## Sources

- [Increasing Public Cloud quotas](https://docs.ovhcloud.com/en/guides/public-cloud/cross-functional/increasing-public-cloud-quota)
- [AI Deploy — getting started](https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-deploy-getting-started)
- [Serving LLMs with vLLM and AI Deploy](https://blog.ovhcloud.com/en/posts/how-to-serve-llms-with-vllm-and-ovhcloud-ai-deploy/)
- [AI Deploy billing and lifecycle](https://help.ovhcloud.com/csm/en-public-cloud-ai-deploy-billing?id=kb_article_view&sysparm_article=KB0057059)
