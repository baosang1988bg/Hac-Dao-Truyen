"""Test phần thuần của tools/tts_pregen.py (khung TTS server — không sinh audio)."""
import json

import pytest

from tools import tts_pregen as tp


# ── Cờ bật/tắt ───────────────────────────────────────────────────────────────

def test_is_enabled_mac_dinh_tat():
    assert tp.is_enabled({}) is False
    assert tp.is_enabled({"HACDAO_TTS_ENABLED": "0"}) is False
    assert tp.is_enabled({"HACDAO_TTS_ENABLED": "false"}) is False
    for v in ("1", "true", "YES", " on "):
        assert tp.is_enabled({"HACDAO_TTS_ENABLED": v}) is True


# ── Markdown → đoạn (khớp .reader-p) ─────────────────────────────────────────

def test_markdown_paragraphs_bo_heading_hr_list():
    md = (
        "# Chương 1: Mở đầu\n\n"
        "Đoạn **một** dòng 1\ndòng 2 của đoạn một.\n\n"
        "---\n\n"
        "> Trích dẫn vẫn là đoạn.\n\n"
        "- mục danh sách\n- mục 2\n\n"
        "Tiêu đề setext\n===\n\n"
        "Xem [liên kết](https://x.y) và `mã` _nghiêng_.\n"
    )
    assert tp.markdown_paragraphs(md) == [
        "Đoạn một dòng 1 dòng 2 của đoạn một.",
        "Trích dẫn vẫn là đoạn.",
        "Xem liên kết và mã nghiêng.",
    ]


def test_markdown_paragraphs_setext_gach_ngang_khong_phai_doan():
    # CommonMark: "chữ\n---" là heading h2 (không sinh <p>), "\n\n---" mới là đường kẻ.
    assert tp.markdown_paragraphs("Tác giả nói\n---\n\nNội dung.") == ["Nội dung."]
    assert tp.markdown_paragraphs("A.\n\n---\n\nB.") == ["A.", "B."]
    assert tp.markdown_paragraphs("") == []
    assert tp.markdown_paragraphs(None) == []
    assert tp.markdown_paragraphs("A\r\n\r\nB") == ["A", "B"]


# ── Tách khúc ────────────────────────────────────────────────────────────────

def test_split_paragraph_theo_cau_va_gioi_han():
    sentence = "Hắc phong gào thét, trăng lạnh treo cao trên đỉnh núi mờ sương."
    para = " ".join([sentence] * 12)
    chunks = tp.split_paragraph(para)
    assert len(chunks) > 1
    assert all(len(c) <= tp.CHUNK_MAX for c in chunks)
    assert all(c.endswith(".") for c in chunks)
    assert " ".join(chunks) == para


def test_split_paragraph_cau_qua_dai_va_tu_qua_dai():
    clause = ", ".join(f"vế{i}" for i in range(30)) + "."
    chunks = tp.split_paragraph(clause, 50)
    assert all(len(c) <= 50 for c in chunks)
    assert " ".join(chunks) == clause
    assert [len(c) for c in tp.split_paragraph("x" * 130, 50)] == [50, 50, 30]
    assert tp.split_paragraph("   ") == []


def test_build_chunks_giu_chi_so_doan():
    long = "Một câu khá dài để kiểm tra tách khúc theo câu văn. " * 10
    chunks = tp.build_chunks(["Đoạn 0.", "", long, "Đoạn 3."])
    assert chunks[0] == {"p": 0, "text": "Đoạn 0."}
    assert not any(c["p"] == 1 for c in chunks)
    assert sum(1 for c in chunks if c["p"] == 2) > 1
    assert chunks[-1]["p"] == 3
    assert all(len(c["text"]) <= tp.CHUNK_MAX for c in chunks)


# ── Mốc đoạn từ thời lượng khúc ──────────────────────────────────────────────

def test_paragraph_marks_gop_khuc_cung_doan():
    chunks = [{"p": 0, "text": "a"}, {"p": 2, "text": "b1"}, {"p": 2, "text": "b2"}, {"p": 3, "text": "c"}]
    marks = tp.paragraph_marks(chunks, [1000, 1500.4, 2000, 500])
    assert marks == [
        {"p": 0, "start_ms": 0, "end_ms": 1000},
        {"p": 2, "start_ms": 1000, "end_ms": 4500},
        {"p": 3, "start_ms": 4500, "end_ms": 5000},
    ]
    assert tp.paragraph_marks([], []) == []


def test_paragraph_marks_loi_dau_vao():
    with pytest.raises(ValueError):
        tp.paragraph_marks([{"p": 0, "text": "a"}], [])
    with pytest.raises(ValueError):
        tp.paragraph_marks([{"p": 0, "text": "a"}], [-1])
    with pytest.raises(ValueError):
        tp.paragraph_marks([{"p": 0, "text": "a"}], [float("nan")])


def test_chapter_manifest():
    m = tp.chapter_manifest("s", 3, tp.DEFAULT_VOICE, [{"p": 0, "text": "a"}], [1234])
    assert m == {"v": 1, "slug": "s", "chapter": 3, "voice": tp.DEFAULT_VOICE,
                 "duration_ms": 1234, "paragraphs": [{"p": 0, "start_ms": 0, "end_ms": 1234}]}


# ── Khoá R2 + ước tính ───────────────────────────────────────────────────────

def test_r2_keys():
    assert tp.r2_keys("tien-nghich", "vi-VN-HoaiMyNeural", 12) == (
        "tien-nghich/tts/vi-VN-HoaiMyNeural/12.mp3",
        "tien-nghich/tts/vi-VN-HoaiMyNeural/12.json",
    )
    for bad in [("../x", "v", 1), ("a/b", "v", 1), ("s", "v/../x", 1), ("", "v", 1), ("s", "v", -1),
                ("s", "v", "1"), ("s", "v", True)]:
        with pytest.raises(ValueError):
            tp.r2_keys(*bad)


def test_estimate_bytes():
    # 15 ký tự/giây, 48 kbps = 6000 byte/giây → 1500 ký tự = 100 giây = 600 000 byte.
    assert tp.estimate_bytes(1500) == 600_000
    assert tp.estimate_bytes(0) == 0
    assert tp.estimate_seconds(-5) == 0
    assert tp.fmt_bytes(512) == "512 B"
    assert tp.fmt_bytes(600_000) == "585.9 KB"


def test_parse_range():
    assert tp.parse_range(None) is None
    assert tp.parse_range("5") == (5, 5)
    assert tp.parse_range(" 1 - 20 ") == (1, 20)
    for bad in ("x", "5-1", "1-2-3"):
        with pytest.raises(ValueError):
            tp.parse_range(bad)


# ── Provider stub ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("cls", [tp.EdgeTtsProvider, tp.AzureSpeechProvider])
def test_provider_stub_nem_not_implemented(cls):
    with pytest.raises(NotImplementedError, match="chưa được cài"):
        cls().synthesize("xin chào", tp.DEFAULT_VOICE)


# ── CLI (novels dir tạm) ─────────────────────────────────────────────────────

@pytest.fixture
def novels_dir(tmp_path):
    t = tmp_path / "truyen-a" / "translated"
    t.mkdir(parents=True)
    (t / "Chương 1 - Mở đầu_VI.md").write_text("# Chương 1\n\nĐoạn một.\n\nĐoạn hai.\n", encoding="utf-8")
    (t / "Chương 2 - Tiếp_VI.md").write_text("# Chương 2\n\n" + "Câu dài lắm. " * 40, encoding="utf-8")
    (t / "ghi-chu.txt").write_text("bỏ qua", encoding="utf-8")
    return str(tmp_path)


def test_plan_novel(novels_dir):
    plans = tp.plan_novel("truyen-a", novels_dir=novels_dir)
    assert [p.chapter for p in plans] == [1, 2]
    assert plans[0].paragraphs == 2 and plans[0].chunks == 2
    assert plans[1].chunks > 1
    assert plans[0].mp3_key == "truyen-a/tts/vi-VN-HoaiMyNeural/1.mp3"
    assert [p.chapter for p in tp.plan_novel("truyen-a", chapters=(2, 2), novels_dir=novels_dir)] == [2]
    with pytest.raises(FileNotFoundError):
        tp.plan_novel("khong-co", novels_dir=novels_dir)


def test_main_tat_thi_thoat_som(novels_dir, capsys):
    rc = tp.main(["--novel", "truyen-a", "--novels-dir", novels_dir], env={})
    assert rc == tp.EXIT_DISABLED
    assert "[TẮT]" in capsys.readouterr().out


def test_main_dry_run_khi_tat_van_in_ke_hoach(novels_dir, capsys):
    rc = tp.main(["--novel", "truyen-a", "--dry-run", "--novels-dir", novels_dir], env={})
    out = capsys.readouterr().out
    assert rc == 0
    assert "[DRY-RUN]" in out and "Tổng: 2 chương" in out and "truyen-a/tts/" in out

    rc = tp.main(["--novel", "truyen-a", "--dry-run", "--json", "--chapters", "1", "--novels-dir", novels_dir], env={})
    data = json.loads(capsys.readouterr().out)
    assert rc == 0 and len(data) == 1 and data[0]["chapter"] == 1 and "chunk_list" not in data[0]


def test_main_bat_nhung_provider_chua_cai(novels_dir, capsys):
    rc = tp.main(["--novel", "truyen-a", "--chapters", "1", "--novels-dir", novels_dir],
                 env={"HACDAO_TTS_ENABLED": "1"})
    assert rc == tp.EXIT_PROVIDER
    assert "CHƯA HỖ TRỢ" in capsys.readouterr().err


def test_main_loi_truyen_khong_ton_tai(novels_dir):
    assert tp.main(["--novel", "khong-co", "--dry-run", "--novels-dir", novels_dir], env={}) == tp.EXIT_NOT_FOUND
    assert tp.main(["--novel", "truyen-a", "--dry-run", "--chapters", "x", "--novels-dir", novels_dir],
                   env={}) == tp.EXIT_NOT_FOUND
