"""
test_security_utils.py
-----------------------
Test tái hiện + xác nhận các lỗ hổng SSRF nghi ngờ trong review (mục A04) đối
với `security_utils.validate_source_url`, và kiểm tra bản vá.

Không gọi mạng thật: mọi resolve DNS được monkeypatch qua `socket.getaddrinfo`.
"""
import socket

import pytest
from fastapi import HTTPException

import security_utils
from security_utils import validate_source_url


def _fake_getaddrinfo(ip_strings):
    """Trả về hàm thay thế socket.getaddrinfo() luôn trả về các IP cho trước."""
    def _fn(host, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)) for ip in ip_strings]
    return _fn


def _mock_dns(monkeypatch, ip_strings):
    monkeypatch.setattr(security_utils.socket, "getaddrinfo", _fake_getaddrinfo(ip_strings))


# ── Scheme ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "gopher://127.0.0.1:70/",
    "ftp://example.com/",
    "data:text/html,<script>1</script>",
])
def test_scheme_khong_hop_le_bi_chan(url):
    with pytest.raises(HTTPException):
        validate_source_url(url, check_dns=False)


def test_scheme_http_https_duoc_cho_qua(monkeypatch):
    _mock_dns(monkeypatch, ["93.184.216.34"])
    assert validate_source_url("http://example.com/") == "http://example.com/"
    assert validate_source_url("https://example.com/") == "https://example.com/"


# ── Credentials trong URL ────────────────────────────────────────────────────

def test_credentials_trong_url_bi_chan(monkeypatch):
    _mock_dns(monkeypatch, ["93.184.216.34"])
    with pytest.raises(HTTPException):
        validate_source_url("http://admin:secret@example.com/")


def test_chi_user_khong_co_password_van_bi_chan(monkeypatch):
    _mock_dns(monkeypatch, ["93.184.216.34"])
    with pytest.raises(HTTPException):
        validate_source_url("http://admin@example.com/")


# ── IP literal nội bộ (IPv4) ─────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "http://localhost/",
    "http://127.0.0.1/",
    "http://127.0.0.1:8080/admin",
    "http://0.0.0.0/",
    "http://0/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",  # cloud metadata endpoint
])
def test_ip_noi_bo_ipv4_bi_chan(url):
    with pytest.raises(HTTPException):
        validate_source_url(url, check_dns=False)


def test_ip_cong_khai_ipv4_duoc_cho_qua(monkeypatch):
    # 8.8.8.8 là IP literal — getaddrinfo resolve cục bộ, không cần mock,
    # nhưng vẫn mock cho chắc chắn không phát sinh network call.
    _mock_dns(monkeypatch, ["8.8.8.8"])
    assert validate_source_url("http://8.8.8.8/") == "http://8.8.8.8/"


# ── IPv6 ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "http://[::1]/",
    "http://[fe80::1]/",       # link-local
    "http://[fc00::1]/",       # Unique Local Address (ULA)
    "http://[fd12:3456:789a::1]/",  # ULA khác
    "http://[::ffff:127.0.0.1]/",   # IPv4-mapped IPv6 -> loopback
    "http://[::ffff:169.254.169.254]/",  # IPv4-mapped -> metadata
])
def test_ip_noi_bo_ipv6_bi_chan(url):
    with pytest.raises(HTTPException):
        validate_source_url(url, check_dns=False)


# ── DNS rebinding: domain công khai trỏ về IP nội bộ ─────────────────────────

def test_domain_resolve_ve_loopback_bi_chan(monkeypatch):
    _mock_dns(monkeypatch, ["127.0.0.1"])
    with pytest.raises(HTTPException):
        validate_source_url("http://evil-rebind.example.com/")


def test_domain_resolve_ve_metadata_bi_chan(monkeypatch):
    _mock_dns(monkeypatch, ["169.254.169.254"])
    with pytest.raises(HTTPException):
        validate_source_url("http://looks-public.example.com/")


def test_domain_resolve_ve_private_range_bi_chan(monkeypatch):
    _mock_dns(monkeypatch, ["10.1.2.3"])
    with pytest.raises(HTTPException):
        validate_source_url("http://internal-proxy.example.com/")


def test_domain_mot_trong_nhieu_ip_resolve_la_private_bi_chan(monkeypatch):
    # Domain trả về nhiều bản ghi A/AAAA — chỉ cần 1 cái là nội bộ thì chặn.
    _mock_dns(monkeypatch, ["93.184.216.34", "127.0.0.1"])
    with pytest.raises(HTTPException):
        validate_source_url("http://multi-ip.example.com/")


def test_domain_resolve_ve_ip_cong_khai_duoc_cho_qua(monkeypatch):
    _mock_dns(monkeypatch, ["93.184.216.34"])
    assert validate_source_url("http://public-site.example.com/") == "http://public-site.example.com/"


def test_dns_khong_resolve_duoc_bi_chan_fail_closed(monkeypatch):
    def _raise(*args, **kwargs):
        raise socket.gaierror("Name or service not known")
    monkeypatch.setattr(security_utils.socket, "getaddrinfo", _raise)
    with pytest.raises(HTTPException):
        validate_source_url("http://khong-ton-tai.invalid/")


def test_check_dns_false_bo_qua_buoc_resolve(monkeypatch):
    # Khi caller chủ động tắt check_dns (vd. đã tự resolve từ trước), domain
    # hợp lệ về mặt literal vẫn được cho qua mà không gọi getaddrinfo.
    called = []
    def _spy(*args, **kwargs):
        called.append(args)
        raise AssertionError("Không được gọi DNS khi check_dns=False")
    monkeypatch.setattr(security_utils.socket, "getaddrinfo", _spy)
    assert validate_source_url("http://example.com/", check_dns=False) == "http://example.com/"
    assert called == []


# ── Redirect (mô phỏng ở mức đơn vị: mỗi hop phải được validate lại) ────────

def test_moi_hop_redirect_phai_duoc_kiem_tra_rieng(monkeypatch):
    """
    validate_source_url chỉ kiểm tra 1 URL tại 1 thời điểm — mô phỏng việc
    scraper.py phải gọi lại hàm này cho URL đích SAU redirect, không chỉ URL
    ban đầu. Ở đây kiểm tra: URL ban đầu an toàn, nhưng nếu "hop" tiếp theo
    (URL sau redirect) trỏ nội bộ thì phải bị chặn khi validate lại.
    """
    _mock_dns(monkeypatch, ["93.184.216.34"])
    initial_url = "http://public-site.example.com/"
    assert validate_source_url(initial_url) == initial_url

    redirected_url = "http://169.254.169.254/latest/meta-data/"
    with pytest.raises(HTTPException):
        validate_source_url(redirected_url, check_dns=False)
