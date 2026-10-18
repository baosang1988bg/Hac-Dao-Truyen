"""Đóng gói ngữ cảnh codebase cho Spec Lead / Architect, có trần token."""
from __future__ import annotations

import re
from collections import Counter
from pathlib import PurePosixPath

from tools.swarm.sandbox import Sandbox
from tools.swarm.workspace import slugify

NOISY_PREFIXES = ("novels/", "AgentReach/", "scratch/", "plans/", "offline_reading/", "extension/")
SKIP_SUFFIXES = (".lock", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".epub", ".zip",
                 ".pdf", ".woff", ".woff2", ".ttf", ".db", ".sqlite", ".mbox")
SKIP_NAMES = {"package-lock.json"}
ALWAYS = ["AGENTS.md", ".specify/memory/constitution.md", "package.json", "frontend/package.json",
          "wrangler.jsonc"]
MAX_FILE_CHARS = 60_000
CHARS_PER_TOKEN = 3


def is_noisy(path: str) -> bool:
    return path.startswith(NOISY_PREFIXES) or path.endswith(SKIP_SUFFIXES) or PurePosixPath(path).name in SKIP_NAMES


def repo_map(sb: Sandbox) -> str:
    files = sb.tracked_files()
    noisy = Counter(f.split("/", 1)[0] for f in files if f.startswith(NOISY_PREFIXES))
    lines = [f for f in files if not is_noisy(f)]
    extra = "\n".join(f"{d}/ … ({n} file, bỏ qua)" for d, n in sorted(noisy.items()))
    return "\n".join(lines) + ("\n" + extra if extra else "")


def _keywords(text: str) -> set[str]:
    words = set(re.findall(r"[a-z0-9]{3,}", slugify(text, 400).replace("-", " ")))
    words |= set(w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9_]{2,}", text))
    stop = {"the", "and", "cho", "cua", "voi", "trong", "khi", "mot", "nhung", "duoc", "them", "tren", "trang"}
    return words - stop


def pack_context(sb: Sandbox, query: str, budget_tokens: int) -> tuple[str, list[str]]:
    """Trả về (khối văn bản ngữ cảnh, danh sách file đã đưa vào)."""
    if budget_tokens <= 0:
        return "", []
    budget_chars = budget_tokens * CHARS_PER_TOKEN
    files = [f for f in sb.tracked_files() if not is_noisy(f)]
    kws = _keywords(query)
    scored: list[tuple[float, str]] = []
    for f in files:
        full = sb.root / f
        try:
            if full.stat().st_size > MAX_FILE_CHARS * 2:
                continue
            text = full.read_text(encoding="utf-8", errors="ignore").lower()
        except OSError:
            continue
        path_l = f.lower()
        score = sum(5 for k in kws if k in path_l) + sum(min(text.count(k), 5) for k in kws)
        if score:
            scored.append((score / (1 + len(text) / 20_000), f))
    scored.sort(reverse=True)
    order = [f for f in ALWAYS if f in files] + [f for _, f in scored if f not in ALWAYS]
    out, used, total = [], [], 0
    for f in order:
        text = (sb.root / f).read_text(encoding="utf-8", errors="replace")[:MAX_FILE_CHARS]
        block = f"\n===== FILE: {f} =====\n{text}\n"
        if total + len(block) > budget_chars:
            continue
        out.append(block)
        used.append(f)
        total += len(block)
    return "".join(out), used
