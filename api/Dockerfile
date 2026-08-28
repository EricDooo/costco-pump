# Built by CI with --platform linux/arm64 for the Oracle Ampere VM (see
# ../.github/workflows/deploy.yml, which also passes --cache-from/--cache-to
# type=gha so this cache survives between CI runs, not just within one).
#
# Multi-stage + uv's official Docker pattern: dependencies are installed in
# their own layer, from only pyproject.toml/uv.lock, *before* app code is
# copied in -- so an app-code-only change (the common case) hits the layer
# cache for the entire dependency install and only re-runs the fast second
# `uv sync` for the project itself. The final image carries just the built
# venv + source, not uv or any build tooling.

FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_PYTHON_DOWNLOADS=0 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Deps-only layer: cache-busts on pyproject.toml/uv.lock, nothing else.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

COPY . /app

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Just the built venv + source -- no uv, no build tooling, no cache.
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/app ./app
COPY --from=builder /app/worker.py /app/enqueuer.py ./

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000

# docker-compose overrides `command:` for the worker/enqueuer services; this
# default is the API server.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
