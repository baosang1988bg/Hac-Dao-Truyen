"""
test_pipeline_catalog.py
------------------------
Tái hiện lỗi production (2026-09-15): pipeline.init_catalog() crash với
KeyError 'url' khi catalog.json của truyện có mục KHÔNG có field "url" —
đúng tình trạng thật của novels/lanh-chua-cau-sinh-thien-phu-hop-thanh/catalog.json
(được khôi phục ngày 01/09 từ file .md đã dịch sẵn, không còn URL nguồn gốc).

auto_check_lanh_chua.py tự APPEND các chương mới phát hiện (CÓ url thật) vào
cuối catalog cũ trước khi gọi translate — nên catalog thực tế là hỗn hợp: phần
lớn mục cũ thiếu "url", vài mục mới nhất có "url". Fix phải xử lý an toàn từng
mục (không crash) mà KHÔNG vứt bỏ luôn các mục mới hợp lệ.

Không gọi AI/mạng thật: chỉ gọi thẳng pipeline.init_catalog() với catalog.json
giả lập trên đĩa (isolated_app tự cô lập NOVELS_BASE_DIR — xem conftest.py).
"""
import argparse
import json
import logging
import os

import novel_manager
import pipeline


def _make_profile(slug="catalog-no-url-novel", last_chapter_number=5):
    profile = novel_manager.create_novel(
        "Catalog No URL Novel", "https://example.com/novel/1", slug=slug
    )
    profile.update_progress("https://example.com/novel/chuong-5", last_chapter_number)
    return profile


def _make_ctx(profile, chapters=6):
    args = argparse.Namespace(chapters=chapters, url=None)
    logger = logging.getLogger("test-pipeline-catalog")
    return pipeline.TranslationContext(
        args=args, profile=profile, logger=logger, translator=None,
        report_progress=lambda *a, **k: None, is_cancelled=lambda: False,
    )


def _write_catalog(slug, items):
    path = os.path.join("novels", slug, "catalog.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False)


def test_catalog_toan_bo_thieu_url_khong_crash_va_khong_co_url_de_di_tiep():
    """Không tìm được url/number khớp -> không crash, chỉ đơn giản không có
    current_url để dịch tiếp (an toàn hơn KeyError, dù không dịch được gì)."""
    profile = _make_profile(last_chapter_number=999)
    _write_catalog(profile.slug, [
        {"number": 1, "title": "Chương 1", "filename": "0001_VI.md", "chapter_number": 1},
        {"number": 2, "title": "Chương 2", "filename": "0002_VI.md", "chapter_number": 2},
    ])
    ctx = _make_ctx(profile)

    pipeline.init_catalog(ctx, start_url=profile.last_translated_url)

    assert ctx.current_url is None


def test_catalog_hon_hop_muc_cu_thieu_url_va_muc_moi_co_url_resume_dung_theo_so_chuong():
    """Kịch bản thật: 1505 đã dịch (không có url trong catalog cũ), 1506 vừa
    được auto_check_lanh_chua.py append kèm url thật -> phải khớp theo SỐ
    CHƯƠNG (last_chapter_number) và resume đúng vào entry 1506."""
    profile = _make_profile(last_chapter_number=1505)
    _write_catalog(profile.slug, [
        {"number": 1504, "title": "Chương 1504", "filename": "1504_VI.md"},
        {"number": 1505, "title": "Chương 1505", "filename": "1505_VI.md"},
        {"number": 1506, "title": "Chương 1506", "url": "https://www.novel543.com/x/1506.html"},
    ])
    ctx = _make_ctx(profile)

    pipeline.init_catalog(ctx, start_url=profile.last_translated_url)

    assert ctx.catalog_active is True
    assert ctx.current_url == "https://www.novel543.com/x/1506.html"


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
