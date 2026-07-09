from krantenwijk.estimate import estimate


def test_formula():
    result = estimate(duration_s=3600, n_stops=40, service_time_s=45)
    assert result["total_s"] == 3600 + 40 * 45
    assert result["per_stop_s"] == result["total_s"] / 40


def test_zero_stops():
    assert estimate(duration_s=0, n_stops=0)["per_stop_s"] == 0.0
