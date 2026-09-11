"""
providers/key_manager.py
------------------------
Lưu/đọc trạng thái các API key (key_status.json) — dùng chung cho GeminiBackend.

Trạng thái mỗi key:
  - working        : key đang hoạt động tốt
  - quota_exceeded : hết quota ngày, tự recover sau _QUOTA_RESET_HOURS
  - rate_limited   : bị per-minute rate limit, bỏ qua trong _RATE_LIMIT_SKIP_HOURS
  - invalid        : key sai/bị thu hồi, không thử lại tự động
"""

import os
import json as _json
import tempfile as _tempfile
import threading
import time as _time
from contextlib import contextmanager as _contextmanager
from datetime import datetime as _dt, timezone as _tz

# key_status.json nằm ở thư mục gốc project (cạnh translator.py)
_KEY_STATUS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "key_status.json"
)
_QUOTA_RESET_HOURS    = 24  # Gemini free tier quota resets every 24h
_RATE_LIMIT_SKIP_HOURS = 1  # Bỏ qua key bị per-minute rate limit trong 1h

# Khóa module-level cho thao tác đọc-sửa-ghi key_status.json — tránh 2 thread
# (2 batch dịch chạy song song) ghi đè mất cập nhật của nhau khi cùng gọi
# _save_key_status(). Đây là lock trong-tiến-trình; xem thêm _cross_process_lock
# bên dưới cho khoá liên-tiến-trình.
_key_status_lock = threading.Lock()


# ── Khoá liên-tiến-trình + ghi atomic (D03) ──────────────────────────────────
#
# Ghi chú review D03: lock cũ (_key_status_lock) chỉ bọc phần *ghi*, không bọc
# trọn chu trình đọc-sửa-ghi, và chỉ là threading.Lock nên không bảo vệ được
# 2 tiến trình Python khác nhau (vd 2 lần chạy translator song song) cùng ghi
# key_status.json. update_key_status() bên dưới là API mới khoá trọn chu
# trình đọc-sửa-ghi bằng file lock (os.mkdir — atomic trên cả POSIX/Windows,
# mô phỏng theo cơ chế mkdir-lock đã có sẵn trong tools/sync_budget.py) và ghi
# atomic (file tạm cùng thư mục rồi os.replace()).
#
# _load_key_status/_save_key_status vẫn được giữ nguyên chữ ký để không phá
# vỡ providers/gemini.py (ngoài phạm vi sửa của đợt D03 này — xem báo cáo).
# _save_key_status giờ ghi atomic + có khoá liên-tiến-trình, nên ít nhất
# không còn hỏng file khi crash giữa chừng hay bị 2 tiến trình ghi chồng byte
# lên nhau; nhưng khoảng hở giữa lúc gemini.py gọi _load_key_status() và lúc
# gọi _save_key_status() (2 lời gọi tách rời trong providers/gemini.py) vẫn
# có thể mất update nếu không dùng update_key_status().

@_contextmanager
def _cross_process_lock(timeout: float = 10.0):
    lock_dir = _KEY_STATUS_FILE + ".lock"
    os.makedirs(os.path.dirname(_KEY_STATUS_FILE) or ".", exist_ok=True)
    deadline = _time.monotonic() + timeout
    while True:
        try:
            os.mkdir(lock_dir)
            break
        except FileExistsError:
            if _time.monotonic() > deadline:
                raise RuntimeError(f"Timeout chờ khoá key_status.json: {_KEY_STATUS_FILE}")
            _time.sleep(0.01)
    try:
        yield
    finally:
        try:
            os.rmdir(lock_dir)
        except OSError:
            pass


def _atomic_write_json(path: str, data: dict):
    """Ghi JSON atomic: file tạm cùng thư mục đích rồi os.replace(). Nếu có
    exception giữa chừng (vd crash), file gốc không bị đụng tới."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = _tempfile.mkstemp(prefix=".key-status-", suffix=".json.tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            _json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _load_key_status() -> dict:
    """Load key status từ file. Tạo mới nếu chưa có.

    API cấp thấp — không khoá. Nếu cần đọc-sửa-ghi an toàn khi có nhiều
    thread/process, dùng update_key_status() thay vì gọi hàm này rồi tự gọi
    _save_key_status() tách rời."""
    if os.path.exists(_KEY_STATUS_FILE):
        try:
            with open(_KEY_STATUS_FILE, "r", encoding="utf-8") as f:
                return _json.load(f)
        except Exception:
            pass
    return {}


def _save_key_status(status: dict):
    """Lưu key status xuống file: khoá (trong-tiến-trình + liên-tiến-trình)
    và ghi atomic. Lưu ý: hàm này chỉ khoá phần ghi, không khoá phần đọc trước
    đó — nếu gọi tách rời với _load_key_status() ở nơi khác (như
    providers/gemini.py hiện đang làm), vẫn có thể mất update khi 2
    thread/process cùng đọc-sửa-ghi. Dùng update_key_status() để tránh."""
    with _key_status_lock:
        try:
            with _cross_process_lock():
                _atomic_write_json(_KEY_STATUS_FILE, status)
        except Exception as e:
            print(f"  [!] Không thể lưu key_status.json: {e}")


def update_key_status(mutator) -> dict:
    """Đọc-sửa-ghi key_status.json nguyên tử (D03).

    Khoá bao trọn chu trình đọc -> sửa -> ghi (chống mất update khi nhiều
    thread/process cùng sửa key_status.json), ghi atomic qua file tạm rồi
    os.replace() (chống hỏng file nếu crash giữa chừng).

    `mutator(status: dict)` sửa `status` tại chỗ; nếu trả về 1 dict, dict đó
    được dùng làm trạng thái cuối thay vì `status` đã sửa tại chỗ.
    Trả về dict trạng thái đã lưu xuống đĩa.
    """
    with _key_status_lock:
        with _cross_process_lock():
            status = _load_key_status()
            result = mutator(status)
            if isinstance(result, dict):
                status = result
            _atomic_write_json(_KEY_STATUS_FILE, status)
            return status


def _now_iso() -> str:
    return _dt.now(_tz.utc).isoformat()


def _hours_since(iso_ts: str) -> float:
    """Tính số giờ đã qua kể từ timestamp ISO."""
    try:
        t = _dt.fromisoformat(iso_ts)
        if t.tzinfo is None:
            t = t.replace(tzinfo=_tz.utc)
        return (_dt.now(_tz.utc) - t).total_seconds() / 3600
    except Exception:
        return 999.0
