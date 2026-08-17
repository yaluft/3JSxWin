# Image for OVHcloud AI Deploy: vLLM + the chat UI behind one HTTP port.
#
# AI Deploy runs containers as UID 42420 with /workspace as the writable home,
# so everything the app touches at runtime must be owned by 42420:42420.
#
# Build from the gpu-vm/ directory so the web UI is in context:
#   docker build -f aideploy/Dockerfile -t llm-chat:latest .
FROM vllm/vllm-openai:latest

# The base image's entrypoint is `vllm serve`; we run our own launcher instead.
ENTRYPOINT []

ENV HOME=/workspace \
    HF_HOME=/workspace/hf-cache \
    HF_HUB_ENABLE_HF_TRANSFER=1 \
    PORT=8080 \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

RUN pip install --no-cache-dir starlette uvicorn httpx hf_transfer

COPY aideploy/serve.py /workspace/serve.py
COPY web/index.html    /workspace/web/index.html

# OVHcloud runs the container as this UID; without it the app cannot write to
# its own home and the HF cache download fails.
RUN mkdir -p /workspace/hf-cache && chown -R 42420:42420 /workspace

USER 42420:42420
EXPOSE 8080

CMD ["python3", "/workspace/serve.py"]
