# Built by CI with --platform linux/arm64 for the Oracle Ampere VM, with
# --cache-from/--cache-to type=gha so the deps layers below survive between
# CI runs, not just within one build (see ../.github/workflows/deploy.yml).
#
# Two targets share one dependency-install pattern (uv's official Docker
# recipe: deps installed from only pyproject.toml/uv.lock, *before* app code
# is copied in, so an app-code-only change hits the layer cache for the
# entire install and only re-runs the fast final `uv sync`):
#   - `api`    -- api + enqueuer's image. Lean; neither ever imports
#                 app.scraper.browser, so there's no Patchright/Chromium here.
#   - `worker` -- adds the `browser` extra + Chromium on top of the same base
#                 deps. This is the one process that actually talks to
#                 Costco (see app/scraper/browser.py for why it needs a real
#                 browser, not a plain HTTP client).

FROM python:3.12-slim AS base-builder
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

# ---------------------------------------------------------------------------
FROM base-builder AS api-builder
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

FROM python:3.12-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Just the built venv + source -- no uv, no build tooling, no cache.
COPY --from=api-builder /app/.venv /app/.venv
COPY --from=api-builder /app/app ./app
COPY --from=api-builder /app/worker.py /app/enqueuer.py ./
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
# docker-compose overrides `command:` for the enqueuer service; this default
# is the API server.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# ---------------------------------------------------------------------------
FROM base-builder AS worker-builder
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --extra browser --no-dev

FROM python:3.12-slim AS worker
WORKDIR /app
COPY --from=worker-builder /app/.venv /app/.venv
COPY --from=worker-builder /app/app ./app
COPY --from=worker-builder /app/worker.py ./
ENV PATH="/app/.venv/bin:$PATH"
# --with-deps installs Chromium's OS-level dependencies for this distro
# (bookworm) too -- must run after the venv (and its patchright install) is
# in place, since it shells out to the venv's own `patchright` CLI.
RUN patchright install --with-deps chromium
CMD ["python", "worker.py"]
