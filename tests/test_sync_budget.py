from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import pytest
from tools.sync_budget import SyncBudget
from tools.sync_transport import send_chunk


def test_zero_default_and_atomic_reservation_across_instances(tmp_path):
    state=tmp_path/'budget.json'
    assert not SyncBudget(state).try_reserve(1,1)
    budgets=[SyncBudget(state,10,10,20) for _ in range(20)]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results=list(pool.map(lambda b:b.try_reserve(1,1),budgets))
    assert sum(results)==10
    assert json.loads(state.read_text())['r2_ops']==10
    assert not SyncBudget(state,10,10,20).try_reserve(1,1)


def test_corrupt_state_and_save_failure_fail_closed(tmp_path,monkeypatch):
    state=tmp_path/'budget.json';state.write_text('broken')
    with pytest.raises(ValueError):SyncBudget(state,10,10,20).try_reserve(1,1)
    state.unlink()
    def fail(*args):raise OSError('disk full')
    monkeypatch.setattr('tools.sync_budget.atomic_json',fail)
    with pytest.raises(OSError):SyncBudget(state,10,10,20).try_reserve(1,1)
    assert not state.exists()


def test_retry_reserves_before_each_request_and_respects_retry_after(tmp_path,monkeypatch):
    requests=[];delays=[]
    class Response:
        status=429
        def read(self):return b'limited'
        def getheader(self,key):return '7'
    class Connection:
        def __init__(self,*args,**kwargs):pass
        def request(self,*args,**kwargs):requests.append(1)
        def getresponse(self):return Response()
        def close(self):pass
    monkeypatch.setattr('tools.sync_transport.http.client.HTTPSConnection',Connection)
    budget=SyncBudget(tmp_path/'budget.json',1,20,30)
    result,_=send_chunk(None,{'chapters':[{}]},host='unused',sync_key='test',budget=budget,sleep=delays.append)
    assert not result['success'] and result['budget_exceeded']
    assert len(requests)==1 and delays==[7]
    assert json.loads((tmp_path/'budget.json').read_text())['r2_ops']==1


def test_direct_cloud_writes_are_disabled_before_any_subprocess(monkeypatch):
    import migrate_to_cloudflare as migrate
    monkeypatch.delenv('HACDAO_ALLOW_CLOUD_WRITES',raising=False)
    monkeypatch.setattr(migrate,'run_safe',lambda *args:pytest.fail('Không được chạy Wrangler'))
    with pytest.raises(RuntimeError,match='Ghi cloud đang tắt'):
        migrate.d1_file('INSERT INTO novels(slug,title) VALUES (\'x\',\'x\');')
    with pytest.raises(RuntimeError,match='Ghi cloud đang tắt'):
        migrate.r2_put(Path('unused'),'demo/key')
    assert migrate.d1_file('SELECT 1;',dry_run=True)


def _real(d1=0, r2=0, storage=0):
    return {"d1_rows_written_day": d1, "r2_class_a_month": r2, "r2_storage_bytes": storage}


def test_real_usage_guard_blocks_before_hitting_cloudflare_free_limit(tmp_path):
    # Cầu chì tự đặt rất cao nhưng số liệu THẬT đã gần 80% hạn mức D1 Free →
    # phải dừng trước khi Cloudflare thật sự chặn/tính phí.
    budget = SyncBudget(tmp_path / "b.json", 10**6, 10**6, 10**6, real_usage=_real(d1=79_900), real_ratio=0.8)
    assert budget.try_reserve(1, 100)            # 79_900 + 100 = 80_000 ≤ 80% × 100_000
    assert not budget.try_reserve(1, 1)          # cộng dồn phần đã ghi trong run
    assert "Cloudflare" in budget.stopped_reason


def test_real_usage_guard_checks_r2_class_a(tmp_path):
    budget = SyncBudget(tmp_path / "b.json", 10**6, 10**6, 10**6, real_usage=_real(r2=799_999), real_ratio=0.8)
    assert budget.try_reserve(1, 0)
    assert not budget.try_reserve(1, 0)


def test_storage_over_free_tier_does_not_block_writes(tmp_path):
    # Dung lượng R2 vượt Free chỉ tốn phí lưu trữ nhỏ; chặn ghi vì nó sẽ làm
    # ngưng mọi cập nhật chương → chỉ cảnh báo (budget_status), không chặn.
    budget = SyncBudget(tmp_path / "b.json", 10, 10, 20, real_usage=_real(storage=25 * 1000**3))
    assert budget.try_reserve(1, 1)


def test_without_real_usage_falls_back_to_fuse_only(tmp_path):
    budget = SyncBudget(tmp_path / "b.json", 1, 10, 20, real_usage=None)
    assert budget.try_reserve(1, 1)
    assert not budget.try_reserve(1, 1)
