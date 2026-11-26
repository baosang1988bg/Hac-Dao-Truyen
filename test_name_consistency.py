"""
test_name_consistency.py
------------------------
Kiểm tra tools/name_consistency.py (kế hoạch name kiểu STV, hạng mục #6).

Dựng truyện giả trong tmp_path (raw + translated + glossary), gọi main()
với --novels-dir trỏ vào đó — không đụng novels/ thật, không gọi cloud.

Phạm vi:
  - Khớp đúng: vi chuẩn có trong bản dịch → không báo thiếu.
  - Phát hiện thiếu + liệt kê chương thiếu + tỉ lệ.
  - Thuật ngữ zh là chuỗi con của thuật ngữ dài hơn (夏 trong 夏辰) không bị báo sai.
  - Biến thể nghi ngờ tìm ra "Hạ Thìn".
  - Chế độ không raw: chạy được, báo "không có raw", thống kê độ phủ.
  - Slug không tồn tại / glossary rỗng → mã thoát 2.
  - JSON đúng schema.
"""
import json

from tools import name_consistency as nc


GLOSSARY = {
    "夏辰": "Hạ Thần",
    "夏": "Hạ",          # chuỗi con của 夏辰 — không được báo thiếu ở chương chỉ có 夏辰
    "武德殿": "Võ Đức Điện",
}


def _make_novel(root, slug="truyen-gia", glossary=GLOSSARY, raw=None, translated=None):
    d = root / slug
    (d / "translated").mkdir(parents=True)
    (d / "text_raw").mkdir()
    (d / "novel.json").write_text(json.dumps({"slug": slug, "glossary": glossary},
                                             ensure_ascii=False), encoding="utf-8")
    for name, text in (raw or {}).items():
        (d / "text_raw" / name).write_text(text, encoding="utf-8")
    for name, text in (translated or {}).items():
        (d / "translated" / name).write_text(text, encoding="utf-8")
    return d


def _run(tmp_path, root, *extra):
    out = tmp_path / "report.json"
    code = nc.main(["--novel", "truyen-gia", "--novels-dir", str(root), "--json", str(out), *extra])
    data = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    return code, data


def _fixture(tmp_path):
    root = tmp_path / "fake_novels"
    _make_novel(
        root,
        raw={
            "第1章 开始.txt": "夏辰走进武德殿。夏辰笑了。",
            "第2章 再见.txt": "夏辰说话了。",
            "第3章 风云.txt": "夏辰与夏辰。",
            "第4章 尾声.txt": "夏辰来了。",
        },
        translated={
            # NFD + hoa/thường khác + khoảng trắng thừa → vẫn phải khớp
            "Chương 1 - Bắt đầu_VI.md": "# Chương 1\n\nhạ   thần bước vào VÕ ĐỨC ĐIỆN. Hạ Thần cười.",
            "Chương 2 - Tạm biệt_VI.md": "# Chương 2\n\nHạ Thìn nói chuyện. Hạ Thìn đứng dậy.",
            "Chương 3 - Phong vân_VI.md": "# Chương 3\n\nHạ Thìn và Hạ Thìn.",
            "Chương 4 - Vĩ thanh_VI.md": "# Chương 4\n\nHạ Thần đã tới.",
        },
    )
    return root


def test_khop_dung_va_phat_hien_thieu(tmp_path):
    root = _fixture(tmp_path)
    code, data = _run(tmp_path, root)
    assert code == 0
    assert data["mode"] == "raw" and data["has_raw"] is True
    terms = {t["zh"]: t for t in data["terms"]}
    # 武德殿 chỉ ở chương 1 và bản dịch có (khác hoa thường) → không thiếu
    assert terms["武德殿"]["chapters_with_zh"] == 1
    assert terms["武德殿"]["chapters_missing_vi"] == 0
    # 夏辰 ở 4 chương, thiếu "Hạ Thần" ở chương 2, 3
    t = terms["夏辰"]
    assert t["chapters_with_zh"] == 4
    assert t["chapters_missing_vi"] == 2
    assert t["missing_chapters"] == [2, 3]
    assert t["missing_ratio"] == 0.5
    # Sắp theo số chương thiếu giảm dần
    assert data["terms"][0]["zh"] == "夏辰"


def test_nfd_van_khop(tmp_path):
    import unicodedata
    root = tmp_path / "fake_novels"
    _make_novel(root, raw={"第1章.txt": "夏辰。"},
                translated={"Chương 1_VI.md": unicodedata.normalize("NFD", "Hạ Thần đến.")})
    code, data = _run(tmp_path, root)
    assert code == 0
    assert {t["zh"]: t for t in data["terms"]}["夏辰"]["chapters_missing_vi"] == 0


def test_chuoi_con_khong_bao_sai(tmp_path):
    root = _fixture(tmp_path)
    _, data = _run(tmp_path, root)
    # 夏 chỉ xuất hiện bên trong 夏辰 → không được tính là "có zh"
    assert "夏" not in {t["zh"] for t in data["terms"]}
    assert nc.count_zh_terms("夏辰与夏天", ["夏辰", "夏"]) == {"夏辰": 1, "夏": 1}


def test_bien_the_nghi_ngo_ha_thin(tmp_path):
    root = _fixture(tmp_path)
    _, data = _run(tmp_path, root)
    t = {t["zh"]: t for t in data["terms"]}["夏辰"]
    assert t["suspected_variants"], "phải gợi ý biến thể"
    top = t["suspected_variants"][0]
    assert top["text"] == "Hạ Thìn"
    assert top["count"] == 4 and top["chapters"] == 2


def test_min_occurrences_va_limit(tmp_path):
    root = _fixture(tmp_path)
    _, data = _run(tmp_path, root, "--min-occurrences", "2")
    t = {t["zh"]: t for t in data["terms"]}["夏辰"]
    assert t["chapters_with_zh"] == 2  # chỉ chương 1 và 3 có ≥2 lần
    _, data = _run(tmp_path, root, "--limit-chapters", "1")
    assert data["stats"]["chapters_checked"] == 1


def test_che_do_khong_raw(tmp_path, capsys):
    root = tmp_path / "fake_novels"
    _make_novel(
        root,
        translated={
            "Chương 1 - A_VI.md": "Hạ Thần bước vào Võ Đức Điện.",
            "Chương 2 - B_VI.md": "Hạ Thần lại tới.",
            "Chương 3 - C_VI.md": "Hạ Thần cười.",
            "Chương 4 - D_VI.md": "Hạ Thần đi. Kim Đức Điện mở cửa. Kim Đức Điện đóng.",
        },
    )
    code, data = _run(tmp_path, root, "--rare-max", "1")
    assert code == 0
    assert data["mode"] == "translated_only" and data["has_raw"] is False
    assert data["terms"] == []
    assert "không có raw" in capsys.readouterr().out.lower()
    cov = {t["zh"]: t for t in data["coverage"]}
    assert cov["夏辰"]["chapters_with_vi"] == 4 and cov["夏辰"]["rare"] is False
    assert cov["武德殿"]["chapters_with_vi"] == 1 and cov["武德殿"]["rare"] is True
    assert cov["武德殿"]["low_confidence"] is True
    assert cov["武德殿"]["suspected_variants"][0]["text"] == "Kim Đức Điện"


def test_slug_khong_ton_tai_va_glossary_rong(tmp_path):
    root = tmp_path / "fake_novels"
    root.mkdir()
    assert nc.main(["--novel", "khong-co", "--novels-dir", str(root)]) == 2
    _make_novel(root, slug="rong", glossary={})
    assert nc.main(["--novel", "rong", "--novels-dir", str(root)]) == 2


def test_bo_qua_khoa_khong_phai_chu_han(tmp_path):
    root = tmp_path / "fake_novels"
    _make_novel(root, glossary={"夏辰": "Hạ Thần", "Hạ Thìn": "Hạ Thìn"},
                raw={"第1章.txt": "夏辰。"}, translated={"Chương 1_VI.md": "Hạ Thìn đến."})
    _, data = _run(tmp_path, root)
    assert {t["zh"] for t in data["terms"]} == {"夏辰"}
    assert any("không chứa chữ Hán" in n for n in data["notes"])
    # "Hạ Thìn" là vi đã có trong glossary → không gợi ý thành biến thể
    assert data["terms"][0]["suspected_variants"] == []


def test_khong_ghi_json_vao_novels(tmp_path):
    root = _fixture(tmp_path)
    bad = root / "truyen-gia" / "report.json"
    assert nc.main(["--novel", "truyen-gia", "--novels-dir", str(root), "--json", str(bad)]) == 2
    assert not bad.exists()


def test_json_dung_schema(tmp_path):
    root = _fixture(tmp_path)
    _, data = _run(tmp_path, root)
    for key in ("tool", "schema_version", "generated_at", "slug", "mode", "has_raw",
                "raw_dir", "params", "stats", "notes", "terms", "coverage"):
        assert key in data
    assert data["tool"] == "name_consistency" and data["schema_version"] == 1
    assert data["raw_dir"] == "text_raw"
    for key in ("glossary_terms", "translated_chapters", "raw_chapters", "chapters_checked"):
        assert isinstance(data["stats"][key], int)
    for t in data["terms"]:
        assert set(t) == {"zh", "vi", "chapters_with_zh", "chapters_missing_vi",
                          "missing_ratio", "missing_chapters", "suspected_variants"}
        assert len(t["missing_chapters"]) <= 10
        assert len(t["suspected_variants"]) <= 3
        for v in t["suspected_variants"]:
            assert set(v) == {"text", "count", "chapters"}


def test_raw_gb18030_van_doc_duoc(tmp_path):
    """Sau review: raw GBK/GB18030 vẫn đọc được (trước đây bị bỏ qua im lặng)."""
    import tools.name_consistency as nc
    novels = tmp_path / "novels"
    d = novels / "gb"
    (d / "text_raw").mkdir(parents=True)
    (d / "translated").mkdir()
    (d / "novel.json").write_text(json.dumps({"glossary": {"夏辰": "Hạ Thần"}}, ensure_ascii=False), encoding="utf-8")
    (d / "text_raw" / "第1章.txt").write_bytes("第1章\n夏辰来了".encode("gb18030"))
    (d / "translated" / "Chương 1 - A_VI.md").write_text("Hạ Thần đến rồi", encoding="utf-8")
    report = nc.analyze("gb", novels_dir=str(novels))
    assert report["mode"] == "raw"
    term = next(t for t in report["terms"] if t["zh"] == "夏辰")
    assert term["chapters_with_zh"] == 1 and term["chapters_missing_vi"] == 0
