from datetime import datetime, timezone

from tools import budget_status


def test_fuse_usage_resets_on_new_period():
    state = {"r2_month": "2026-10", "r2_ops": 1725, "d1_day": "2026-10-11", "d1_ops": 4915}
    assert budget_status.fuse_usage(state, datetime(2026, 10, 11, tzinfo=timezone.utc)) == {"r2_month": 1725, "d1_day": 4915}
    # Sang ngày mới: D1 về 0, R2 giữ (cùng tháng); sang tháng mới: cả hai về 0.
    assert budget_status.fuse_usage(state, datetime(2026, 10, 12, tzinfo=timezone.utc)) == {"r2_month": 1725, "d1_day": 0}
    assert budget_status.fuse_usage(state, datetime(2026, 11, 1, tzinfo=timezone.utc)) == {"r2_month": 0, "d1_day": 0}


def test_parse_usage_sums_account_wide_metrics():
    from tools import cloudflare_usage
    account = {
        "d1": [{"sum": {"rowsRead": 500, "rowsWritten": 40}}, {"sum": {"rowsRead": 36, "rowsWritten": 3}}],
        "r2": [{"sum": {"requests": 1763}, "dimensions": {"actionType": "PutObject"}},
               {"sum": {"requests": 5359}, "dimensions": {"actionType": "GetObject"}},
               {"sum": {"requests": 100}, "dimensions": {"actionType": "HeadBucket"}}],
        "st": [{"max": {"payloadSize": 10}, "dimensions": {"bucketName": "a"}},
               {"max": {"payloadSize": 25}, "dimensions": {"bucketName": "a"}},
               {"max": {"payloadSize": 5}, "dimensions": {"bucketName": "b"}}],
        "wk": [{"sum": {"requests": 612}}],
    }
    assert cloudflare_usage.parse_usage(account) == {
        "d1_rows_written_day": 43, "d1_rows_read_day": 536, "r2_class_a_month": 1763,
        "r2_class_b_month": 5459, "r2_storage_bytes": 30, "workers_requests_day": 612}
