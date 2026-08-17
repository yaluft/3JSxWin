#!/usr/bin/env python3
"""Single-port router for the AI Deploy container.

AI Deploy exposes exactly one HTTP port and forbids docker-compose, so every
service runs in this one container on loopback and this ASGI app fans requests
out to them:

    /                chat UI (static)
    /chat            same
    /v1/...          Ollama's OpenAI-compatible API
    /ollama/...      Ollama's native API (mapped to its /api/...)
    /term, /term/... ttyd — browser terminal for the `claude` and `bob` agents
    /healthz         status + how long the container has been idle
    everything else  ComfyUI

That last line is deliberate. ComfyUI's frontend requests absolute paths
(`/api/...`, `/view`, `/assets/...`, `/ws`) and does not support being served
under a prefix — proxying it at a subpath breaks thumbnails and half its API.
Letting unclaimed paths fall through to ComfyUI means those absolute paths
resolve correctly, so only the handful of routes above are reserved.

The idle clock lives here because the router is the only thing that sees every
request, whether it lands on the chat UI, ComfyUI or the terminal.
"""
import contextlib
import os
import time

import httpx
import websockets
from starlette.applications import Starlette
from starlette.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocketDisconnect

OLLAMA = "http://127.0.0.1:11434"
COMFY = "http://127.0.0.1:8188"
TTYD = "http://127.0.0.1:7681"
COMFY_WS = "ws://127.0.0.1:8188"
TTYD_WS = "ws://127.0.0.1:7681"

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "index.html")
API_KEY = os.environ.get("APP_API_KEY", "")

# Requests that shouldn't count as someone using the box: health probes from
# AI Deploy, and the guard polling us.
QUIET_PATHS = {"/healthz", "/favicon.ico"}

STARTED = time.time()
_last_activity = time.time()
_inflight = 0


def touch():
    global _last_activity
    _last_activity = time.time()


client: httpx.AsyncClient | None = None


def authorized(request) -> bool:
    if not API_KEY:
        return True
    header = request.headers.get("authorization", "")
    if header.startswith("Bearer ") and header[7:] == API_KEY:
        return True
    # ttyd and ComfyUI are opened directly in a browser tab, which can't set a
    # header — accept the key as a query param or cookie for those.
    if request.query_params.get("key") == API_KEY:
        return True
    return request.cookies.get("app_key") == API_KEY


# ------------------------------------------------------------------- HTTP ---

async def forward(request, upstream: str, path: str | None = None):
    """Proxy one HTTP request upstream, streaming the response body back."""
    global _inflight

    target = upstream + (path if path is not None else request.url.path)
    if request.url.query:
        target += "?" + request.url.query

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "connection")
    }

    _inflight += 1
    touch()
    try:
        req = client.build_request(
            request.method, target, headers=headers, content=request.stream(), timeout=None
        )
        upstream_resp = await client.send(req, stream=True)
    except httpx.ConnectError:
        _inflight -= 1
        return JSONResponse(
            {"error": f"{upstream} is not up yet — the model or ComfyUI may still be loading"},
            status_code=503,
        )
    except Exception as err:
        _inflight -= 1
        return JSONResponse({"error": str(err)}, status_code=502)

    passthrough = {
        k: v for k, v in upstream_resp.headers.items()
        if k.lower() not in ("content-length", "transfer-encoding", "connection")
    }

    async def body():
        global _inflight
        try:
            async for chunk in upstream_resp.aiter_raw():
                touch()          # a long generation keeps the box "in use"
                yield chunk
        finally:
            _inflight -= 1
            await upstream_resp.aclose()

    return StreamingResponse(body(), status_code=upstream_resp.status_code, headers=passthrough)


async def ui(request):
    touch()
    if not os.path.isfile(WEB):
        return JSONResponse({"error": "chat UI missing from image"}, status_code=500)
    return FileResponse(WEB, headers={"Cache-Control": "no-store"})


async def ollama_openai(request):
    if not authorized(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await forward(request, OLLAMA)


async def ollama_native(request):
    if not authorized(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    # /ollama/tags -> /api/tags
    return await forward(request, OLLAMA, "/api/" + request.path_params["path"])


async def terminal(request):
    if not authorized(request):
        return JSONResponse({"error": "unauthorized — append ?key=<app key>"}, status_code=401)
    path = request.url.path[len("/term"):] or "/"
    return await forward(request, TTYD, path)


async def comfy(request):
    if not authorized(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    path = request.url.path
    if path == "/comfy" or path.startswith("/comfy/"):
        path = path[len("/comfy"):] or "/"
    return await forward(request, COMFY, path)


async def healthz(request):
    """Status for humans, and the numbers the idle guard acts on."""
    async def up(url, path="/"):
        try:
            r = await client.get(url + path, timeout=3)
            return r.status_code < 500
        except Exception:
            return False

    idle = 0 if _inflight else int(time.time() - _last_activity)
    return JSONResponse({
        "ok": True,
        "uptime_seconds": int(time.time() - STARTED),
        "idle_seconds": idle,
        "inflight_requests": _inflight,
        "services": {
            "ollama": await up(OLLAMA, "/api/tags"),
            "comfyui": await up(COMFY, "/system_stats"),
            "terminal": await up(TTYD),
        },
    })


# -------------------------------------------------------------- WebSocket ---

async def bridge(ws, upstream_url: str):
    """Pump frames both ways between the client and an upstream websocket.

    ComfyUI streams execution progress over /ws and ttyd carries the whole
    terminal session over one, so both need this rather than plain HTTP.
    """
    import asyncio

    await ws.accept(subprotocol=ws.headers.get("sec-websocket-protocol"))
    touch()

    try:
        async with websockets.connect(
            upstream_url,
            subprotocols=[ws.headers["sec-websocket-protocol"]] if "sec-websocket-protocol" in ws.headers else None,
            open_timeout=10,
            ping_interval=None,
            max_size=None,
        ) as upstream:

            async def client_to_upstream():
                while True:
                    msg = await ws.receive()
                    if msg["type"] == "websocket.disconnect":
                        raise WebSocketDisconnect(msg.get("code", 1000))
                    touch()
                    if (data := msg.get("bytes")) is not None:
                        await upstream.send(data)
                    elif (text := msg.get("text")) is not None:
                        await upstream.send(text)

            async def upstream_to_client():
                async for message in upstream:
                    touch()
                    if isinstance(message, bytes):
                        await ws.send_bytes(message)
                    else:
                        await ws.send_text(message)

            done, pending = await asyncio.wait(
                [asyncio.create_task(client_to_upstream()),
                 asyncio.create_task(upstream_to_client())],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
    except WebSocketDisconnect:
        pass
    except Exception as err:
        print(f"[router] websocket bridge to {upstream_url} failed: {err}", flush=True)
    finally:
        try:
            await ws.close()
        except Exception:
            pass


async def comfy_ws(ws):
    query = ws.url.query
    await bridge(ws, f"{COMFY_WS}/ws" + (f"?{query}" if query else ""))


async def term_ws(ws):
    path = ws.url.path[len("/term"):] or "/ws"
    await bridge(ws, TTYD_WS + path)


# ---------------------------------------------------------------- plumbing --

@contextlib.asynccontextmanager
async def lifespan(_app):
    # One shared client for every upstream. Recent Starlette dropped the
    # on_startup/on_shutdown kwargs, so this is the supported hook.
    global client
    client = httpx.AsyncClient(timeout=None, follow_redirects=False)
    try:
        yield
    finally:
        await client.aclose()


app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/", ui),
        Route("/chat", ui),
        Route("/healthz", healthz),
        Route("/v1/{path:path}", ollama_openai, methods=["GET", "POST", "OPTIONS"]),
        Route("/ollama/{path:path}", ollama_native, methods=["GET", "POST", "DELETE"]),
        WebSocketRoute("/term/ws", term_ws),
        Route("/term", terminal),
        Route("/term/{path:path}", terminal, methods=["GET", "POST"]),
        WebSocketRoute("/ws", comfy_ws),
        # Anything else is ComfyUI, including its absolute /api, /view and
        # /assets paths — see the module docstring.
        Route("/{path:path}", comfy, methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"]),
    ],
)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8080")),
        log_level=os.environ.get("LOG_LEVEL", "info"),
        ws_ping_interval=None,
    )
