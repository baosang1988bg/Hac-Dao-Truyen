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
