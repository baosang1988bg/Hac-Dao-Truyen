import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def tmp_repo(tmp_path):
    """Repo git tạm, đủ cấu trúc tối thiểu cho swarm (templates Spec Kit, AGENTS.md…)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "AGENTS.md").write_text("# Agent rules\n", encoding="utf-8")
    (repo / "package.json").write_text('{"name": "demo"}\n', encoding="utf-8")
    (repo / "frontend/src").mkdir(parents=True)
    (repo / "frontend/src/App.jsx").write_text("export default function App() { return null }\n", encoding="utf-8")
    (repo / ".env").write_text("CLOUDFLARE_API_TOKEN=secret\n", encoding="utf-8")
    (repo / ".gitignore").write_text(".env\n.swarm/\n", encoding="utf-8")
    tpl = repo / ".specify/templates"
    tpl.mkdir(parents=True)
    for name in ("spec-template.md", "plan-template.md", "tasks-template.md"):
        src = ROOT / ".specify/templates" / name
        if src.is_file():
            shutil.copy(src, tpl / name)
        else:
            (tpl / name).write_text(f"# {name}\n", encoding="utf-8")
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "add", "-A")
    _git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
    return repo
