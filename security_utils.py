"""
security_utils.py
-----------------
Các hàm bảo vệ đầu vào cho REST API:

- validate_slug / safe_novel_dir : chặn path traversal qua tham số slug.
- safe_join                      : chặn traversal khi ghép filename vào thư mục.
- validate_chapter_title         : chặn argument injection khi truyền vào subprocess.
- validate_source_url            : chặn SSRF (chỉ cho http/https, chặn IP nội bộ).
"""

import os
import re
import ipaddress
from urllib.parse import urlparse

from fastapi import HTTPException

NOVELS_DIR = "novels"

# Slug hợp lệ: chữ, số, gạch ngang/dưới, dấu chấm (không cho '..', '/', '\')
_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$")


def validate_slug(slug: str) -> str:
    """Trả về slug nếu hợp lệ, ngược lại raise 400."""
    if not _SLUG_RE.match(slug) or ".." in slug:
        raise HTTPException(status_code=400, detail="Slug không hợp lệ")
    return slug


def safe_novel_dir(slug: str, *subdirs: str) -> str:
    """Đường dẫn an toàn tới thư mục của truyện (novels/<slug>/<subdirs...>)."""
    validate_slug(slug)
    path = os.path.join(NOVELS_DIR, slug, *subdirs)
    # Containment check (giống safe_join): chặn trường hợp slug/subdirs hợp lệ
    # về mặt ký tự nhưng resolve ra ngoài novels/ (vd. symlink độc hại).
    candidate = os.path.realpath(path)
    base_real = os.path.realpath(NOVELS_DIR)
    if candidate != base_real and not candidate.startswith(base_real + os.sep):
        raise HTTPException(status_code=400, detail="Đường dẫn không hợp lệ")
    return path


def safe_join(base_dir: str, filename: str) -> str:
    """
    Ghép filename vào base_dir và đảm bảo kết quả nằm TRONG base_dir.
    Chặn '../', đường dẫn tuyệt đối, null byte...
    """
    if not filename or "\x00" in filename:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ")
    # Không cho separator — filename phải là 1 file phẳng trong thư mục
    if "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ")

    candidate = os.path.realpath(os.path.join(base_dir, filename))
    base_real = os.path.realpath(base_dir)
    if candidate != base_real and not candidate.startswith(base_real + os.sep):
        raise HTTPException(status_code=400, detail="Đường dẫn không hợp lệ")
    return candidate


# chapter_title truyền vào subprocess dưới dạng argv riêng (không qua shell),
# nhưng vẫn cần chặn argument injection kiểu "--force" và giới hạn độ dài.
def validate_chapter_title(title: str) -> str:
    title = title.strip()
    if not title or len(title) > 200:
        raise HTTPException(status_code=400, detail="chapter_title không hợp lệ")
    if title.startswith("-"):
        raise HTTPException(status_code=400, detail="chapter_title không được bắt đầu bằng '-'")
    if "\x00" in title or "\n" in title:
        raise HTTPException(status_code=400, detail="chapter_title chứa ký tự không hợp lệ")
    return title


def _is_private_host(host: str) -> bool:
    """Host là localhost / IP nội bộ?"""
    if host.lower() in ("localhost", "0.0.0.0", "127.0.0.1", "::1"):
        return True
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except ValueError:
        return False  # là domain name — cho qua (đã có allowlist scheme)


def validate_source_url(url: str) -> str:
    """
    Kiểm tra URL nguồn crawl:
    - Chỉ cho scheme http/https.
    - Chặn localhost & dải IP nội bộ (chống SSRF vào mạng nội bộ).
    """
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="URL không hợp lệ")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="URL phải là http/https")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="URL thiếu hostname")
    if _is_private_host(parsed.hostname):
        raise HTTPException(status_code=400, detail="Không cho phép URL nội bộ")
    return url
