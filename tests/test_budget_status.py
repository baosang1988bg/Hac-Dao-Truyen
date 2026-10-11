from datetime import datetime, timezone

from tools import budget_status


def test_fuse_usage_resets_on_new_period():
    state = {"r2_month": "2026-10", "r2_ops": 1725, "d1_day": "2026-10-11", "d1_ops": 4915}
    assert budget_status.fuse_usage(state, datetime(2026, 10, 11, tzinfo=timezone.utc)) == {"r2_month": 1725, "d1_day": 4915}
    # Sang ngày mới: D1 về 0, R2 giữ (cùng tháng); sang tháng mới: cả hai về 0.
    assert budget_status.fuse_usage(state, datetime(2026, 10, 12, tzinfo=timezone.utc)) == {"r2_month": 1725, "d1_day": 0}
    assert budget_status.fuse_usage(state, datetime(2026, 11, 1, tzinfo=timezone.utc)) == {"r2_month": 0, "d1_day": 0}


def test_split_r2_classes():
    rows = [{"sum": {"requests": 1763}, "dimensions": {"actionType": "PutObject"}},
            {"sum": {"requests": 5359}, "dimensions": {"actionType": "GetObject"}},
            {"sum": {"requests": 100}, "dimensions": {"actionType": "HeadBucket"}}]
    assert budget_status.split_r2_classes(rows) == (1763, 5459)
