import os
from pathlib import Path
import subprocess
import pytest

ROOT=Path(__file__).resolve().parents[1]


def git(cwd,*args):
    return subprocess.run(['git','-c','user.name=Test','-c','user.email=test@example.invalid',*args],cwd=cwd,check=True,capture_output=True,text=True)


@pytest.mark.parametrize('reject',[False,True])
def test_checkpoint_commit_no_change_and_rejected_push(tmp_path,reject):
    remote=tmp_path/'remote.git';work=tmp_path/'work';work.mkdir()
    git(tmp_path,'init','--bare',str(remote))
    git(work,'init','-b','main');git(work,'remote','add','origin',str(remote))
    (work/'state.json').write_text('{}')
    git(work,'add','state.json');git(work,'commit','-m','initial');git(work,'push','-u','origin','main')
    env={**os.environ,'GITHUB_REF_NAME':'main'}
    command=['bash',str(ROOT/'tools/commit_sync_state.sh'),'checkpoint','state.json']
    result=subprocess.run(command,cwd=work,env=env,capture_output=True,text=True)
    assert result.returncode==0
    assert 'Không có thay đổi' in result.stdout
    if reject:
        hook=remote/'hooks/pre-receive';hook.write_text('#!/bin/sh\nexit 1\n');hook.chmod(0o755)
    (work/'state.json').write_text('{"done":true}')
    result=subprocess.run(command,cwd=work,env=env,capture_output=True,text=True)
    assert (result.returncode!=0)==reject
