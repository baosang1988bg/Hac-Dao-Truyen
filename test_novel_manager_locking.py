"""
test_novel_manager_locking.py
------------------------------
TDD cho D03: ghi profile (novel.json) an toàn khi đọc-sửa-ghi đồng thời.

Các test này mô phỏng 2 thread/process cùng load_novel() -> sửa field khác
nhau trong bộ nhớ -> save(), và xác nhận:
  1. Không mất update (lost update) khi 2 bên sửa 2 field khác nhau.
  2. File không hỏng nếu crash giữa chừng lúc ghi (mock exception sau khi mở
     file tạm, trước khi os.replace()).
  3. Field JSON lạ (không có trong schema NovelProfile) được bảo toàn qua các
     lần đọc-sửa-ghi một phần.
  4. create_novel() không tạo ra 2 profile trùng slug khi gọi đồng thời.

Chạy trên tmp_path (qua conftest.isolated_app tự động trỏ NOVELS_BASE_DIR),
không đụng novels/ thật.
"""
import json
import os
import threading
import multiprocessing
import time

import pytest

import novel_manager
from novel_manager import create_novel, load_novel, NovelProfile


def _worker_update_progress(base_dir, slug, url, chapter, barrier):
    """Chạy trong thread/process riêng: load -> sửa progress -> save."""
    import novel_manager as nm
    nm.NOVELS_BASE_DIR = base_dir
    profile = nm.load_novel(slug)
    barrier.wait()  # đồng bộ để đảm bảo cả 2 bên đã load TRƯỚC khi bên nào save
    profile.last_translated_url = url
    profile.last_chapter_number = chapter
    profile.save()


def _worker_add_glossary(base_dir, slug, term, translated, barrier):
    """Chạy trong thread/process riêng: load -> thêm glossary -> save."""
    import novel_manager as nm
    nm.NOVELS_BASE_DIR = base_dir
    profile = nm.load_novel(slug)
    barrier.wait()
    profile.glossary[term] = translated
    profile.save()


class TestConcurrentUpdateNoLostUpdate:
    def test_two_threads_different_fields_no_lost_update(self):
        create_novel(title="Concurrent", source_url="url", slug="concurrent")
        base_dir = novel_manager.NOVELS_BASE_DIR
        barrier = threading.Barrier(2)

        t1 = threading.Thread(
            target=_worker_update_progress,
            args=(base_dir, "concurrent", "http://x/2", 2, barrier),
        )
        t2 = threading.Thread(
            target=_worker_add_glossary,
            args=(base_dir, "concurrent", "Hello", "Xin chao", barrier),
        )
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)
        assert not t1.is_alive() and not t2.is_alive()

        final = load_novel("concurrent")
        # Cả 2 thay đổi trên 2 field khác nhau đều phải còn — không được mất
        # update của bên nào.
        assert final.last_chapter_number == 2
        assert final.last_translated_url == "http://x/2"
        assert final.glossary.get("Hello") == "Xin chao"

    def test_two_processes_different_glossary_keys_no_lost_update(self):
        create_novel(title="Concurrent2", source_url="url", slug="concurrent2")
        base_dir = novel_manager.NOVELS_BASE_DIR
        barrier = multiprocessing.Barrier(2)
        ctx = multiprocessing.get_context("spawn")

        p1 = ctx.Process(
            target=_worker_add_glossary,
            args=(base_dir, "concurrent2", "Alpha", "A", barrier),
        )
        p2 = ctx.Process(
            target=_worker_add_glossary,
            args=(base_dir, "concurrent2", "Beta", "B", barrier),
        )
        p1.start()
        p2.start()
        p1.join(timeout=15)
        p2.join(timeout=15)
        assert p1.exitcode == 0
        assert p2.exitcode == 0

        final = load_novel("concurrent2")
        assert final.glossary.get("Alpha") == "A"
        assert final.glossary.get("Beta") == "B"


class TestCrashDuringWriteLeavesOriginalIntact:
    def test_exception_after_temp_file_before_replace_keeps_original(self, monkeypatch):
        profile = create_novel(title="Crashy", source_url="url", slug="crashy")
        original_bytes = open(profile.profile_path, "rb").read()

        real_replace = os.replace
        calls = {"n": 0}

        def _boom(*a, **kw):
            calls["n"] += 1
            raise OSError("mô phỏng crash giữa chừng lúc ghi")

        monkeypatch.setattr(novel_manager.os, "replace", _boom)

        profile.last_chapter_number = 5
        with pytest.raises(OSError):
            profile.save()

        monkeypatch.setattr(novel_manager.os, "replace", real_replace)

        # File gốc phải còn nguyên vẹn (không bị ghi dở/hỏng), vẫn parse được.
        with open(profile.profile_path, "rb") as f:
            after_bytes = f.read()
        assert after_bytes == original_bytes
        reloaded = json.loads(after_bytes.decode("utf-8"))
        assert reloaded["last_chapter_number"] == 0

        # Không để lại file tạm rác trong thư mục truyện.
        leftovers = [
            n for n in os.listdir(os.path.dirname(profile.profile_path))
            if n not in ("novel.json", "text_raw", "translated")
        ]
        assert leftovers == [], f"File tạm còn sót lại: {leftovers}"


class TestUnknownMetadataPreserved:
    def test_unknown_field_survives_partial_update(self):
        profile = create_novel(title="Meta", source_url="url", slug="meta")
        # Giả lập field JSON lạ chưa có trong schema hiện tại (vd: bản mới
        # thêm field mà code cũ chưa biết).
        with open(profile.profile_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["future_field_unknown"] = {"nested": "value"}
        with open(profile.profile_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        reloaded = load_novel("meta")
        reloaded.update_progress("http://x/1", 1)

        with open(profile.profile_path, "r", encoding="utf-8") as f:
            final_raw = json.load(f)
        assert final_raw.get("future_field_unknown") == {"nested": "value"}
        assert final_raw["last_chapter_number"] == 1


class TestCreateNovelRaceSafe:
    def test_concurrent_create_same_slug_only_one_succeeds(self):
        base_dir = novel_manager.NOVELS_BASE_DIR
        barrier = threading.Barrier(2)
        results = {}

        def _try_create(idx):
            import novel_manager as nm
            nm.NOVELS_BASE_DIR = base_dir
            barrier.wait()
            try:
                nm.create_novel(title=f"Race{idx}", source_url="url", slug="race")
                results[idx] = "ok"
            except ValueError:
                results[idx] = "duplicate"

        t1 = threading.Thread(target=_try_create, args=(1,))
        t2 = threading.Thread(target=_try_create, args=(2,))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        outcomes = sorted(results.values())
        assert outcomes == ["duplicate", "ok"], results
