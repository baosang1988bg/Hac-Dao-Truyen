"""
routers/admin_usage.py
-----------------------
Endpoint chỉ-đọc cho admin xem ƯỚC LƯỢNG ngân sách sync cục bộ ghi bởi
tools/cloud_to_cloud_syncer.py / tools/batch_cloud_syncer.py (tools/sync_budget.py).

Đây KHÔNG phải số liệu billing thật từ Cloudflare — chỉ là counter cục bộ,
xem docs/cost-controls.md để biết giới hạn của con số này.
"""

import json
import os
from pathlib import Path

from fastapi import APIRouter, Depends

from auth import require_admin

router = APIRouter()

_GHI_CHU = (
    "Đây là số liệu ƯỚC LƯỢNG cục bộ do script sync tự ghi (không phải billing "
    "thật từ Cloudflare). Ngân sách này không bao phủ lưu trữ đang tồn tại, "
    "lượt đọc website, D1 scan, dịch AI, Google Drive, GitHub Actions hay các "
    "dịch vụ khác của tài khoản — không thể dùng để cam kết hóa đơn bằng 0."
)


def _budget_path() -> Path:
    """Path mặc định giống hệt tools/sync_budget.py::budget_from_env()."""
    return Path(os.getenv(
        "HACDAO_BUDGET_FILE",
        str(Path(__file__).resolve().parent.parent / "tools" / ".cloud_sync_budget.json"),
    ))


@router.get("/api/admin/sync-usage", dependencies=[Depends(require_admin)])
async def get_sync_usage():
    """Đọc tools/.cloud_sync_budget.json (nếu có) và trả về nguyên trạng. (admin)"""
    path = _budget_path()
    if not path.exists():
        return {
            "available": False,
            "reason": "Chưa có file ngân sách — script sync chưa chạy lần nào trên máy này.",
        }

    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        return {
            "available": False,
            "reason": f"Không đọc được file ngân sách: {e}",
        }

    if not isinstance(state, dict):
        return {
            "available": False,
            "reason": "File ngân sách không đúng định dạng.",
        }

    return {**state, "available": True, "note": _GHI_CHU}
