import json

import migrate_to_cloudflare as m


def test_source_catalog_is_detected(tmp_path):
    # Catalog nguồn (novel543): có url trang gốc, filename "Chương N_VI.md" không
    # tồn tại → đẩy lên R2 sẽ đè chỉ mục thật (sự cố mục lục Sớm Đăng Lục).
    p = tmp_path / "catalog.json"
    p.write_text(json.dumps([{"number": 1, "title": "Chương 1", "url": "https://www.novel543.com/x/8096_1.html",
                              "filename": "Chương 1_VI.md"}]), encoding="utf-8")
    assert m.is_source_catalog(p) is True


def test_index_catalog_is_not_source(tmp_path):
    p = tmp_path / "catalog.json"
    p.write_text(json.dumps([{"filename": "0001_chuong-1_VI.md", "title": "Chương 1", "chapter_number": 1}]),
                 encoding="utf-8")
    assert m.is_source_catalog(p) is False


def test_unreadable_catalog_treated_as_source(tmp_path):
    p = tmp_path / "catalog.json"
    p.write_text("{hỏng", encoding="utf-8")
    assert m.is_source_catalog(p) is True
