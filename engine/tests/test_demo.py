from krantenwijk.demo import CSV_COLUMNS, make_round, synth_person
from krantenwijk.models import AddressRecord


def fake_addresses(n: int) -> list[AddressRecord]:
    return [
        AddressRecord(
            id="",
            street=f"Straat {i % 7}",
            house_number=str(i),
            postcode=f"43{i % 90:02d} AB",
            city="Vlissingen",
            lat=51.44 + (i % 50) * 1e-4,
            lon=3.57 + (i % 40) * 1e-4,
        )
        for i in range(n)
    ]


def test_deterministic():
    pool = fake_addresses(600)
    assert make_round(pool, n=50, seed=1) == make_round(pool, n=50, seed=1)


def test_sample_size_and_unique_ids():
    result = make_round(fake_addresses(600), n=50, seed=7)
    assert len(result) == 50
    assert len({r.id for r in result}) == 50


def test_sample_capped_at_pool():
    assert len(make_round(fake_addresses(10), n=50, seed=7)) == 10


def test_categories_assigned():
    result = make_round(fake_addresses(600), n=200, seed=7)
    cats = {r.category for r in result}
    assert cats <= {"griep", "pneum"}
    assert "griep" in cats


def test_committed_demo_file(records):
    """The artifact we ship: 400 rows, unique ids, coords in Zeeland."""
    assert len(records) == 400
    assert len({r.id for r in records}) == 400
    for r in records:
        assert 51.4 < r.lat < 51.5 and 3.5 < r.lon < 3.7
        assert r.street and r.house_number


def test_csv_columns_match_schema_example():
    assert CSV_COLUMNS == [
        "id",
        "naam",
        "bsn",
        "straat",
        "huisnr",
        "postcode",
        "plaats",
        "lat",
        "lon",
        "soort",
    ]


def test_synth_person_deterministic_per_id():
    assert synth_person("v-0000") == synth_person("v-0000")
    assert synth_person("v-0000") != synth_person("v-0001")


def test_synth_bsn_passes_elfproef():
    for i in range(200):
        _, bsn = synth_person(f"v-{i:04d}")
        assert len(bsn) == 9 and bsn.isdigit()
        digits = [int(d) for d in bsn]
        weighted = sum((9 - i) * d for i, d in enumerate(digits[:8])) - digits[8]
        assert weighted % 11 == 0
