from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .db import init_models
from .limiter import limiter
from .routers import stations, stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_models()
    yield


app = FastAPI(title="costco-pump API", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Caddy's handle_path strips the /costcogas/api prefix before this ever sees
# the request, and both frontend and API are served from the same origin --
# CORS is only relevant for local dev (frontend on :5173, API on :8000).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(stations.router)
app.include_router(stats.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
