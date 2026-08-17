#!/usr/bin/env python3
"""Container entrypoint for OVHcloud AI Deploy.

AI Deploy gives an app exactly one public HTTP port, so this starts vLLM on
loopback and puts a thin ASGI app in front of it that:

  GET  /            -> the chat UI (web/index.html, baked into the image)
  *    /v1/...      -> proxied to vLLM, streaming preserved
  GET  /health      -> 200 once the model has finished loading
  GET  /metrics     -> vLLM's Prometheus metrics (the idle guard reads these)

Config comes from env vars, which is how AI Deploy passes settings (`--env`):

  MODEL             Hugging Face repo id                (required)
  SERVED_NAME       name the API advertises             (default: repo basename)
  HF_TOKEN          for gated repos
  VLLM_API_KEY      require this bearer token on /v1    (recommended)
  MAX_MODEL_LEN     context window                      (default 8192)
  GPU_MEM_UTIL      fraction of VRAM for weights+KV     (default 0.90)
  TENSOR_PARALLEL   GPUs to shard across                (default: all visible)
  PORT              public port                         (default 8080)
"""
import asyncio
import os
import signal
import subprocess
import sys
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.routing import Route

UPSTREAM = "http://127.0.0.1:8000"
PORT = int(os.environ.get("PORT", "8080"))
WEB = Path(__file__).parent / "web" / "index.html"

# AI Deploy mounts writable storage at /workspace; HOME must live there too.
os.environ.setdefault("HF_HOME", "/workspace/hf-cache")
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")

client: httpx.AsyncClient | None = None
vllm: subprocess.Popen | None = None


def gpu_count() -> int:
    try:
        out = subprocess.run(
            ["nvidia-smi", "-L"], capture_output=True, text=True, timeout=20, check=True
        ).stdout
        return max(1, len([ln for ln in out.splitlines() if ln.strip()]))
    except Exception:
        return 1


def start_vllm() -> subprocess.Popen:
    model = os.environ.get("MODEL")
    if not model:
        sys.exit("MODEL is not set — pass --env MODEL=<hf-repo-id> to ovhai app run")

    cmd = [
        sys.executable, "-m", "vllm.entrypoints.openai.api_server",
        "--model", model,
        "--served-model-name", os.environ.get("SERVED_NAME") or model.split("/")[-1],
        "--host", "127.0.0.1",
        "--port", "8000",
        "--max-model-len", os.environ.get("MAX_MODEL_LEN", "8192"),
        "--gpu-memory-utilization", os.environ.get("GPU_MEM_UTIL", "0.90"),
        "--tensor-parallel-size", os.environ.get("TENSOR_PARALLEL") or str(gpu_count()),
    ]
    if os.environ.get("VLLM_API_KEY"):
        cmd += ["--api-key", os.environ["VLLM_API_KEY"]]

    print(f"[serve] starting: {' '.join(cmd)}", flush=True)
    return subprocess.Popen(cmd)


# ------------------------------------------------------------------ routes ---

async def ui(_request):
    if not WEB.is_file():
        return JSONResponse({"error": "chat UI missing from image"}, status_code=500)
    return FileResponse(WEB, headers={"Cache-Control": "no-store"})


async def proxy(request):
    """Pass a request through to vLLM, streaming the response body back."""
    url = UPSTREAM + request.url.path
    if request.url.query:
        url += "?" + request.url.query

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "connection")
    }

    try:
        req = client.build_request(
            request.method, url, headers=headers, content=request.stream(), timeout=None
        )
        upstream = await client.send(req, stream=True)
    except httpx.ConnectError:
        # The model is still loading — say so rather than dumping a 502.
        return JSONResponse(
            {"error": "model server is still starting, retry in a moment"}, status_code=503
        )

    passthrough = {
        k: v for k, v in upstream.headers.items()
        if k.lower() not in ("content-length", "transfer-encoding", "connection")
    }

    async def body():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(body(), status_code=upstream.status_code, headers=passthrough)


async def health(_request):
    try:
        r = await client.get(f"{UPSTREAM}/health", timeout=5)
        return Response(status_code=r.status_code)
    except Exception:
        return Response(status_code=503)


# ----------------------------------------------------------------- plumbing --

async def on_start():
    global client, vllm
    client = httpx.AsyncClient(timeout=None)
    vllm = start_vllm()
    asyncio.get_running_loop().create_task(watch_vllm())


async def watch_vllm():
    """If vLLM dies, take the container down so AI Deploy restarts it."""
    while True:
        await asyncio.sleep(5)
        if vllm and vllm.poll() is not None:
            print(f"[serve] vllm exited with {vllm.returncode} — stopping", flush=True)
            os.kill(os.getpid(), signal.SIGTERM)
            return


async def on_stop():
    if vllm and vllm.poll() is None:
        vllm.send_signal(signal.SIGINT)   # let vLLM release the GPU cleanly
        try:
            vllm.wait(timeout=30)
        except subprocess.TimeoutExpired:
            vllm.kill()
    if client:
        await client.aclose()


app = Starlette(
    routes=[
        Route("/", ui),
        Route("/health", health),
        Route("/metrics", proxy),
        Route("/v1/{path:path}", proxy, methods=["GET", "POST", "OPTIONS"]),
    ],
    on_startup=[on_start],
    on_shutdown=[on_stop],
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
