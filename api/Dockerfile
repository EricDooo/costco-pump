# Built by CI with --platform linux/arm64 for the Oracle Ampere VM, with
# --cache-from/--cache-to type=gha so the deps layer below survives between
# CI runs, not just within one build (see ../.github/workflows/deploy.yml).
#
# One image for api, enqueuer, and worker -- they used to split into two
# targets (worker carrying a Patchright/Chromium browser session the other
# two never needed), but the scraper is a plain HTTP client now (see
# app/scraper/client.py), so all three processes have identical
# dependencies. docker-compose.yml picks the process via `command:`.

FROM python:3.12-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_PYTHON_DOWNLOADS=0 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Deps-only layer: cache-busts on pyproject.toml/uv.lock, nothing else, so
# an app-code-only change hits the layer cache for the entire install and
# only re-runs the fast final `uv sync`.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

FROM python:3.12-slim AS api
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
# docker-compose overrides `command:` for the enqueuer/worker services;
# this default is the API server.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
