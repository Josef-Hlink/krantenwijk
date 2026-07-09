from fastapi.testclient import TestClient

from krantenwijk import api
from krantenwijk.route import FallbackBackend


def make_client() -> TestClient:
    app = api.create_app()
    app.dependency_overrides[api.get_routing_backend] = FallbackBackend
    return TestClient(app)


def as_points(points):
    return [p.model_dump() for p in points]


def test_status():
    r = make_client().get("/api/status")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_cluster(points):
    r = make_client().post(
        "/api/cluster", json={"points": as_points(points), "max_stops": 30}
    )
    assert r.status_code == 200
    assignments = r.json()["assignments"]
    assert len(assignments) == len(points)
    from collections import Counter

    counts = Counter(a["bucket"] for a in assignments)
    assert max(counts.values()) <= 30


def test_route_fallback(small_points):
    body = {
        "points": as_points(small_points),
        "start_id": small_points[0].id,
        "end_id": small_points[-1].id,
    }
    r = make_client().post("/api/route", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["engine"] == "fallback"
    assert data["order"][0] == small_points[0].id
    assert data["order"][-1] == small_points[-1].id


def test_route_empty_422():
    r = make_client().post("/api/route", json={"points": []})
    assert r.status_code == 422


def test_route_bad_start_422(small_points):
    r = make_client().post(
        "/api/route",
        json={"points": as_points(small_points), "start_id": "nope"},
    )
    assert r.status_code == 422


def test_estimate():
    r = make_client().post(
        "/api/estimate", json={"duration_s": 600, "n_stops": 10}
    )
    assert r.status_code == 200
    assert r.json()["total_s"] == 600 + 10 * 45


def test_tiles_range_request(tmp_path, monkeypatch):
    archive = tmp_path / "basemap.pmtiles"
    archive.write_bytes(b"0123456789abcdef")
    monkeypatch.setenv("KRANTENWIJK_TILES", str(archive))
    client = make_client()
    r = client.get("/api/tiles/basemap.pmtiles", headers={"Range": "bytes=4-7"})
    assert r.status_code == 206
    assert r.content == b"4567"


def test_tiles_missing_404(monkeypatch, tmp_path):
    monkeypatch.setenv("KRANTENWIJK_TILES", str(tmp_path / "absent.pmtiles"))
    r = make_client().get("/api/tiles/basemap.pmtiles")
    assert r.status_code == 404
    assert "pmtiles extract" in r.json()["detail"]
