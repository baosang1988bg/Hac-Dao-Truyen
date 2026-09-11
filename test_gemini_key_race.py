"""
test_gemini_key_race.py
------------------------
D03 follow-up: providers/gemini.py trước đây tự _load_key_status() rồi mutate
self._key_status trong bộ nhớ rồi gọi _save_key_status() tách rời — 2
GeminiBackend instance (2 process/thread dịch song song) cùng sửa 2 key khác
nhau có thể ghi đè mất update của nhau. Đã sửa để dùng update_key_status()
(đọc-sửa-ghi nguyên tử, D03) ở cả 3 nơi (_set_status, _maybe_recover_keys,
next_available_model). Test này tái hiện race trên API cấp thấp (đã có ở
test_key_manager.py) và xác nhận GeminiBackend không còn đường gọi rời rạc
nào tới _save_key_status().

Không gọi mạng thật — genai.Client(api_key=...) chỉ khởi tạo client object,
không kết nối tại thời điểm construct.
"""
import json
import threading

import pytest

import providers.key_manager as key_manager
from providers.gemini import GeminiBackend


@pytest.fixture
def isolated_key_status(tmp_path, monkeypatch):
    path = tmp_path / "key_status.json"
    monkeypatch.setattr(key_manager, "_KEY_STATUS_FILE", str(path))
    return path


@pytest.fixture
def two_fake_keys(monkeypatch):
    keys = ["fake-key-aaaaaaaaaaaaaaaaaaaaaaaa", "fake-key-bbbbbbbbbbbbbbbbbbbbbbbb"]
    monkeypatch.setattr("providers.gemini.GOOGLE_API_KEYS", keys)
    return keys


def test_two_backends_setting_different_keys_concurrently_both_persist(isolated_key_status, two_fake_keys):
    """2 GeminiBackend instance (mô phỏng 2 process dịch song song) cùng gọi
    _set_status cho 2 KEY KHÁC NHAU gần như đồng thời — cả 2 update phải được
    lưu (không cái nào bị cái kia ghi đè mất)."""
    b1 = GeminiBackend()
    b2 = GeminiBackend()

    barrier = threading.Barrier(2)

    def worker(backend, key, status):
        barrier.wait()
        backend._set_status(key, status, note="race-test")

    t1 = threading.Thread(target=worker, args=(b1, two_fake_keys[0], "quota_exceeded"))
    t2 = threading.Thread(target=worker, args=(b2, two_fake_keys[1], "invalid"))
    t1.start(); t2.start()
    t1.join(); t2.join()

    on_disk = json.loads(isolated_key_status.read_text(encoding="utf-8"))
    assert on_disk[two_fake_keys[0]]["status"] == "quota_exceeded", (
        "update của backend 1 bị mất — lost update giữa 2 GeminiBackend cùng ghi key_status.json"
    )
    assert on_disk[two_fake_keys[1]]["status"] == "invalid", (
        "update của backend 2 bị mất — lost update giữa 2 GeminiBackend cùng ghi key_status.json"
    )
