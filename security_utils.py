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
import socket
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


def _ip_obj_is_blocked(ip) -> bool:
    """
    IP (đối tượng ipaddress) có nằm trong dải bị chặn cho SSRF không:
    loopback, private (RFC1918/ULA...), link-local (bao gồm 169.254.0.0/16 —
    dải metadata cloud AWS/GCP/Azure), reserved, multicast, unspecified.
    Với IPv6 dạng IPv4-mapped (::ffff:127.0.0.1), kiểm tra luôn IPv4 bên trong.
    """
    if (ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved
            or ip.is_multicast or ip.is_unspecified):
        return True
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return _ip_obj_is_blocked(mapped)
    return False


def _is_private_host(host: str) -> bool:
    """
    Host (hostname hoặc IP literal) có phải localhost / IP nội bộ không.
    Không resolve DNS ở đây — chỉ kiểm tra IP literal hoặc tên gọi cục bộ đã
    biết. Domain name thật (không phải IP) trả về False ở bước này; việc kiểm
    tra IP thật sau khi resolve DNS nằm ở `validate_source_url`.
    """
    if host.lower() in ("localhost", "0.0.0.0", "0", "::", "::1"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False  # không phải IP literal — có thể là domain, resolve DNS riêng
    return _ip_obj_is_blocked(ip)


def _resolve_host_ips(hostname: str) -> list[str]:
    """
    Resolve hostname ra danh sách IP THẬT sẽ được dùng để kết nối.
    Chống DNS rebinding: một domain công khai (qua allowlist scheme/format)
    vẫn có thể trỏ DNS về IP nội bộ/loopback/metadata.

    Fail-closed: nếu không resolve được (DNS lỗi), coi là không an toàn và từ
    chối — không có gì đảm bảo host đó không phải nội bộ.
    """
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Không thể phân giải hostname của URL")
    ips = {info[4][0] for info in infos if info[4]}
    if not ips:
        raise HTTPException(status_code=400, detail="Không thể phân giải hostname của URL")
    return list(ips)


def validate_source_url(url: str, *, check_dns: bool = True) -> str:
    """
    Kiểm tra URL nguồn crawl (chống SSRF):
    - Chỉ cho scheme http/https (chặn file/gopher/ftp/data/...).
    - Không cho phép credentials dạng user:pass@host trong URL.
    - Chặn localhost & dải IP nội bộ/loopback/link-local/reserved/multicast,
      cả IPv4 lẫn IPv6 (kể cả ULA fc00::/7, và IPv4-mapped IPv6).
    - Nếu `check_dns=True` (mặc định): resolve DNS và kiểm tra IP THẬT sẽ
      dùng để kết nối — chặn domain công khai trỏ về IP nội bộ (DNS
      rebinding). Fail-closed nếu không resolve được.

    Giới hạn còn lại (không khắc phục được ở tầng Python thuần):
    đây là kiểm tra tại THỜI ĐIỂM GỌI HÀM (TOCTOU). Giữa lúc hàm này resolve
    DNS xong và lúc client (requests/httpx/Playwright) thực sự mở kết nối,
    bản ghi DNS có thể đổi lần nữa ở tầng hệ điều hành/thư viện mạng — muốn
    loại bỏ hoàn toàn phải tự quản lý socket (resolve 1 lần, connect thẳng
    vào IP đã resolve, không để library tự resolve lại). Với luồng Playwright
    trong `scraper.py`, mỗi request/redirect thực tế được kiểm tra lại ngay
    trước khi cho phép đi tiếp để giảm cửa sổ TOCTOU và chặn cả các hop
    redirect, nhưng vẫn còn khoảng hở giữa lần kiểm tra đó và lúc trình
    duyệt mở kết nối TCP thật.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="URL không hợp lệ")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="URL phải là http/https")
    if parsed.username is not None or parsed.password is not None:
        raise HTTPException(status_code=400, detail="Không cho phép thông tin đăng nhập trong URL")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="URL thiếu hostname")
    if _is_private_host(parsed.hostname):
        raise HTTPException(status_code=400, detail="Không cho phép URL nội bộ")

    if check_dns:
        for ip_str in _resolve_host_ips(parsed.hostname):
            if _is_private_host(ip_str):
                raise HTTPException(status_code=400, detail="Không cho phép URL nội bộ (DNS)")

    return url
