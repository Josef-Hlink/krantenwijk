"""Delivery-time estimation.

total = walking duration + a flat service time per stop (reaching the door,
dropping the card). Deliberately simple for v1.
"""

DEFAULT_SERVICE_TIME_S = 45.0


def estimate(
    duration_s: float, n_stops: int, service_time_s: float = DEFAULT_SERVICE_TIME_S
) -> dict[str, float]:
    total = duration_s + n_stops * service_time_s
    return {"total_s": total, "per_stop_s": total / n_stops if n_stops else 0.0}
