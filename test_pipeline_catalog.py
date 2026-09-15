"""
test_pipeline_catalog.py
------------------------
Tái hiện lỗi production (2026-09-15): pipeline.init_catalog() crash với
KeyError 'url' khi catalog.json của truyện có mục KHÔNG có field "url" —
đúng tình trạng thật của novels/lanh-chua-cau-sinh-thien-phu-hop-thanh/catalog.json
(được khôi phục từ file .md đã dịch sẵn, không còn URL nguồn gốc).

Không gọi AI/mạng thật: chỉ gọi thẳng pipeline.init_catalog() với catalog.json
giả lập trên đĩa (isolated_app tự cô lập NOVELS_BASE_DIR — xem conftest.py).
"""
import argparse
import json
import logging
import os

import novel_manager
import pipeline


def _make_profile(slug="catalog-no-url-novel"):
    profile = novel_manager.create_novel(
        "Catalog No URL Novel", "https://example.com/novel/1", slug=slug
    )
    profile.update_progress("https://example.com/novel/chuong-5", 5)
    return profile


def _make_ctx(profile):
    args = argparse.Namespace(chapters=6, url=None)
    logger = logging.getLogger("test-pipeline-catalog")
    return pipeline.TranslationContext(
        args=args, profile=profile, logger=logger, translator=None,
        report_progress=lambda *a, **k: None, is_cancelled=lambda: False,
    )


def _write_catalog(slug, items):
    path = os.path.join("novels", slug, "catalog.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)


def test_catalog_thieu_url_khong_crash_va_fallback_dynamic():
    profile = _make_profile()
    _write_catalog(profile.slug, [
        {"number": 1, "title": "Chương 1", "filename": "0001_VI.md", "chapter_number": 1},
        {"number": 2, "title": "Chương 2", "filename": "0002_VI.md", "chapter_number": 2},
    ])
    ctx = _make_ctx(profile)

    pipeline.init_catalog(ctx, start_url=profile.last_translated_url)

    assert ctx.catalog_active is False
    assert ctx.current_url == profile.last_translated_url


def test_catalog_co_du_url_van_resume_dung_nhu_truoc():
    profile = _make_profile()
    _write_catalog(profile.slug, [
        {"number": 5, "title": "Chương 5", "url": "https://example.com/novel/chuong-5"},
        {"number": 6, "title": "Chương 6", "url": "https://example.com/novel/chuong-6"},
    ])
    ctx = _make_ctx(profile)

    pipeline.init_catalog(ctx, start_url=profile.last_translated_url)

    assert ctx.catalog_active is True
    assert ctx.current_url == "https://example.com/novel/chuong-6"
