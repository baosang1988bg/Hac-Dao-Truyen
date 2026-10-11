#!/usr/bin/env python3
"""Backup raw chapters from a project's Novel543 catalog through Jina Reader.

The downloader deliberately keeps two layers:
  * raw_pages/: byte-for-byte Markdown returned by Jina Reader;
  * chapters/: merged, readable chapter text with pagination/footer noise removed.

It never translates or overwrites the source catalog. Progress is resumable via
state.json and every artifact is checksummed in manifest.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse


JINA_PREFIX = "https://r.jina.ai/"
PAGINATION_RE = re.compile(
    r"\s*[\(（]\s*(\d+)\s*/\s*(\d+)\s*[\)）]\s*$"
)
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
RETRYABLE_HTTP_CODES = {429, 500, 502, 503, 504}
FOOTER_PREFIXES = (
    "溫馨提示:",
    "温馨提示:",
    "溫馨提示：",
    "温馨提示：",
)


class BackupError(RuntimeError):
    """A chapter could not be downloaded or validated."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def encode_json(data: Any) -> bytes:
    return (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with open(temp, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_novel543_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in {
        "novel543.com",
        "www.novel543.com",
    }:
        raise BackupError(f"URL không thuộc Novel543 HTTPS: {url}")
    if not re.fullmatch(r"/\d+/[^/]+_\d+(?:_\d+)?\.html", parsed.path):
        raise BackupError(f"URL chương Novel543 không hợp lệ: {url}")


def page_url(base_url: str, page_number: int) -> str:
    """Construct Novel543 page N from the canonical page-1 URL."""
    validate_novel543_url(base_url)
    if page_number < 1:
        raise ValueError("page_number phải >= 1")
    if page_number == 1:
        return base_url
    return re.sub(r"\.html$", f"_{page_number}.html", base_url)


@dataclass(frozen=True)
class ParsedPage:
    title: str
    clean_title: str
    page_number: int
    total_pages: int
    content: str


def parse_jina_page(raw: bytes) -> ParsedPage:
    text = raw.decode("utf-8")
    lines = text.splitlines()
    title = ""
    marker_index = -1
    for index, line in enumerate(lines):
        if line.startswith("Title:") and not title:
            title = line.removeprefix("Title:").strip()
        if line.strip() == "Markdown Content:":
            marker_index = index
            break

    if not title or marker_index < 0:
        raise BackupError("Jina response thiếu Title hoặc Markdown Content")

    pagination = PAGINATION_RE.search(title)
    if pagination:
        page_number = int(pagination.group(1))
        total_pages = int(pagination.group(2))
        clean_title = PAGINATION_RE.sub("", title).strip()
    else:
        page_number = total_pages = 1
        clean_title = title.strip()

    body_lines = lines[marker_index + 1 :]
    while body_lines and not body_lines[0].strip():
        body_lines.pop(0)
    while body_lines and not body_lines[-1].strip():
        body_lines.pop()
    while body_lines and body_lines[-1].strip().startswith(FOOTER_PREFIXES):
        body_lines.pop()
        while body_lines and not body_lines[-1].strip():
            body_lines.pop()

    # Some readers prepend the title as a Markdown heading inside the body.
    if body_lines and re.sub(r"^#{1,6}\s*", "", body_lines[0]).strip() == clean_title:
        body_lines.pop(0)
        while body_lines and not body_lines[0].strip():
            body_lines.pop(0)

    content = "\n".join(body_lines).strip()
    if len(content) < 100:
        raise BackupError(f"Nội dung chương quá ngắn ({len(content)} ký tự)")
    if total_pages < page_number:
        raise BackupError(f"Phân trang không hợp lệ: {page_number}/{total_pages}")

    return ParsedPage(
        title=title,
        clean_title=clean_title,
        page_number=page_number,
        total_pages=total_pages,
        content=content,
    )


class JinaClient:
    def __init__(
        self,
        *,
        delay: float = 1.0,
        timeout: float = 40.0,
        retries: int = 4,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if delay < 0:
            raise ValueError("delay phải >= 0")
        if retries < 1:
            raise ValueError("retries phải >= 1")
        self.delay = delay
        self.timeout = timeout
        self.retries = retries
        self._sleep = sleep
        self._last_request_at = 0.0

    def _wait(self) -> None:
        remaining = self.delay - (time.monotonic() - self._last_request_at)
        if remaining > 0:
            self._sleep(remaining)

    def get(self, source_url: str) -> bytes:
        validate_novel543_url(source_url)
        request_url = JINA_PREFIX + source_url
        last_error: Exception | None = None
        for attempt in range(1, self.retries + 1):
            self._wait()
            request = urllib.request.Request(
                request_url,
                headers={
                    "Accept": "text/markdown,text/plain;q=0.9,*/*;q=0.1",
                    "User-Agent": "HacDaoTruyen-Novel543-Archive/0.1",
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    raw = response.read()
                self._last_request_at = time.monotonic()
                parse_jina_page(raw)
                return raw
            except urllib.error.HTTPError as exc:
                self._last_request_at = time.monotonic()
                last_error = exc
                if exc.code not in RETRYABLE_HTTP_CODES or attempt == self.retries:
                    raise BackupError(f"HTTP {exc.code} cho {source_url}") from exc
            except (urllib.error.URLError, TimeoutError, UnicodeDecodeError, BackupError) as exc:
                self._last_request_at = time.monotonic()
                last_error = exc
                if attempt == self.retries:
                    raise BackupError(f"Không đọc được {source_url}: {exc}") from exc
            self._sleep(min(30.0, 2 ** (attempt - 1) + random.random()))
        raise BackupError(f"Không đọc được {source_url}: {last_error}")


def load_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def load_state(path: Path) -> dict[str, Any]:
    if path.is_file():
        state = load_json(path)
    else:
        state = {
            "schema_version": 1,
            "created_at": utc_now(),
            "completed_chapter_numbers": [],
            "failures": {},
        }
    state.setdefault("completed_chapter_numbers", [])
    state.setdefault("failures", {})
    return state


def download_chapter(
    client: JinaClient,
    output: Path,
    item: dict[str, Any],
) -> dict[str, Any]:
    chapter_number = int(item["number"])
    source_url = str(item["url"])
    first_raw = client.get(source_url)
    first = parse_jina_page(first_raw)
    if first.page_number != 1:
        raise BackupError(f"Trang đầu báo phân trang {first.page_number}/{first.total_pages}")

    raw_pages = [first_raw]
    parts = [first.content]
    for page_number in range(2, first.total_pages + 1):
        current_raw = client.get(page_url(source_url, page_number))
        current = parse_jina_page(current_raw)
        if current.page_number != page_number or current.total_pages != first.total_pages:
            raise BackupError(
                f"Sai phân trang ở chương {chapter_number}: "
                f"nhận {current.page_number}/{current.total_pages}"
            )
        if current.clean_title != first.clean_title:
            raise BackupError(
                f"Sai tiêu đề trang {page_number}: {current.clean_title!r} "
                f"!= {first.clean_title!r}"
            )
        raw_pages.append(current_raw)
        parts.append(current.content)

    raw_dir = output / "raw_pages" / f"{chapter_number:04d}"
    for index, raw in enumerate(raw_pages, start=1):
        atomic_write(raw_dir / f"page-{index}.md", raw)

    merged = f"{first.clean_title}\n\n" + "\n\n".join(parts).strip() + "\n"
    chapter_path = output / "chapters" / f"{chapter_number:04d}.txt"
    atomic_write(chapter_path, merged.encode("utf-8"))
    return {
        "number": chapter_number,
        "original_chapter_number": item.get("original_chapter_number"),
        "title": first.clean_title,
        "source_url": source_url,
        "pages": first.total_pages,
        "characters": len(merged),
        "path": chapter_path.relative_to(output).as_posix(),
    }


def build_manifest(output: Path, summary: dict[str, Any]) -> dict[str, Any]:
    files = []
    for path in sorted(output.rglob("*")):
        if not path.is_file() or path.name.endswith(".tmp") or path.name == "manifest.json":
            continue
        raw = path.read_bytes()
        files.append(
            {
                "path": path.relative_to(output).as_posix(),
                "size": len(raw),
                "sha256": sha256_bytes(raw),
            }
        )
    return {
        "schema_version": 1,
        "generated_at": utc_now(),
        "scope": "public Novel543 chapter pages via Jina Reader",
        **summary,
        "files": files,
    }


def backup(
    *,
    slug: str,
    output: Path,
    client: JinaClient,
    start: int = 1,
    max_chapters: int = 3,
    resume: bool = True,
) -> dict[str, Any]:
    if not SLUG_RE.fullmatch(slug):
        raise ValueError("slug chỉ được chứa a-z, 0-9 và dấu gạch ngang")
    if start < 1 or max_chapters < 0:
        raise ValueError("start phải >= 1 và max_chapters phải >= 0")

    novel_dir = Path("novels") / slug
    novel_path = novel_dir / "novel.json"
    catalog_path = novel_dir / "catalog.json"
    if not novel_path.is_file() or not catalog_path.is_file():
        raise BackupError(f"Thiếu novel.json hoặc catalog.json cho slug {slug}")

    novel = load_json(novel_path)
    catalog = load_json(catalog_path)
    if not isinstance(catalog, list) or not catalog:
        raise BackupError("catalog.json rỗng hoặc sai định dạng")

    output.mkdir(parents=True, exist_ok=True)
    atomic_write(output / "novel.json", encode_json(novel))
    atomic_write(output / "catalog.json", encode_json(catalog))

    state_path = output / "state.json"
    state = load_state(state_path) if resume else load_state(Path("/nonexistent"))
    completed = {int(number) for number in state["completed_chapter_numbers"]}
    downloaded_this_run = 0

    for item in catalog:
        number = int(item["number"])
        if number < start or number in completed:
            continue
        if max_chapters and downloaded_this_run >= max_chapters:
            break
        try:
            chapter_meta = download_chapter(client, output, item)
            atomic_write(
                output / "chapter_meta" / f"{number:04d}.json",
                encode_json(chapter_meta),
            )
            completed.add(number)
            state["failures"].pop(str(number), None)
            downloaded_this_run += 1
            print(
                f"[✓] {number}/{len(catalog)} — {chapter_meta['title']} "
                f"({chapter_meta['pages']} trang)"
            )
        except BackupError as exc:
            state["failures"][str(number)] = str(exc)
            print(f"[!] Chương {number} thất bại: {exc}")
        finally:
            state["completed_chapter_numbers"] = sorted(completed)
            state["updated_at"] = utc_now()
            atomic_write(state_path, encode_json(state))

    summary = {
        "source": novel.get("source_url"),
        "novel": {
            "slug": slug,
            "title": novel.get("title"),
            "author": novel.get("author"),
        },
        "catalog_entries": len(catalog),
        "downloaded_this_run": downloaded_this_run,
        "completed_total": len(completed),
        "failure_total": len(state["failures"]),
    }
    manifest = build_manifest(output, summary)
    atomic_write(output / "manifest.json", encode_json(manifest))
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backup raw Novel543 chapters through Jina Reader",
    )
    parser.add_argument("--slug", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument(
        "--max-chapters",
        type=int,
        default=3,
        help="Số chương mới tối đa trong lượt này; 0 = toàn bộ phần còn lại",
    )
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=40.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--no-resume", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = args.output or Path("backups") / "novel543" / args.slug
    client = JinaClient(
        delay=args.delay,
        timeout=args.timeout,
        retries=args.retries,
    )
    try:
        manifest = backup(
            slug=args.slug,
            output=output.resolve(),
            client=client,
            start=args.start,
            max_chapters=args.max_chapters,
            resume=not args.no_resume,
        )
    except (BackupError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"[!] Backup thất bại: {exc}")
        return 1

    print(f"[✓] Hoàn tất lượt backup: {manifest['novel']['title']}")
    print(f"    Mới tải: {manifest['downloaded_this_run']}")
    print(f"    Tổng đã lưu: {manifest['completed_total']}/{manifest['catalog_entries']}")
    print(f"    Thất bại đang chờ retry: {manifest['failure_total']}")
    print(f"    Output: {output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
