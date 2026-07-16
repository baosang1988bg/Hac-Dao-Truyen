"""
routers/novels.py
-----------------
Endpoint quản lý truyện: danh sách, chi tiết, catalog, glossary.
"""

import os
import re
import json
import importlib.util
from typing import Dict

from fastapi import APIRouter, HTTPException, Depends, Header
from fastapi.responses import FileResponse
from pydantic import BaseModel

from novel_manager import load_novel
from auth import require_admin, _is_valid as _is_valid_token
from security_utils import validate_slug, safe_novel_dir

router = APIRouter()

NOVELS_DIR = "novels"

# Các field công khai của novel.json — KHÔNG trả glossary (nặng hàng trăm KB)
# và KHÔNG trả source_url/last_translated_url (lộ nguồn crawl) cho guest.
_PUBLIC_FIELDS = (
    "slug", "title", "original_title", "author", "genre", "notes",
    "total_chapters", "cover_url", "translation_style",
)

_SPLIT_PART_RE = re.compile(r'^(.+)-(\d+)_VI\.md$')


def _is_admin_request(authorization: str) -> bool:
    """Kiểm tra header Authorization có phải token admin hợp lệ (không raise)."""
    if not authorization.startswith("Bearer "):
        return False
    return _is_valid_token(authorization[len("Bearer "):].strip())


def _public_view(data: dict) -> dict:
    """Lọc novel.json về whitelist field công khai."""
    return {k: data.get(k) for k in _PUBLIC_FIELDS if k in data}


def _translated_stats(slug: str) -> dict:
    """
    Thống kê thư mục translated/ của 1 truyện (1 lần listdir):
    - chapter_count: số chương đã dịch (lọc file phần split khi bản merge đã tồn tại)
    - last_translated_at: mtime file mới nhất (epoch, None nếu chưa có)
    - latest_chapter_title: tiêu đề (dòng '# ...') của file mới nhất
    """
    trans_dir = os.path.join(NOVELS_DIR, slug, "translated")
    if not os.path.isdir(trans_dir):
        return {"chapter_count": 0, "last_translated_at": None, "latest_chapter_title": None}

    all_md = set(f for f in os.listdir(trans_dir) if f.endswith("_VI.md"))
    filtered = []
    for f in all_md:
        m = _SPLIT_PART_RE.match(f)
        if m and f"{m.group(1)}_VI.md" in all_md:
            continue  # phần split đã có bản merge → bỏ
        filtered.append(f)

    if not filtered:
        return {"chapter_count": 0, "last_translated_at": None, "latest_chapter_title": None}

    newest, newest_mtime = None, 0.0
    for f in filtered:
        try:
            mt = os.path.getmtime(os.path.join(trans_dir, f))
        except OSError:
            continue
        if mt > newest_mtime:
            newest, newest_mtime = f, mt

    latest_title = None
    if newest:
        latest_title = newest.replace("_VI.md", "")
        try:
            with open(os.path.join(trans_dir, newest), encoding="utf-8") as fh:
                for line in fh.readlines()[:10]:
                    if line.startswith("# "):
                        latest_title = line[2:].strip()
                        break
        except Exception:
            pass

    return {
        "chapter_count": len(filtered),
        "last_translated_at": newest_mtime or None,
        "latest_chapter_title": latest_title,
    }


class GlossaryUpdateRequest(BaseModel):
    glossary: Dict[str, str]


@router.get("/api/novels")
def list_novels():
    """
    Danh sách truyện (public, gọn nhẹ):
    chỉ field whitelist + số liệu thật (chapter_count, last_translated_at,
    latest_chapter_title, glossary_count). KHÔNG trả glossary/source_url.
    """
    if not os.path.exists(NOVELS_DIR):
        return []

    novels = []
    for slug in sorted(os.listdir(NOVELS_DIR)):
        json_path = os.path.join(NOVELS_DIR, slug, "novel.json")
        if not os.path.isfile(json_path):
            continue
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError:
            continue
        item = _public_view(data)
        item["slug"] = item.get("slug") or slug
        item["glossary_count"] = len(data.get("glossary", {}) or {})
        item.update(_translated_stats(slug))
        novels.append(item)
    return novels


@router.get("/api/novels/{slug}")
def get_novel(slug: str, authorization: str = Header(default="")):
    """
    Chi tiết truyện.
    Guest: chỉ field công khai + thống kê. Admin (Bearer hợp lệ): full novel.json
    (gồm glossary — cần cho trang quản trị).
    """
    validate_slug(slug)
    json_path = os.path.join(NOVELS_DIR, slug, "novel.json")
    if not os.path.isfile(json_path):
        raise HTTPException(status_code=404, detail="Novel not found")
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if _is_admin_request(authorization):
        data.setdefault("slug", slug)
        data.update(_translated_stats(slug))
        data["glossary_count"] = len(data.get("glossary", {}) or {})
        return data

    item = _public_view(data)
    item["slug"] = item.get("slug") or slug
    item["glossary_count"] = len(data.get("glossary", {}) or {})
    item.update(_translated_stats(slug))
    return item


@router.post("/api/novels/{slug}/glossary", dependencies=[Depends(require_admin)])
def update_glossary(slug: str, req: GlossaryUpdateRequest):
    """Cập nhật từ điển. (admin)"""
    validate_slug(slug)
    try:
        profile = load_novel(slug)
        profile.glossary = req.glossary
        profile.save()
        return {"status": "success", "message": "Glossary updated"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Novel not found")


@router.get("/api/novels/{slug}/epub")
def download_epub(slug: str):
    """
    Tải EPUB của truyện (public) — roadmap 2.2.

    Cache tại novels/<slug>/book.epub; tự build lại (ebooklib) khi chưa có
    hoặc khi translated/ có file mới hơn file EPUB đã build.
    """
    validate_slug(slug)
    novel_dir = os.path.join(NOVELS_DIR, slug)
    if not os.path.isfile(os.path.join(novel_dir, "novel.json")):
        raise HTTPException(status_code=404, detail="Novel not found")

    trans_dir = os.path.join(novel_dir, "translated")
    md_files = (
        [os.path.join(trans_dir, f) for f in os.listdir(trans_dir) if f.endswith(".md")]
        if os.path.isdir(trans_dir) else []
    )
    if not md_files:
        raise HTTPException(status_code=404, detail="Truyện chưa có chương dịch nào")

    newest_mtime = 0.0
    for p in md_files:
        try:
            newest_mtime = max(newest_mtime, os.path.getmtime(p))
        except OSError:
            continue

    epub_path = os.path.join(novel_dir, "book.epub")
    stale = (not os.path.isfile(epub_path)) or os.path.getmtime(epub_path) < newest_mtime
    if stale:
        if importlib.util.find_spec("ebooklib") is None:
            raise HTTPException(
                status_code=503,
                detail="Chưa cài ebooklib nên không build được EPUB — chạy `pip install ebooklib` rồi thử lại.",
            )
        try:
            from tools.build_epub import build_novel_epub
            build_novel_epub(slug, novels_dir=NOVELS_DIR, out_path=epub_path,
                             prefer_ebooklib=True, quiet=True)
        except (FileNotFoundError, RuntimeError) as e:
            raise HTTPException(status_code=404, detail=f"Không build được EPUB: {e}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Build EPUB lỗi: {e}")

    # Filename đẹp: "<Title> (<N> chuong).epub"
    title = slug
    try:
        with open(os.path.join(novel_dir, "novel.json"), encoding="utf-8") as f:
            title = json.load(f).get("title") or slug
    except Exception:
        pass
    n_chapters = _translated_stats(slug)["chapter_count"]
    filename = f"{title} ({n_chapters} chuong).epub"

    return FileResponse(epub_path, media_type="application/epub+zip", filename=filename)


@router.get("/api/novels/{slug}/catalog")
def get_novel_catalog(slug: str):
    """Lấy danh sách catalog chương của truyện từ catalog.json."""
    catalog_path = os.path.join(safe_novel_dir(slug), "catalog.json")
    if not os.path.exists(catalog_path):
        return []
    try:
        with open(catalog_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading catalog: {e}")
