from krantenwijk.synth import BBOX, generate


def test_deterministic():
    assert generate(n=50, seed=1) == generate(n=50, seed=1)


def test_count_and_ids_unique(records):
    assert len(records) == 200
    assert len({r.id for r in records}) == 200


def test_coords_inside_bbox(records):
    min_lon, min_lat, max_lon, max_lat = BBOX
    for r in records:
        assert min_lat <= r.lat <= max_lat
        assert min_lon <= r.lon <= max_lon


def test_no_pii_shaped_fields(records):
    # The model itself is the guarantee; spot-check the instance dict too.
    fields = set(records[0].model_dump().keys())
    assert fields == {
        "id", "street", "house_number", "postcode", "city",
        "lat", "lon", "category", "carrier", "extra",
    }
