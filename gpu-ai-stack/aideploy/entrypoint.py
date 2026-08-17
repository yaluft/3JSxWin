#!/usr/bin/env python3
"""Container entrypoint: start every service, then supervise them.

AI Deploy runs one container and forbids docker-compose, so this process is the
supervisor. It starts, in order:

  ollama serve   127.0.0.1:11434   model inference
  ComfyUI        127.0.0.1:8188    image generation
  ttyd           127.0.0.1:7681    browser terminal (claude, bob)
  router.py      0.0.0.0:$PORT     the single public port

If any of them dies, this exits so AI Deploy restarts the app rather than
leaving a half-working container serving 502s.

Environment:
  OLLAMA_MODELS_PRELOAD   space-separated models to pull on boot (e.g. "qwen3:8b")
  OLLAMA_KEEP_ALIVE       how long a model stays resident (default 10m)
  APP_API_KEY             required as a bearer token / ?key= on every route
  TERMINAL_PASSWORD       ttyd basic-auth password (user: dev); disables the
                          terminal entirely when unset
  PORT                    public port (default 8080)
"""
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

WORKSPACE = os.environ.get("HOME", "/workspace")
PORT = os.environ.get("PORT", "8080")
HERE = os.path.dirname(os.path.abspath(__file__))

procs: dict[str, subprocess.Popen] = {}


def log(msg):
    print(f"[entrypoint] {msg}", flush=True)


def spawn(name, cmd, env=None, cwd=None):
    log(f"starting {name}: {' '.join(cmd)}")
    merged = {**os.environ, **(env or {})}
    procs[name] = subprocess.Popen(cmd, env=merged, cwd=cwd)
    return procs[name]


def wait_for(url, name, timeout=300):
    """Block until an HTTP endpoint answers, or give up and say so."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=3)
            log(f"{name} is up")
            return True
        except urllib.error.HTTPError:
            log(f"{name} is up")          # any HTTP answer means it's listening
            return True
        except Exception:
            if any(p.poll() is not None for p in procs.values()):
                return False
            time.sleep(2)
    log(f"WARNING: {name} did not come up within {timeout}s")
    return False


def gpu_summary():
    if not shutil.which("nvidia-smi"):
        return "no nvidia-smi — running on CPU, generation will be very slow"
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=20, check=True,
        ).stdout.strip()
        return out or "nvidia-smi returned nothing"
    except Exception as err:
        return f"nvidia-smi failed: {err}"


def preload_models():
    models = os.environ.get("OLLAMA_MODELS_PRELOAD", "").split()
    for model in models:
        log(f"pulling {model} (first boot on a fresh volume downloads weights)")
        rc = subprocess.call(["ollama", "pull", model])
        if rc != 0:
            log(f"WARNING: `ollama pull {model}` failed with {rc}")


def start_terminal():
    """ttyd, if a password is set. No password, no terminal — it's a root shell."""
    password = os.environ.get("TERMINAL_PASSWORD", "")
    if not password:
        log("TERMINAL_PASSWORD unset — terminal disabled (/term will 502)")
        return
    if not shutil.which("ttyd"):
        log("ttyd not installed — terminal disabled")
        return
    spawn("ttyd", [
        "ttyd",
        "--port", "7681",
        "--interface", "127.0.0.1",
        "--credential", f"dev:{password}",
        "--writable",
        "bash", "-l",
    ])


def shutdown(signum=None, _frame=None):
    log(f"shutting down (signal {signum})")
    for name, proc in procs.items():
        if proc.poll() is None:
            log(f"stopping {name}")
            proc.terminate()
    deadline = time.time() + 20
    for name, proc in procs.items():
        remaining = max(0, deadline - time.time())
        try:
            proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            log(f"killing {name}")
            proc.kill()
    sys.exit(0)


def main():
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    log(f"workspace {WORKSPACE}, uid {os.getuid()}:{os.getgid()}")
    log(f"gpu: {gpu_summary()}")

    os.makedirs(os.path.join(WORKSPACE, "ollama"), exist_ok=True)
    os.makedirs(os.path.join(WORKSPACE, "comfy", "output"), exist_ok=True)

    spawn("ollama", ["ollama", "serve"], env={
        "OLLAMA_HOST": "127.0.0.1:11434",
        "OLLAMA_MODELS": os.path.join(WORKSPACE, "ollama"),
        "OLLAMA_KEEP_ALIVE": os.environ.get("OLLAMA_KEEP_ALIVE", "10m"),
    })
    if not wait_for("http://127.0.0.1:11434/api/tags", "ollama", timeout=120):
        log("ollama never came up")
        shutdown()
    preload_models()

    comfy_dir = "/opt/ComfyUI"
    if os.path.isdir(comfy_dir):
        spawn("comfyui", [
            sys.executable, "main.py",
            "--listen", "127.0.0.1",
            "--port", "8188",
            "--output-directory", os.path.join(WORKSPACE, "comfy", "output"),
        ], cwd=comfy_dir)
    else:
        log("ComfyUI not present in the image — skipping")

    start_terminal()

    spawn("router", [sys.executable, os.path.join(HERE, "router.py")])
    log(f"router listening on :{PORT} — this is the app's public port")

    # Supervise: if anything exits, take the whole container down so AI Deploy
    # restarts it cleanly instead of serving a half-dead app.
    while True:
        time.sleep(5)
        for name, proc in list(procs.items()):
            code = proc.poll()
            if code is not None:
                log(f"{name} exited with {code} — bringing the container down")
                shutdown()


if __name__ == "__main__":
    main()
