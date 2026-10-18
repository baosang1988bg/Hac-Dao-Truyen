"""Git worktree riêng cho mỗi run: không đụng working tree của người dùng, không có .env."""
from __future__ import annotations

import re
import shutil
import subprocess
import unicodedata
from dataclasses import dataclass
from pathlib import Path


class GitError(Exception):
    pass


def git(cwd: Path, *args: str, check: bool = True) -> str:
    exe = shutil.which("git")
    if not exe:
        raise GitError("Không tìm thấy git trong PATH")
    p = subprocess.run([exe, "-c", "core.quotepath=off", "-c", "core.longpaths=true", *args], cwd=cwd, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise GitError(f"git {' '.join(args)}: {p.stderr.strip() or p.stdout.strip()}")
    return p.stdout


def slugify(text: str, max_len: int = 40) -> str:
    text = text.replace("đ", "d").replace("Đ", "D")
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    text = text[:max_len].rstrip("-")
    return text or "feature"


def next_feature_number(repo: Path) -> int:
    nums = [0]
    specs = repo / "specs"
    if specs.is_dir():
        for d in specs.iterdir():
            m = re.match(r"^(\d{3})-", d.name)
            if d.is_dir() and m:
                nums.append(int(m.group(1)))
    # Nhánh feature/NNN-* đã tồn tại (kể cả của run trước chưa merge) cũng tính.
    for line in git(repo, "branch", "--list", "--all", check=False).splitlines():
        m = re.search(r"/(\d{3})-", line)
        if m:
            nums.append(int(m.group(1)))
    return max(nums) + 1


@dataclass
class Workspace:
    repo: Path          # repo gốc của người dùng
    path: Path          # worktree của run
    branch: str
    feature: str        # "NNN-slug"
    base_ref: str

    @property
    def spec_dir(self) -> Path:
        return self.path / "specs" / self.feature

    def diff(self, stat: bool = False) -> str:
        git(self.path, "add", "-A", "-N")  # intent-to-add để diff thấy file mới
        args = ["diff", "--no-color", self.base_ref]
        if stat:
            args.append("--stat")
        return git(self.path, *args)

    def changed_files(self) -> list[str]:
        git(self.path, "add", "-A", "-N")
        return [f for f in git(self.path, "diff", "--name-only", self.base_ref).splitlines() if f]

    def commit(self, message: str) -> str | None:
        git(self.path, "add", "-A")
        if not git(self.path, "status", "--porcelain").strip():
            return None
        git(self.path, "-c", "user.name=speckit-swarm", "-c", "user.email=speckit-swarm@local",
            "commit", "-q", "-m", message)
        return git(self.path, "rev-parse", "--short", "HEAD").strip()


def create_workspace(repo: Path, request: str, worktree_root: str, branch_prefix: str,
                     base_ref: str = "HEAD") -> Workspace:
    repo = Path(git(repo, "rev-parse", "--show-toplevel").strip())
    base = git(repo, "rev-parse", "--verify", base_ref).strip()
    num = next_feature_number(repo)
    feature = f"{num:03d}-{slugify(request)}"
    branch = f"{branch_prefix}{feature}"
    root = (repo / worktree_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    path = root / feature
    if path.exists():
        raise GitError(f"Thư mục worktree đã tồn tại: {path}")
    git(repo, "worktree", "add", "-q", "-b", branch, str(path), base)
    return Workspace(repo=repo, path=path, branch=branch, feature=feature, base_ref=base)
