"""Công cụ cho agent (function calling) — giới hạn trong worktree, không có shell tuỳ ý.

Rào chắn:
- Đường dẫn phải nằm trong worktree; cấm `.git/`, file secret, `node_modules/`.
- Ghi bị cấm thêm ở `.github/workflows/`, `tools/swarm/`, `.openhands/`, `wrangler.jsonc`.
- Chỉ chạy được các cổng kiểm tra cố định (CHECKS). Tiến trình con nhận biến môi trường
  đã lọc (không API key / token Cloudflare) và HOME/APPDATA trỏ vào thư mục tạm, nên
  không đọc được phiên đăng nhập wrangler / gh trên máy.
LƯU Ý: chạy test = chạy code do agent viết. Đây là phòng thủ nhiều lớp, không thay
cho việc bạn review diff trước khi push.
"""
from __future__ import annotations

import fnmatch
import os
import re
import shutil
import site
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath

MAX_RESULT_CHARS = 20_000
MAX_READ_LINES = 800
CHECK_TIMEOUT_S = 900

SECRET_NAMES = {
    ".env", ".env.swarm", ".dev.vars", "credentials.json", "key_status.json", "token.json",
    ".npmrc", ".pypirc", "id_rsa", "id_ed25519",
}
DENY_ALL_PREFIXES = (".git/", "node_modules/", "frontend/node_modules/", ".swarm/", "tools/private/")
DENY_WRITE_PREFIXES = (".github/workflows/", "tools/swarm/", ".openhands/", ".claude/settings")
DENY_WRITE_FILES = {"wrangler.jsonc", "wrangler.toml", "deploy.bat", "package-lock.json"}


class SandboxError(Exception):
    pass


def _is_secret(rel: str) -> bool:
    name = PurePosixPath(rel).name.lower()  # Windows không phân biệt hoa/thường (.ENV == .env)
    if name in SECRET_NAMES:
        return True
    # .env.local, .env.production … (nhưng cho phép *.example)
    return name.startswith(".env.") and not name.endswith(".example")


def sanitized_env(sandbox_home: Path) -> dict[str, str]:
    keep = {
        "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "OS",
        "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "LANG", "LC_ALL", "TZ",
        "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "COMMONPROGRAMFILES",
        "NVM_HOME", "NVM_SYMLINK", "VOLTA_HOME",
    }
    env = {k: v for k, v in os.environ.items() if k.upper() in keep}
    real_home = Path.home()
    npm_cache = os.environ.get("npm_config_cache") or (
        str(Path(os.environ["LOCALAPPDATA"]) / "npm-cache") if os.environ.get("LOCALAPPDATA")
        else str(real_home / ".npm")
    )
    home = str(sandbox_home)
    env.update({
        "HOME": home, "USERPROFILE": home, "APPDATA": home, "LOCALAPPDATA": home,
        "XDG_CONFIG_HOME": home, "TEMP": home, "TMP": home, "TMPDIR": home,
        "npm_config_cache": npm_cache,                 # giữ cache npm để cài nhanh
        "PYTHONUSERBASE": site.getuserbase() or "",    # vẫn import được gói pip --user
        "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1",
        "CI": "1", "FORCE_COLOR": "0", "NO_COLOR": "1",
        "WRANGLER_SEND_METRICS": "false",
    })
    return env


def _which(cmd: str) -> str:
    path = shutil.which(cmd)
    if not path:
        raise SandboxError(f"Không tìm thấy '{cmd}' trong PATH")
    return path


def _checks() -> dict[str, dict]:
    return {
        "lint": {"desc": "ESLint frontend (--max-warnings 0) + node --check src/index.js",
                 "argv": lambda: [_which("npm"), "run", "lint"], "needs": ["frontend"]},
        "test_frontend": {"desc": "Unit test frontend (node --test)",
                          "argv": lambda: [_which("npm"), "run", "test:frontend"], "needs": ["frontend"]},
        "test_worker": {"desc": "Test Worker + D1/R2 local (miniflare)",
                        "argv": lambda: [_which("npm"), "run", "test:worker"], "needs": ["root"]},
        "test_python": {"desc": "pytest -q",
                        "argv": lambda: [sys.executable, "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider"], "needs": []},
        "build_frontend": {"desc": "Vite build frontend",
                           "argv": lambda: [_which("npm"), "run", "build", "--prefix", "frontend"], "needs": ["frontend"]},
    }


CHECK_NAMES = tuple(_checks().keys())


class Sandbox:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self._home = Path(tempfile.mkdtemp(prefix="swarm-home-"))
        self.changed: set[str] = set()

    # ------------------------------------------------------------ paths
    def rel(self, path: str) -> str:
        if not path or "\x00" in path:
            raise SandboxError("Đường dẫn rỗng/không hợp lệ")
        p = Path(path)
        full = (p if p.is_absolute() else self.root / p).resolve()
        try:
            rel = full.relative_to(self.root).as_posix()
        except ValueError:
            raise SandboxError(f"Ngoài worktree: {path}") from None
        if rel == ".":
            return ""
        check = (rel + ("/" if full.is_dir() else "")).lower()
        if any(check.startswith(pfx.lower()) or ("/" + pfx.lower()) in "/" + check for pfx in DENY_ALL_PREFIXES):
            raise SandboxError(f"Cấm truy cập: {rel}")
        if _is_secret(rel):
            raise SandboxError(f"Cấm truy cập file secret: {rel}")
        return rel

    def _writable(self, path: str) -> Path:
        rel = self.rel(path)
        if not rel:
            raise SandboxError("Không ghi được vào thư mục gốc")
        low = rel.lower()
        if any(low.startswith(p.lower()) for p in DENY_WRITE_PREFIXES) or low in DENY_WRITE_FILES:
            raise SandboxError(f"Cấm ghi: {rel} (vùng được bảo vệ)")
        return self.root / rel

    # ------------------------------------------------------------ git file list
    def tracked_files(self) -> list[str]:
        # -z: không bị git "quote" đường dẫn có ký tự tiếng Việt/Trung.
        out = subprocess.run(
            [_which("git"), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=self.root, capture_output=True, text=True, encoding="utf-8", errors="replace",
        ).stdout
        files = []
        for f in dict.fromkeys(x for x in out.split("\0") if x):
            try:
                self.rel(f)
            except SandboxError:
                continue
            files.append(f)
        return files

    # ------------------------------------------------------------ tools
    def list_files(self, path: str = "", glob: str | None = None) -> str:
        base = self.rel(path) if path else ""
        files = [f for f in self.tracked_files() if not base or f.startswith(base.rstrip("/") + "/") or f == base]
        if glob:
            files = [f for f in files if fnmatch.fnmatch(f, glob) or fnmatch.fnmatch(PurePosixPath(f).name, glob)]
        head = files[:400]
        more = f"\n…và {len(files) - 400} file nữa" if len(files) > 400 else ""
        return "\n".join(head) + more if head else "(không có file)"

    def read_file(self, path: str, start_line: int = 1, end_line: int | None = None) -> str:
        rel = self.rel(path)
        full = self.root / rel
        if not full.is_file():
            return f"LỖI: không có file {rel}"
        lines = full.read_text(encoding="utf-8", errors="replace").splitlines()
        start = max(1, int(start_line or 1))
        end = min(len(lines), int(end_line) if end_line else start + MAX_READ_LINES - 1, start + MAX_READ_LINES - 1)
        body = "\n".join(f"{i:>5}\t{lines[i - 1]}" for i in range(start, end + 1))
        tail = f"\n(file có {len(lines)} dòng; đọc tiếp bằng start_line={end + 1})" if end < len(lines) else ""
        return f"{rel} (dòng {start}-{end})\n{body}{tail}"

    def search(self, pattern: str, glob: str | None = None) -> str:
        try:
            rx = re.compile(pattern)
        except re.error as e:
            return f"LỖI regex: {e}"
        hits = []
        for f in self.tracked_files():
            if glob and not (fnmatch.fnmatch(f, glob) or fnmatch.fnmatch(PurePosixPath(f).name, glob)):
                continue
            full = self.root / f
            try:
                if full.stat().st_size > 1_000_000:
                    continue
                for n, line in enumerate(full.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                    if rx.search(line):
                        hits.append(f"{f}:{n}: {line.strip()[:200]}")
                        if len(hits) >= 100:
                            return "\n".join(hits) + "\n…(dừng ở 100 kết quả)"
            except OSError:
                continue
        return "\n".join(hits) or "(không tìm thấy)"

    def write_file(self, path: str, content: str) -> str:
        full = self._writable(path)
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8", newline="\n")
        rel = self.rel(path)
        self.changed.add(rel)
        return f"Đã ghi {rel} ({len(content.splitlines())} dòng)"

    def edit_file(self, path: str, old_string: str, new_string: str) -> str:
        full = self._writable(path)
        if not full.is_file():
            return f"LỖI: không có file {path}"
        text = full.read_text(encoding="utf-8")
        n = text.count(old_string) if old_string else 0
        if n != 1:
            return f"LỖI: old_string xuất hiện {n} lần (cần đúng 1). Đọc lại file và lấy đoạn dài hơn."
        full.write_text(text.replace(old_string, new_string, 1), encoding="utf-8", newline="\n")
        rel = self.rel(path)
        self.changed.add(rel)
        return f"Đã sửa {rel}"

    def ensure_deps(self, needs: list[str]) -> str:
        notes = []
        npm = _which("npm")
        if "frontend" in needs and not (self.root / "frontend/node_modules").is_dir():
            r = self._run([npm, "ci", "--prefix", "frontend", "--no-audit", "--no-fund"])
            notes.append(f"npm ci frontend → exit {r[0]}")
        if "root" in needs and not (self.root / "node_modules").is_dir():
            r = self._run([npm, "ci", "--no-audit", "--no-fund"])
            notes.append(f"npm ci root → exit {r[0]}")
        return "; ".join(notes)

    def _run(self, argv: list[str]) -> tuple[int, str]:
        try:
            p = subprocess.run(
                argv, cwd=self.root, env=sanitized_env(self._home), capture_output=True,
                text=True, encoding="utf-8", errors="replace", timeout=CHECK_TIMEOUT_S,
            )
            return p.returncode, (p.stdout or "") + (p.stderr or "")
        except subprocess.TimeoutExpired:
            return 124, f"Quá thời gian {CHECK_TIMEOUT_S}s"
        except OSError as e:
            return 127, f"Không chạy được: {e}"

    def run_check(self, name: str) -> tuple[bool, str]:
        checks = _checks()
        if name not in checks:
            return False, f"LỖI: check '{name}' không tồn tại. Chọn: {', '.join(checks)}"
        c = checks[name]
        try:
            prep = self.ensure_deps(c["needs"])
            code, out = self._run(c["argv"]())
        except SandboxError as e:
            return False, f"LỖI: {e}"
        tail = out[-6000:]
        head = f"[{name}] exit {code}" + (f" ({prep})" if prep else "")
        return code == 0, f"{head}\n{tail}"

    # ------------------------------------------------------------ dispatch
    def execute(self, name: str, args: dict) -> str:
        try:
            if name == "list_files":
                res = self.list_files(args.get("path", ""), args.get("glob"))
            elif name == "read_file":
                res = self.read_file(args["path"], args.get("start_line", 1), args.get("end_line"))
            elif name == "search":
                res = self.search(args["pattern"], args.get("glob"))
            elif name == "write_file":
                res = self.write_file(args["path"], args["content"])
            elif name == "edit_file":
                res = self.edit_file(args["path"], args["old_string"], args["new_string"])
            elif name == "run_check":
                ok, out = self.run_check(args.get("name", ""))
                res = ("PASS\n" if ok else "FAIL\n") + out
            else:
                res = f"LỖI: công cụ '{name}' không tồn tại"
        except SandboxError as e:
            res = f"BỊ CHẶN: {e}"
        except KeyError as e:
            res = f"LỖI: thiếu tham số {e}"
        if len(res) > MAX_RESULT_CHARS:
            res = res[:MAX_RESULT_CHARS] + "\n…(cắt bớt)"
        return res


def _fn(name: str, desc: str, props: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": desc,
        "parameters": {"type": "object", "properties": props, "required": required},
    }}


TOOL_DEFS = {
    "list_files": _fn("list_files", "Liệt kê file trong repo (đã lọc file secret).",
                      {"path": {"type": "string", "description": "Thư mục con, mặc định gốc"},
                       "glob": {"type": "string", "description": "Mẫu glob, vd '*.jsx'"}}, []),
    "read_file": _fn("read_file", f"Đọc file kèm số dòng (tối đa {MAX_READ_LINES} dòng/lần).",
                     {"path": {"type": "string"}, "start_line": {"type": "integer"}, "end_line": {"type": "integer"}},
                     ["path"]),
    "search": _fn("search", "Tìm regex trong các file của repo.",
                  {"pattern": {"type": "string"}, "glob": {"type": "string"}}, ["pattern"]),
    "write_file": _fn("write_file", "Ghi TOÀN BỘ nội dung file (tạo mới hoặc ghi đè).",
                      {"path": {"type": "string"}, "content": {"type": "string"}}, ["path", "content"]),
    "edit_file": _fn("edit_file", "Thay đúng 1 lần old_string bằng new_string (old_string phải duy nhất).",
                     {"path": {"type": "string"}, "old_string": {"type": "string"}, "new_string": {"type": "string"}},
                     ["path", "old_string", "new_string"]),
    "run_check": _fn("run_check", "Chạy một cổng kiểm tra cố định. Không có shell tuỳ ý.",
                     {"name": {"type": "string", "enum": list(CHECK_NAMES)}}, ["name"]),
    "finish": _fn("finish", "Báo đã xong phần việc, kèm tóm tắt thay đổi.",
                  {"summary": {"type": "string"}}, ["summary"]),
}


def tool_defs(names: list[str]) -> list[dict]:
    return [TOOL_DEFS[n] for n in names]
