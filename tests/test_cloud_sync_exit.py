import importlib
import json
import sys
import pytest


def test_cloud_sync_reports_failure_instead_of_retrying_forever(tmp_path,monkeypatch):
    monkeypatch.setenv('HACDAO_SYNC_KEY','test-only')
    monkeypatch.setenv('HACDAO_ALLOW_CLOUD_WRITES','true')
    module=importlib.import_module('tools.cloud_to_cloud_syncer')
    # SYNC_KEY được đọc từ env 1 LẦN lúc module load (module-level constant).
    # Nếu module đã bị import trước đó trong cùng phiên pytest (vd bởi 1 test
    # file khác import module này mà chưa set env) thì import_module() ở
    # trên trả về bản đã cache, KHÔNG đọc lại env. reload() ép chạy lại toàn
    # bộ top-level module với env hiện tại để SYNC_KEY luôn khớp giá trị vừa
    # set — tránh flaky theo thứ tự chạy test.
    importlib.reload(module)
    state=tmp_path/'state.json'
    state.write_text(json.dumps({'uploaded':{'demo':{}}}))
    monkeypatch.setattr(sys,'argv',['cloud-sync','--state-file',str(state),'--workers','1'])
    calls=[]
    def fail(slug,data,budget,known_keys=None):
        calls.append(slug)
        return {'slug':slug,'success':False,'error':'forced failure'}
    monkeypatch.setattr(module,'sync_novel_from_drive',fail)
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert exc.value.code==1
    assert calls==['demo']
    assert not (tmp_path/'.cloud_sync_state.json').exists()
