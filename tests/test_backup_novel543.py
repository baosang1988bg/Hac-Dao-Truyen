from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from backup_novel543 import (  # noqa: E402
    BackupError,
    page_url,
    parse_jina_page,
    validate_novel543_url,
)


def test_page_url_constructs_paginated_suffix():
    base = "https://www.novel543.com/0906627296/8096_1.html"
    assert page_url(base, 1) == base
    assert page_url(base, 2).endswith("/8096_1_2.html")
    assert page_url(base, 12).endswith("/8096_1_12.html")


def test_validate_novel543_url_rejects_other_hosts():
    try:
        validate_novel543_url("https://example.com/0906627296/8096_1.html")
    except BackupError:
        pass
    else:
        raise AssertionError("Phải từ chối host ngoài Novel543")


def test_parse_jina_page_cleans_pagination_and_footer():
    raw = (
        "Title: 第1章 測試 (1/2)\n\n"
        "URL Source: https://www.novel543.com/1/a_1.html\n\n"
        "Markdown Content:\n"
        + ("正文內容。" * 30)
        + "\n\n溫馨提示: 這是網站提示\n"
    ).encode()

    parsed = parse_jina_page(raw)

    assert parsed.clean_title == "第1章 測試"
    assert parsed.page_number == 1
    assert parsed.total_pages == 2
    assert "溫馨提示" not in parsed.content


def test_parse_jina_page_rejects_missing_marker():
    try:
        parse_jina_page(b"Title: broken\n")
    except BackupError:
        pass
    else:
        raise AssertionError("Phải từ chối response thiếu Markdown Content")
