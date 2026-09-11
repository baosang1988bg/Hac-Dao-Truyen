"""
test_key_manager.py
--------------------
TDD cho D03: ghi key_status.json (providers/key_manager.py) an toàn khi nhiều
thread/process cùng đọc-sửa-ghi (rotation key Gemini).

- `_load_key_status`/`_save_key_status` là API cấp thấp hiện có (dùng riêng lẻ,
  không khoá trọn chu trình đọc-sửa-ghi) — test đầu tiên tái hiện đúng lỗ hổng
  review nêu: gọi 2 API này tách rời từ 2 thread có thể mất update.
- `update_key_status()` là API mới, khoá trọn chu trình đọc-sửa-ghi + ghi atomic
  qua file tạm + os.replace — test còn lại xác nhận API mới không mất update
  và không hỏng file khi crash giữa chừng.

Chạy trên tmp_path, không đụng key_status.json thật của repo.
"""
import json
import os
import threading
import multiprocessing

import pytest

import providers.key_manager as key_manager


@pytest.fixture(autouse=True)
def isolated_key_status(tmp_path, monkeypatch):
    path = str(tmp_path / "key_status.json")
    monkeypatch.setattr(key_manager, "_KEY_STATUS_FILE", path)
    return path


def _raw_load_mutate_save(path, key, note, barrier):
    """Mô phỏng đúng pattern hiện tại của providers/gemini.py: load rồi sửa
    trong bộ nhớ rồi save riêng, KHÔNG khoá trọn chu trình."""
    import providers.key_manager as km
    km._KEY_STATUS_FILE = path
    status = km._load_key_status()
    barrier.wait()  # đảm bảo cả 2 bên đã load trước khi bên nào save
    status[key] = {"status": "quota_exceeded", "note": note}
    km._save_key_status(status)


class TestRawLoadSaveCanLoseUpdates:
    def test_two_threads_raw_pattern_can_lose_an_update(self):
        """Tái hiện lỗ hổng review nêu: _load_key_status()/_save_key_status()
        gọi tách rời (đúng cách providers/gemini.py dùng) không khoá trọn chu
        trình đọc-sửa-ghi, nên có thể mất 1 trong 2 update khi ghi đồng thời.
        Đây là giới hạn đã biết của API cấp thấp (được giữ để tương thích
        ngược với providers/gemini.py, nằm ngoài phạm vi sửa của D03 lần này)
        — dùng update_key_status() bên dưới để tránh lỗi này.
        """
        path = key_manager._KEY_STATUS_FILE
        barrier = threading.Barrier(2)
        t1 = threading.Thread(target=_raw_load_mutate_save, args=(path, "key-A", "from A", barrier))
        t2 = threading.Thread(target=_raw_load_mutate_save, args=(path, "key-B", "from B", barrier))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        final = key_manager._load_key_status()
        # Vì cả 2 cùng load lúc file rỗng rồi ghi đè toàn bộ dict, một trong
        # hai update sẽ bị mất — xác nhận đúng nghi ngờ review.
        both_present = "key-A" in final and "key-B" in final
        assert not both_present, (
            "Không mong đợi: cả 2 update đều còn nguyên dù dùng API cấp thấp "
            "không khoá trọn chu trình — nếu test này fail, nghi ngờ review "
            "về lost update ở đây không còn đúng nữa."
        )


def _transactional_update(path, key, note, start_barrier):
    import providers.key_manager as km
    km._KEY_STATUS_FILE = path

    def _mutate(status):
        status[key] = {"status": "quota_exceeded", "note": note}

    # Đồng bộ thời điểm XUẤT PHÁT (trước khi tranh khoá), không đồng bộ bên
    # trong mutator — vì update_key_status() khoá trọn chu trình đọc-sửa-ghi
    # nên chỉ 1 bên được ở trong critical section tại 1 thời điểm; đồng bộ
    # bên trong đó sẽ tự deadlock (bên giữ khoá chờ bên đang chờ khoá).
    start_barrier.wait()
    km.update_key_status(_mutate)


class TestUpdateKeyStatusNoLostUpdate:
    def test_two_threads_different_keys_no_lost_update(self):
        path = key_manager._KEY_STATUS_FILE
        start_barrier = threading.Barrier(2)
        t1 = threading.Thread(target=_transactional_update, args=(path, "key-A", "from A", start_barrier))
        t2 = threading.Thread(target=_transactional_update, args=(path, "key-B", "from B", start_barrier))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)
        assert not t1.is_alive() and not t2.is_alive()

        final = key_manager._load_key_status()
        assert final.get("key-A", {}).get("note") == "from A"
        assert final.get("key-B", {}).get("note") == "from B"

    def test_two_processes_different_keys_no_lost_update(self):
        path = key_manager._KEY_STATUS_FILE
        start_barrier = multiprocessing.Barrier(2)
        ctx = multiprocessing.get_context("spawn")
        p1 = ctx.Process(target=_transactional_update, args=(path, "key-A", "from A", start_barrier))
        p2 = ctx.Process(target=_transactional_update, args=(path, "key-B", "from B", start_barrier))
        p1.start()
        p2.start()
        p1.join(timeout=15)
        p2.join(timeout=15)
        assert p1.exitcode == 0
        assert p2.exitcode == 0

        final = key_manager._load_key_status()
        assert final.get("key-A", {}).get("note") == "from A"
        assert final.get("key-B", {}).get("note") == "from B"


class TestAtomicWriteSurvivesCrash:
    def test_exception_after_temp_file_before_replace_keeps_original(self, monkeypatch):
        key_manager.update_key_status(lambda status: status.update(
            {"key-orig": {"status": "working", "note": "seed"}}
        ))
        path = key_manager._KEY_STATUS_FILE
        with open(path, "rb") as f:
            original_bytes = f.read()

        real_replace = os.replace

        def _boom(*a, **kw):
            raise OSError("mô phỏng crash giữa chừng lúc ghi")

        monkeypatch.setattr(key_manager.os, "replace", _boom)
        with pytest.raises(OSError):
            key_manager.update_key_status(lambda status: status.update(
                {"key-new": {"status": "working", "note": "should not persist"}}
            ))
        monkeypatch.setattr(key_manager.os, "replace", real_replace)

        with open(path, "rb") as f:
            after_bytes = f.read()
        assert after_bytes == original_bytes
        data = json.loads(after_bytes.decode("utf-8"))
        assert "key-new" not in data
        assert data["key-orig"]["note"] == "seed"

        leftovers = [
            n for n in os.listdir(os.path.dirname(path))
            if n.startswith(".key-status-")
        ]
        assert leftovers == [], f"File tạm còn sót lại: {leftovers}"
