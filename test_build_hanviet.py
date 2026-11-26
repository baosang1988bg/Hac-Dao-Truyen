"""Test tools/build_hanviet.py bằng dữ liệu giả (không cần Unihan thật)."""
import gzip
import json
import zipfile

import pytest

from tools import build_hanviet as bh

FAKE_READINGS = """# Unihan_Readings.txt giả
U+6797\tkVietnamese\tlâm
U+6A02\tkVietnamese\tlạc
U+5973\tkVietnamese\tnữa nữ
U+5E1D\tkVietnamese\tđấy
U+548C\tkVietnamese\thoà
U+9673\tkVietnamese\ttrần
U+4E3B\tkVietnamese\tchúa
U+20000\tkVietnamese\tnôm
U+6797\tkMandarin\tlín
"""

FAKE_VARIANTS = """U+6A02\tkSimplifiedVariant\tU+4E50
U+4E50\tkTraditionalVariant\tU+4E50 U+6A02
U+9673\tkSimplifiedVariant\tU+9648
U+9648\tkTraditionalVariant\tU+9673
"""


@pytest.fixture
def unihan_dir(tmp_path):
    d = tmp_path / "unihan"
    d.mkdir()
    (d / "Unihan_Readings.txt").write_text(FAKE_READINGS, encoding="utf-8")
    (d / "Unihan_Variants.txt").write_text(FAKE_VARIANTS, encoding="utf-8")
    return d


@pytest.fixture
def novels_dir(tmp_path):
    root = tmp_path / "novels"
    a = root / "truyen-a"
    a.mkdir(parents=True)
    (a / "novel.json").write_text(json.dumps({
        "glossary": {
            "林凡": "Lâm Phàm",
            "乐天": "Nhạc Thiên",
            "乐园": "Lạc Viên",
            "快乐": "Khoái Lạc",
            "女帝": "Nữ Đế",
            "女帝陛下": "Nữ Đế bệ hạ",   # 4 chữ ↔ 4 âm tiết → hợp lệ
            "领主": "Lãnh chúa",
            "城主": "Thành Chủ",
            "主人": "Chủ nhân",
            "主角": "Chủ giác",
            "张三": "Trương Tam 3",      # có số → bỏ
            "林ABC": "Lâm A B C",        # khoá không toàn chữ Hán → bỏ
            "道友": "Bạn đạo hữu",       # 2 chữ ↔ 3 âm tiết → bỏ
            "天": "Trời",                # chỉ 1 lần, không có Unihan → vẫn nhận
        }
    }, ensure_ascii=False), encoding="utf-8")
    b = root / "truyen-b"
    b.mkdir()
    (b / "novel.json").write_text(json.dumps({
        "glossary": {"乐乐": "Nhạc Nhạc", "陈林": "Trần Lâm"}
    }, ensure_ascii=False), encoding="utf-8")
    # File hỏng không được làm sập script.
    c = root / "truyen-c"
    c.mkdir()
    (c / "novel.json").write_text("{không phải json", encoding="utf-8")
    return root


def test_normalize_syllable_kieu_dau_moi():
    assert bh.normalize_syllable("Hoà") == "hòa"
    assert bh.normalize_syllable("thuỷ") == "thủy"
    assert bh.normalize_syllable("khoẻ") == "khỏe"
    # Không đụng "qu" và âm tiết có phụ âm cuối.
    assert bh.normalize_syllable("quý") == "quý"
    assert bh.normalize_syllable("hoàn") == "hoàn"
    assert bh.normalize_syllable("LÂM") == "lâm"


def test_parse_unihan_lines_bo_qua_truong_khac():
    data = bh.parse_unihan_lines(FAKE_READINGS.splitlines(True))
    assert data["kVietnamese"]["林"] == "lâm"
    assert "林" not in data["kSimplifiedVariant"]
    assert data["kVietnamese"]["\U00020000"] == "nôm"


def test_load_unihan_tu_zip(tmp_path):
    z = tmp_path / "Unihan.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("Unihan_Readings.txt", FAKE_READINGS)
        zf.writestr("Unihan_Variants.txt", FAKE_VARIANTS)
    data = bh.load_unihan(z)
    assert data["kVietnamese"]["樂"] == "lạc"
    assert data["kTraditionalVariant"]["陈"] == "U+9673"


def test_count_glossary_chi_lay_cap_hop_le(novels_dir):
    counts = bh.count_glossary(bh.iter_glossary_pairs(novels_dir))
    assert counts["林"]["lâm"] == 2
    assert counts["乐"]["nhạc"] == 3 and counts["乐"]["lạc"] == 2
    assert counts["女"]["nữ"] == 2
    assert counts["陛"]["bệ"] == 1
    assert "三" not in counts          # cặp có số bị bỏ
    assert "友" not in counts          # lệch số âm tiết bị bỏ
    assert counts["天"]["trời"] == 1


def test_build_table_thu_tu_uu_tien(unihan_dir, novels_dir):
    unihan = bh.load_unihan(unihan_dir)
    counts = bh.count_glossary(bh.iter_glossary_pairs(novels_dir))
    table = bh.build_table(unihan, counts, {"帝": ["đế"]})

    # Glossary đứng trước Unihan; âm nhiều lần lên trước.
    assert table["乐"][:2] == ["nhạc", "lạc"]
    # Phồn thể dùng chung âm glossary của giản thể.
    assert table["樂"][:2] == ["nhạc", "lạc"]
    # Âm Nôm vẫn giữ nhưng sau âm glossary.
    assert table["女"] == ["nữ", "nữa"]
    # Override thay toàn bộ.
    assert table["帝"] == ["đế"]
    # Giản thể không có kVietnamese mượn từ phồn thể.
    assert table["陈"][0] == "trần"
    # Dấu kiểu cũ của Unihan được chuẩn hoá.
    assert table["和"] == ["hòa"]
    # Chữ ngoài BMP (Nôm) bị bỏ mặc định.
    assert "\U00020000" not in table
    # Chữ không có Unihan: nhận cả âm glossary xuất hiện 1 lần.
    assert set(table["天"]) == {"thiên", "trời"}


def test_build_table_loc_nhieu_glossary(unihan_dir, novels_dir):
    unihan = bh.load_unihan(unihan_dir)
    counts = bh.count_glossary(bh.iter_glossary_pairs(novels_dir))
    table = bh.build_table(unihan, counts, {})
    # 主: "chủ" 3 lần (≥ 2 và ≥ 25%) được nhận dù Unihan chỉ có "chúa".
    assert table["主"][0] == "chủ"
    assert "chúa" in table["主"]


def test_build_table_tu_choi_am_la_hiem(unihan_dir):
    unihan = bh.load_unihan(unihan_dir)
    from collections import Counter
    counts = {"林": Counter({"lâm": 9, "rừng": 1})}
    table = bh.build_table(unihan, counts, {})
    assert table["林"] == ["lâm"]


def test_all_planes_giu_chu_nom(unihan_dir):
    table = bh.build_table(bh.load_unihan(unihan_dir), {}, {}, all_planes=True)
    assert table["\U00020000"] == ["nôm"]


def test_build_khong_unihan_van_chay(novels_dir):
    counts = bh.count_glossary(bh.iter_glossary_pairs(novels_dir))
    table = bh.build_table(None, counts, {})
    assert table["林"] == ["lâm"]


def test_load_overrides(tmp_path):
    p = tmp_path / "o.json"
    p.write_text(json.dumps({
        "_comment": "ghi chú",
        "行": "Hành|hàng",
        "坏": "",
        "AB": "x",
    }, ensure_ascii=False), encoding="utf-8")
    ov = bh.load_overrides(p)
    assert ov == {"行": ["hành", "hàng"], "坏": []}
    table = bh.build_table(None, {"坏": {"hoại": 3}}, ov)
    assert "坏" not in table and table["行"] == ["hành", "hàng"]


def test_main_ghi_hai_file_dung_dinh_dang(tmp_path, unihan_dir, novels_dir, capsys):
    json_out = tmp_path / "out" / "hanviet.json"
    pa_out = tmp_path / "out" / "chinese_phienam.txt"
    before = sorted(p.name for p in novels_dir.rglob("*"))
    rc = bh.main([
        "--unihan", str(unihan_dir), "--novels", str(novels_dir),
        "--overrides", str(tmp_path / "khong-co.json"),
        "--json-out", str(json_out), "--phienam-out", str(pa_out),
    ])
    assert rc == 0
    # Không ghi gì vào novels/.
    assert sorted(p.name for p in novels_dir.rglob("*")) == before

    raw = json_out.read_bytes()
    data = json.loads(raw)
    assert data["林"] == "lâm"
    assert data["乐"].startswith("nhạc|")
    assert b": " not in raw and b", " not in raw   # JSON gọn

    # Định dạng mà VietphraseConverter đọc: "chữ=âm" (âm đầu tiên).
    lines = pa_out.read_text(encoding="utf-8").splitlines()
    assert "林=lâm" in lines and "乐=nhạc" in lines
    assert all(line.count("=") == 1 and "|" not in line for line in lines)

    out = capsys.readouterr().out
    assert "gzip" in out and "tổng số chữ" in out


def test_dry_run_khong_ghi(tmp_path, novels_dir):
    json_out = tmp_path / "x.json"
    rc = bh.main(["--novels", str(novels_dir), "--json-out", str(json_out),
                  "--phienam-out", str(tmp_path / "p.txt"), "--dry-run"])
    assert rc == 0 and not json_out.exists()


def test_phienam_doc_duoc_boi_vietphrase(tmp_path, monkeypatch, novels_dir):
    from tools.converter import vietphrase
    pa = tmp_path / "chinese_phienam.txt"
    table = bh.build_table(None, bh.count_glossary(bh.iter_glossary_pairs(novels_dir)), {})
    pa.write_text(bh.to_phienam_text(table), encoding="utf-8")
    monkeypatch.setattr(vietphrase, "PHIENAM_FILE", pa)
    conv = vietphrase.VietphraseConverter()
    assert conv.hanviet_dict["林"] == "lâm"


def test_kich_thuoc_json_nho():
    table = {chr(0x4E00 + i): ["âm"] for i in range(100)}
    raw = bh.to_json_bytes(table)
    assert len(gzip.compress(raw)) < len(raw)


def test_am_glossary_1_lan_khong_vuot_unihan(unihan_dir):
    """Âm glossary chỉ đứng trước Unihan khi xuất hiện ≥ 2 lần."""
    from collections import Counter
    unihan = bh.load_unihan(unihan_dir)
    # 女: Unihan "nữa nữ"; glossary "nữ" chỉ 1 lần → giữ thứ tự Unihan.
    assert bh.build_table(unihan, {"女": Counter({"nữ": 1})}, {})["女"] == ["nữa", "nữ"]
    # ≥ 2 lần → lên đầu.
    assert bh.build_table(unihan, {"女": Counter({"nữ": 2})}, {})["女"] == ["nữ", "nữa"]
    # Ngưỡng chỉnh được.
    assert bh.build_table(unihan, {"女": Counter({"nữ": 1})}, {}, min_promote_count=1)["女"][0] == "nữ"


def _main_args(tmp_path, novels_dir, pa_out, *extra):
    return ["--novels", str(novels_dir), "--overrides", str(tmp_path / "khong-co.json"),
            "--json-out", str(tmp_path / "hanviet.json"), "--phienam-out", str(pa_out), *extra]


def test_khong_ghi_de_phienam_lon_hon_tru_khi_force(tmp_path, novels_dir, capsys):
    pa_out = tmp_path / "chinese_phienam.txt"
    old = "".join(f"{chr(0x4E00 + i)}=x\n" for i in range(5000))
    pa_out.write_text(old, encoding="utf-8")
    # Chạy thiếu Unihan → bảng nhỏ hơn nhiều → từ chối, không ghi file nào.
    rc = bh.main(_main_args(tmp_path, novels_dir, pa_out))
    assert rc == 1
    assert pa_out.read_text(encoding="utf-8") == old
    assert not (tmp_path / "hanviet.json").exists()
    assert "--force" in capsys.readouterr().err
    # --force → ghi đè.
    assert bh.main(_main_args(tmp_path, novels_dir, pa_out, "--force")) == 0
    assert pa_out.read_text(encoding="utf-8") != old
    assert (tmp_path / "hanviet.json").exists()


def test_ghi_binh_thuong_khi_file_moi_khong_nho_hon(tmp_path, novels_dir):
    pa_out = tmp_path / "chinese_phienam.txt"
    pa_out.write_text("林=lâm\n", encoding="utf-8")
    assert bh.main(_main_args(tmp_path, novels_dir, pa_out)) == 0
    assert pa_out.read_text(encoding="utf-8").count("\n") > 1


def test_overrides_that_sua_am_nom_thuong_gap():
    """Bảng sửa tay của dự án: các chữ Unihan ghi âm Nôm phải có âm Hán Việt đúng."""
    ov = bh.load_overrides(bh.DEFAULT_OVERRIDES)
    assert ov["丕"][0] == "phi"
    assert ov["女"][0] == "nữ"


def test_du_lieu_da_sinh_dung_cho_丕():
    data = json.loads(bh.DEFAULT_JSON_OUT.read_text(encoding="utf-8"))
    assert data["丕"].split("|")[0] == "phi"
    lines = bh.DEFAULT_PHIENAM_OUT.read_text(encoding="utf-8").splitlines()
    assert "丕=phi" in lines
