from krantenwijk.demo import CSV_COLUMNS, assign_people, make_round, synth_person
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
    """n counts cards, so a small pool caps the doors, not the rows: every
    address may still be called up more than once."""
    result = make_round(fake_addresses(10), n=50, seed=7)
    doors = {(r.street, r.house_number) for r in result}
    assert len(doors) == 10
    assert len(result) >= 10


def test_some_doors_hold_more_than_one_card():
    """A real round calls up two people in one household; the demo has to
    contain the case or nothing downstream is exercised against it."""
    result = make_round(fake_addresses(600), n=400, seed=7)
    doors: dict[tuple[str, str], int] = {}
    for r in result:
        doors[(r.street, r.house_number)] = doors.get((r.street, r.house_number), 0) + 1
    assert max(doors.values()) > 1
    assert len(doors) < len(result)


def test_cards_at_one_door_share_a_coordinate_and_keep_their_own_ids():
    result = make_round(fake_addresses(600), n=400, seed=7)
    grouped: dict[tuple[str, str], list[AddressRecord]] = {}
    for r in result:
        grouped.setdefault((r.street, r.house_number), []).append(r)
    multi = [rs for rs in grouped.values() if len(rs) > 1]
    assert multi, "expected at least one multi-card door"
    for rs in multi:
        assert len({(r.lat, r.lon) for r in rs}) == 1
        assert len({r.id for r in rs}) == len(rs), "each card keeps its own id"


def test_a_household_shares_a_surname():
    people = assign_people("badhuisstraat|34", 3, seed=7)
    assert len({naam.split()[-1] for naam in people}) == 1


def test_one_resident_can_be_called_up_twice():
    """Cards are not people: paper and flyer go to the same door, for the
    same person, as two rows. The walking view has to collapse that to one
    name, so the demo has to contain it."""
    shapes = {
        len({naam for naam in assign_people(f"straat|{i}", 3, seed=7)})
        for i in range(60)
    }
    assert 2 in shapes, "expected some 3-card doors to hold only two residents"
    assert 3 in shapes, "and some to hold three"


def test_categories_assigned():
    result = make_round(fake_addresses(600), n=200, seed=7)
    cats = {r.category for r in result}
    assert cats <= {"krant", "folder"}
    assert "krant" in cats


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
