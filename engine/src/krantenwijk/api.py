"""FastAPI app — stateless, coordinates only.

No endpoint accepts names or address strings; the request models literally
cannot hold them. Nothing is persisted, nothing is logged with payloads.
"""

import os
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import auth, cluster, deliveries, estimate, rounds, route
from .auth import COOKIE_NAME, User
from .deliveries import Delivery, Mark
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


class MarksRequest(BaseModel):
    marks: list[Mark] = []


class LoginRequest(BaseModel):
    username: str
    password: str


class Me(BaseModel):
    username: str


def current_user(
    krantenwijk_session: str | None = Cookie(default=None),
) -> User | None:
    """Whoever is signed in, or ``None``. Never raises — /api/status asks too."""
    if not rounds.enabled():
        return None
    return auth.resolve_session(krantenwijk_session)


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
    def status(user: User | None = Depends(current_user)) -> dict[str, object]:
        backend = "ors" if os.environ.get("ORS_API_KEY") else "fallback"
        # `rounds` tells the app whether saving is available *to this caller*,
        # so it can hide the save control and keep its privacy copy honest. It
        # answers two questions at once — does this instance store anything,
        # and is whoever is asking signed in — because the app only ever needs
        # the conjunction. `accounts` is the difference between the two: it is
        # what tells a guest a login exists to be offered.
        return {
            "status": "ok",
            "routing": backend,
            "accounts": rounds.enabled(),
            "rounds": user is not None,
            "user": user.username if user else None,
        }

    # ── accounts ────────────────────────────────────────────────────────
    # Sign in and out. There is deliberately no endpoint that *creates* an
    # account: they are made with `krantenwijk useradd` on the box.

    @app.post("/api/login", response_model=Me)
    def login(req: LoginRequest, response: Response) -> Me:
        if not rounds.enabled():
            raise HTTPException(404, "this instance does not store rounds")
        user = auth.authenticate(req.username, req.password)
        if user is None:
            # One message for both halves: which of the two was wrong is not
            # the caller's business.
            raise HTTPException(401, "wrong username or password")
        token, _expires_at = auth.start_session(user)
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=int(auth.SESSION_TTL.total_seconds()),
            httponly=True,
            # Always set, even in dev: browsers treat localhost as a secure
            # context, so a Secure cookie is stored there too and there is no
            # switch that could silently ship insecure in production.
            secure=True,
            samesite="lax",
            path="/",
        )
        return Me(username=user.username)

    @app.post("/api/logout", status_code=204)
    def logout(krantenwijk_session: str | None = Cookie(default=None)) -> Response:
        if rounds.enabled():
            auth.end_session(krantenwijk_session)
        # Built here rather than through an injected Response: returning a
        # Response object replaces the injected one, and the Set-Cookie that
        # clears the session would go with it.
        response = Response(status_code=204)
        # The attributes have to match the ones it was set with, or some
        # browsers keep the original cookie alongside the expired one.
        response.delete_cookie(
            COOKIE_NAME, path="/", httponly=True, secure=True, samesite="lax"
        )
        return response

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
    # rounds.py). They exist only when KRANTENWIJK_DATABASE_URL is set; with
    # no database configured every one of them 404s and nothing is ever written.

    def require_user(user: User | None = Depends(current_user)) -> User:
        # Order matters. An instance that stores nothing says so — that is a
        # fact about the deployment, not about the caller. Only once storage
        # exists does the question "who are you" arise.
        if not rounds.enabled():
            raise HTTPException(
                404,
                "this instance does not store rounds",
            )
        if user is None:
            raise HTTPException(401, "sign in to reach saved rounds")
        return user

    @app.get("/api/rounds", response_model=list[RoundSummary])
    def list_rounds(_: User = Depends(require_user)) -> list[RoundSummary]:
        return rounds.list_rounds()

    @app.post("/api/rounds", response_model=Round)
    def create_round(req: Round, _: User = Depends(require_user)) -> Round:
        # A new round always gets a fresh id, whatever the client sent.
        try:
            return rounds.write_round(req.model_copy(update={"id": ""}))
        except rounds.RoundTooLarge as e:
            raise HTTPException(422, str(e)) from e

    @app.get("/api/rounds/{round_id}", response_model=Round)
    def get_round(round_id: str, _: User = Depends(require_user)) -> Round:
        try:
            return rounds.read_round(round_id)
        except RoundNotFound as e:
            raise HTTPException(404, str(e)) from e

    @app.put("/api/rounds/{round_id}", response_model=Round)
    def put_round(round_id: str, req: Round, _: User = Depends(require_user)) -> Round:
        try:
            rounds.read_round(round_id)  # 404 rather than silently creating
            return rounds.write_round(req.model_copy(update={"id": round_id}))
        except RoundNotFound as e:
            raise HTTPException(404, str(e)) from e
        except rounds.RoundTooLarge as e:
            raise HTTPException(422, str(e)) from e

    # ── delivery marks ──────────────────────────────────────────────────
    # Which doors have had their card. Rows keyed by the door, so two carriers
    # on different buckets write disjoint sets and never contend; see
    # deliveries.py for why that removes the need for any lock.

    def _existing_round(round_id: str) -> str:
        try:
            rounds.read_round(round_id)
        except RoundNotFound as e:
            raise HTTPException(404, str(e)) from e
        return round_id

    @app.get("/api/rounds/{round_id}/deliveries", response_model=list[Delivery])
    def get_deliveries(
        round_id: str, _: User = Depends(require_user)
    ) -> list[Delivery]:
        return deliveries.list_for_round(_existing_round(round_id))

    @app.post("/api/rounds/{round_id}/deliveries", response_model=list[Delivery])
    def post_deliveries(
        round_id: str, req: MarksRequest, user: User = Depends(require_user)
    ) -> list[Delivery]:
        # Returns the whole round's state, not just what was sent: the phone
        # that just drained its outbox also wants to know where everyone else
        # got to, and that costs one query either way.
        return deliveries.record(_existing_round(round_id), req.marks, user.id)

    @app.delete("/api/rounds/{round_id}/deliveries", status_code=204)
    def clear_deliveries(
        round_id: str, bucket_id: str, _: User = Depends(require_user)
    ) -> Response:
        deliveries.clear_bucket(_existing_round(round_id), bucket_id)
        return Response(status_code=204)

    @app.delete("/api/rounds/{round_id}", status_code=204)
    def remove_round(round_id: str, _: User = Depends(require_user)) -> Response:
        try:
            rounds.delete_round(round_id)
        except RoundNotFound as e:
            raise HTTPException(404, str(e)) from e
        return Response(status_code=204)

    return app


app = create_app()
