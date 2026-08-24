"""FastAPI app — stateless, coordinates only.

No endpoint accepts names or address strings; the request models literally
cannot hold them. Nothing is persisted, nothing is logged with payloads.
"""

import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import cluster, estimate, rounds, route
from .models import Assignment, Point, RouteResult
from .rounds import Round, RoundNotFound, RoundSummary

# Web dev server origins (vite, port 4382). In production the static build is
# served same-origin, so CORS mostly matters for odd dev setups without the
# vite proxy.
DEV_ORIGINS = ["http://localhost:4382", "http://127.0.0.1:4382"]


def tiles_path() -> Path:
    """Basemap archive location; override with KRANTENWIJK_TILES."""
    override = os.environ.get("KRANTENWIJK_TILES")
    if override:
        return Path(override)
    # repo_root/data/tiles/basemap.pmtiles (api.py sits 3 levels below root)
    return Path(__file__).parents[3] / "data" / "tiles" / "basemap.pmtiles"


class ClusterRequest(BaseModel):
    points: list[Point]
    max_stops: int = Field(default=50, ge=1)
    n_carriers: int | None = Field(default=None, ge=1)
    depot: Point | None = None


class ClusterResponse(BaseModel):
    assignments: list[Assignment]


class RouteRequest(BaseModel):
    points: list[Point]
    start_id: str | None = None
    end_id: str | None = None
    optimize: bool = True


class EstimateRequest(BaseModel):
    duration_s: float = Field(ge=0)
    n_stops: int = Field(ge=0)
    service_time_s: float = Field(default=estimate.DEFAULT_SERVICE_TIME_S, ge=0)


class EstimateResponse(BaseModel):
    total_s: float
    per_stop_s: float


def get_routing_backend() -> route.RoutingBackend:
    return route.get_backend()


def create_app() -> FastAPI:
    app = FastAPI(title="krantenwijk engine", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=DEV_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        # a courtesy for whoever clicks the uvicorn URL — the app lives on /api
        return {
            "service": "krantenwijk engine",
            "status": "/api/status",
            "docs": "/docs",
        }

    @app.get("/api/status")
    def status() -> dict[str, object]:
        backend = "ors" if os.environ.get("ORS_API_KEY") else "fallback"
        # `rounds` tells the app whether this instance can save plans at all,
        # so it can hide the save control and keep its privacy copy honest.
        return {
            "status": "ok",
            "routing": backend,
            "rounds": rounds.rounds_dir() is not None,
        }

    @app.post("/api/cluster", response_model=ClusterResponse)
    def cluster_points(req: ClusterRequest) -> ClusterResponse:
        assignments = cluster.seed_buckets(
            req.points,
            max_stops=req.max_stops,
            n_carriers=req.n_carriers,
            depot=req.depot,
        )
        return ClusterResponse(assignments=assignments)

    @app.post("/api/route", response_model=RouteResult)
    def route_points(
        req: RouteRequest,
        backend: route.RoutingBackend = Depends(get_routing_backend),
    ) -> RouteResult:
        if not req.points:
            raise HTTPException(422, "no points to route")
        try:
            return backend.route(
                req.points,
                start_id=req.start_id,
                end_id=req.end_id,
                optimize=req.optimize,
            )
        except route.BucketTooLarge as e:
            raise HTTPException(422, str(e)) from e
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        except route.RoutingError as e:
            raise HTTPException(502, str(e)) from e

    @app.post("/api/estimate", response_model=EstimateResponse)
    def estimate_time(req: EstimateRequest) -> EstimateResponse:
        return EstimateResponse(
            **estimate.estimate(req.duration_s, req.n_stops, req.service_time_s)
        )

    @app.get("/api/tiles/basemap.pmtiles")
    def basemap_archive() -> FileResponse:
        path = tiles_path()
        if not path.is_file():
            raise HTTPException(
                404,
                "basemap archive missing — carve one into data/tiles/ with: "
                "pmtiles extract <source.pmtiles> data/tiles/basemap.pmtiles "
                "--bbox=3.2,50.7,7.3,53.7",
            )
        # FileResponse answers Range requests with 206 partials, which is
        # exactly what the pmtiles protocol issues.
        return FileResponse(path, media_type="application/octet-stream")

    # ── saved rounds ────────────────────────────────────────────────────
    # Unlike everything above, these carry addresses and names (see
    # rounds.py). They exist only when KRANTENWIJK_ROUNDS_DIR is set; on the
    # public instance every one of them 404s and nothing is ever written.

    def require_rounds() -> None:
        if rounds.rounds_dir() is None:
            raise HTTPException(
                404,
                "this instance does not store rounds",
            )

    @app.get("/api/rounds", response_model=list[RoundSummary])
    def list_rounds(_: None = Depends(require_rounds)) -> list[RoundSummary]:
        return rounds.list_rounds()

    @app.post("/api/rounds", response_model=Round)
    def create_round(req: Round, _: None = Depends(require_rounds)) -> Round:
        # A new round always gets a fresh id, whatever the client sent.
        return rounds.write_round(req.model_copy(update={"id": ""}))

    @app.get("/api/rounds/{round_id}", response_model=Round)
    def get_round(round_id: str, _: None = Depends(require_rounds)) -> Round:
        try:
            return rounds.read_round(round_id)
        except RoundNotFound as e:
            raise HTTPException(404, str(e)) from e

    @app.put("/api/rounds/{round_id}", response_model=Round)
    def put_round(
        round_id: str, req: Round, _: None = Depends(require_rounds)
    ) -> Round:
        try:
            rounds.read_round(round_id)  # 404 rather than silently creating
            return rounds.write_round(req.model_copy(update={"id": round_id}))
        except RoundNotFound as e:
            raise HTTPException(404, str(e)) from e

    @app.delete("/api/rounds/{round_id}", status_code=204)
    def remove_round(round_id: str, _: None = Depends(require_rounds)) -> Response:
        try:
            rounds.delete_round(round_id)
        except RoundNotFound as e:
            raise HTTPException(404, str(e)) from e
        return Response(status_code=204)

    return app


app = create_app()
