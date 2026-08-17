# One image for OVHcloud AI Deploy: Ollama + ComfyUI + a browser terminal with
# the Claude Code and IBM Bob agents, all behind a single HTTP port.
#
# OVH's constraints, and how this file meets them:
#   - linux/amd64 only          -> build with --platform linux/amd64 (deploy.sh does)
#   - no docker-compose         -> entrypoint.py supervises every process
#   - runs as UID 42420:42420   -> /workspace and the app dirs are chowned below
#
# Build from gpu-vm/ so the chat UI is in context:
#   docker build --platform linux/amd64 -f aideploy/Dockerfile -t <user>/ai-app:latest .
FROM pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime

ARG COMFYUI_REF=master
# IBM Bob is an entitled IBM product; the installer is public but using it needs
# your IBM account at runtime. Set to 0 to build without it.
ARG INSTALL_BOB=1
ARG INSTALL_CLAUDE=1

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/workspace \
    PORT=8080 \
    PYTHONUNBUFFERED=1 \
    OLLAMA_KEEP_ALIVE=10m

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git jq ttyd tmux vim less procps \
    && rm -rf /var/lib/apt/lists/*

# Node 22+ — required by both agent CLIs.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Ollama. Its installer wants systemd; we only need the binary, which it drops
# in /usr/local/bin before the service step fails harmlessly.
RUN curl -fsSL https://ollama.com/install.sh | sh || true
RUN command -v ollama || (echo "ollama did not install" && exit 1)

# ComfyUI. torch is already in the base image, so drop it from the requirements
# rather than letting pip pull a second, conflicting build.
RUN git clone --depth 1 --branch ${COMFYUI_REF} https://github.com/comfyanonymous/ComfyUI /opt/ComfyUI \
    && sed -i '/^torch/d; /^torchvision/d; /^torchaudio/d' /opt/ComfyUI/requirements.txt \
    && pip install --no-cache-dir -r /opt/ComfyUI/requirements.txt

RUN pip install --no-cache-dir starlette uvicorn httpx websockets

# The agents. Both authenticate at runtime, in the terminal — no credential is
# baked into this image.
RUN if [ "$INSTALL_CLAUDE" = "1" ]; then npm install -g @anthropic-ai/claude-code; fi
RUN if [ "$INSTALL_BOB" = "1" ]; then \
      curl -fsSL https://bob.ibm.com/download/bobshell.sh | bash || \
      echo "WARNING: BobShell install failed — build with --build-arg INSTALL_BOB=0 to skip"; \
    fi

COPY aideploy/entrypoint.py /opt/app/entrypoint.py
COPY aideploy/router.py     /opt/app/router.py
COPY web/index.html         /opt/app/web/index.html

# AI Deploy runs the container as 42420:42420. Everything written at runtime —
# the HF/Ollama caches, ComfyUI's output and models, the agents' config under
# $HOME — has to be writable by that user.
RUN mkdir -p /workspace/ollama /workspace/comfy/output /workspace/.claude /workspace/.bob \
    && chown -R 42420:42420 /workspace /opt/app /opt/ComfyUI

USER 42420:42420
WORKDIR /workspace
EXPOSE 8080

CMD ["python3", "/opt/app/entrypoint.py"]
