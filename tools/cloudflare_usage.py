"""Số liệu sử dụng THẬT của tài khoản Cloudflare (GraphQL Analytics).

Dùng chung cho tools/budget_status.py (xem) và tools/sync_budget.py (chặn ghi
khi sắp chạm hạn mức gói Free). Hạn mức Free tính cho CẢ tài khoản, nên truy
vấn không lọc theo database/bucket.

Token: HACDAO_CF_ANALYTICS_TOKEN (CI — token CHỈ ĐỌC "Account Analytics: Read";
cố ý không dùng tên CLOUDFLARE_API_TOKEN vì biến đó làm auto_check chuyển sang
đường ghi bằng wrangler), rồi CLOUDFLARE_API_TOKEN, rồi token OAuth của
`wrangler login` (máy local — sống ~1 giờ, làm mới khi chạy 1 lệnh wrangler).
Account: HACDAO_CF_ACCOUNT_ID / CLOUDFLARE_ACCOUNT_ID / `wrangler whoami`.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"

# Hạn mức gói Free (Workers Free / R2 Free tier).
FREE_LIMITS = {
    "d1_rows_written_day": 100_000,
    "d1_rows_read_day": 5_000_000,
    "r2_class_a_month": 1_000_000,
    "r2_class_b_month": 10_000_000,
    "r2_storage_bytes": 10 * 1000**3,
    "workers_requests_day": 100_000,
}

# Thao tác R2 tính phí Class A (ghi/list); còn lại (GetObject, HeadBucket…) là Class B.
R2_CLASS_A = {"PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload",
              "UploadPart", "UploadPartCopy", "ListObjects", "ListMultipartUploads", "ListParts",
              "PutBucket", "DeleteBucket", "PutBucketCors", "PutBucketLifecycleConfiguration"}

_QUERY = """query($a:String!,$d:Date!,$m:Date!){viewer{accounts(filter:{accountTag:$a}){
d1:d1AnalyticsAdaptiveGroups(limit:1000,filter:{date_geq:$d,date_leq:$d}){sum{rowsRead rowsWritten}}
r2:r2OperationsAdaptiveGroups(limit:1000,filter:{date_geq:$m,date_leq:$d}){sum{requests}dimensions{actionType}}
st:r2StorageAdaptiveGroups(limit:1000,filter:{date_geq:$d,date_leq:$d}){max{payloadSize}dimensions{bucketName}}
wk:workersInvocationsAdaptive(limit:1000,filter:{date_geq:$d,date_leq:$d}){sum{requests}}
}}}"""


def _npx():
    return shutil.which("npx.cmd" if sys.platform == "win32" else "npx") or "npx"


def wrangler_token(refresh: bool = True):
    """CLOUDFLARE_API_TOKEN, hoặc token OAuth của wrangler (làm mới bằng `wrangler whoami`)."""
    for name in ("HACDAO_CF_ANALYTICS_TOKEN", "CLOUDFLARE_API_TOKEN"):
        if os.getenv(name, "").strip():
            return os.environ[name].strip()
    if refresh:
        subprocess.run([_npx(), "wrangler", "whoami"], cwd=BASE_DIR, capture_output=True, text=True)
    home = Path.home()
    for p in [home / "Library/Preferences/.wrangler/config/default.toml",   # macOS
              home / ".config/.wrangler/config/default.toml",               # Linux
              home / ".wrangler/config/default.toml",
              Path(os.getenv("APPDATA", str(home))) / "xdg.config/.wrangler/config/default.toml"]:  # Windows
        if p.exists():
            m = re.search(r'^oauth_token\s*=\s*"([^"]+)"', p.read_text(encoding="utf-8"), re.M)
            if m:
                return m.group(1)
    return None


def account_id():
    for name in ("HACDAO_CF_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"):
        if os.getenv(name, "").strip():
            return os.environ[name].strip()
    out = subprocess.run([_npx(), "wrangler", "whoami"], cwd=BASE_DIR, capture_output=True,
                         text=True, encoding="utf-8", errors="replace").stdout
    ids = re.findall(r"\b[0-9a-f]{32}\b", out)
    return ids[0] if ids else None


def parse_usage(account: dict) -> dict:
    """Gộp kết quả GraphQL thành số liệu so được với FREE_LIMITS."""
    r2 = account.get("r2") or []
    return {
        "d1_rows_written_day": sum(r["sum"]["rowsWritten"] for r in account.get("d1") or []),
        "d1_rows_read_day": sum(r["sum"]["rowsRead"] for r in account.get("d1") or []),
        "r2_class_a_month": sum(r["sum"]["requests"] for r in r2 if r["dimensions"]["actionType"] in R2_CLASS_A),
        "r2_class_b_month": sum(r["sum"]["requests"] for r in r2 if r["dimensions"]["actionType"] not in R2_CLASS_A),
        # Mỗi bucket lấy giá trị lớn nhất trong ngày rồi cộng các bucket.
        "r2_storage_bytes": sum(_max_by_bucket(account.get("st") or []).values()),
        "workers_requests_day": sum(r["sum"]["requests"] for r in account.get("wk") or []),
    }


def _max_by_bucket(rows):
    out = {}
    for r in rows:
        name = (r.get("dimensions") or {}).get("bucketName", "")
        out[name] = max(out.get(name, 0), r["max"]["payloadSize"])
    return out


def fetch_usage(token: str, account: str, now: datetime | None = None, timeout: float = 30) -> dict:
    """Số liệu thật hôm nay (UTC) / tháng này. Raise nếu API lỗi hoặc thiếu quyền."""
    now = now or datetime.now(timezone.utc)
    body = {"query": _QUERY, "variables": {"a": account, "d": now.strftime("%Y-%m-%d"),
                                           "m": now.strftime("%Y-%m-01")}}
    req = urllib.request.Request(GRAPHQL_URL, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "hacdao-budget/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.load(resp)
    if data.get("errors"):
        raise RuntimeError("; ".join(e.get("message", "?") for e in data["errors"]))
    return parse_usage(data["data"]["viewer"]["accounts"][0])


def current_usage():
    """(usage, lỗi) — tự lấy token/account; usage=None nếu không lấy được."""
    token, acc = wrangler_token(), account_id()
    if not token or not acc:
        return None, "thiếu token/account (secret HACDAO_CF_ANALYTICS_TOKEN + biến HACDAO_CF_ACCOUNT_ID, hoặc `npx wrangler login`)"
    try:
        return fetch_usage(token, acc), None
    except Exception as e:  # noqa: BLE001
        return None, str(e)
