# Built by CI with --platform linux/arm64 for the Oracle Ampere VM -- see
# ../.github/workflows/deploy.yml. python:3.12-slim publishes arm64 manifests,
# so no per-arch base-image juggling is needed here.
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Deps first so this layer only rebuilds when requirements.txt actually changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY worker.py ./

EXPOSE 8000

# docker-compose overrides `command:` for the worker service; this default is
# the API server. `-m uvicorn` (not the bare `uvicorn` script) so /app stays
# on sys.path and `app.main` imports correctly.
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
