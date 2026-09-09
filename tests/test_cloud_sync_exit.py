import importlib
import json
import sys
import pytest


def test_cloud_sync_reports_failure_instead_of_retrying_forever(tmp_path,monkeypatch):
    monkeypatch.setenv('HACDAO_SYNC_KEY','test-only')
    module=importlib.import_module('tools.cloud_to_cloud_syncer')
    state=tmp_path/'state.json'
    state.write_text(json.dumps({'uploaded':{'demo':{}}}))
    monkeypatch.setattr(sys,'argv',['cloud-sync','--state-file',str(state),'--workers','1'])
    calls=[]
    def fail(slug,data,budget):
        calls.append(slug)
        return {'slug':slug,'success':False,'error':'forced failure'}
    monkeypatch.setattr(module,'sync_novel_from_drive',fail)
    with pytest.raises(SystemExit) as exc:
        module.main()
    assert exc.value.code==1
    assert calls==['demo']
    assert not (tmp_path/'.cloud_sync_state.json').exists()
