"""
test_translator_parser.py
--------------------------
D01 — Parser batch gán sai chương.

Tái hiện (TDD) các trường hợp response AI bị lỗi marker khi dịch batch nhiều
chương: marker thiếu, marker trùng, marker đảo thứ tự, lời dẫn ngoài marker,
chương thừa không được yêu cầu. Không gọi AI thật — chỉ dùng response fixture
giả lập (string dựng tay) để test hàm parse_batch_response.

Yêu cầu (theo kế hoạch D01):
  - Gán nội dung vào đúng chương phải dựa vào SỐ trong marker (index), không
    dựa vào thứ tự xuất hiện trong response.
  - Phát hiện rõ ràng: thiếu / trùng / đảo thứ tự / lời dẫn ngoài marker /
    chương thừa — trả lỗi thay vì gán bừa.
  - Chỉ những chương lỗi mới là None (để caller retry riêng lẻ đúng chương đó,
    không dịch lại toàn batch).
"""
from translator import parse_batch_response


def _batch_raw(chapters: dict[int, str], summary: str = "Tóm tắt.", glossary: str = "{}") -> str:
    """Dựng 1 response batch fixture từ dict {index: content}, theo đúng thứ tự dict truyền vào
    (không tự sắp xếp) để mô phỏng cả trường hợp model trả marker đúng thứ tự lẫn đảo thứ tự."""
    body = ""
    for idx, content in chapters.items():
        body += f"\n\n=== CHAPTER {idx} ===\n{content}\n"
    return f"{body}\n\n%%SUMMARY%%\n{summary}\n\n%%GLOSSARY%%\n{glossary}"


def test_happy_path_dung_thu_tu_gan_dung_tung_chuong():
    """Baseline: marker đủ, đúng thứ tự — nội dung phải khớp đúng chỉ số."""
    raw = _batch_raw({0: "Nội dung chương không." * 10, 1: "Nội dung chương một." * 10})
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=2)

    assert validated[0].startswith("Nội dung chương không.")
    assert validated[1].startswith("Nội dung chương một.")
    assert summary == "Tóm tắt."
    assert errors == []


def test_marker_thieu_1_chuong_chi_o_bi_gan_none():
    """Response thiếu marker CHAPTER 1 trong batch 3 chương — chỉ chương 1 là None,
    chương 0 và 2 vẫn phải được gán ĐÚNG vị trí (không bị dồn/lệch index)."""
    raw = _batch_raw({0: "Nội dung không." * 10, 2: "Nội dung hai." * 10})
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=3)

    assert validated[0].startswith("Nội dung không.")
    assert validated[1] is None                       # thiếu -> None, không bị gán nhầm nội dung chương 2
    assert validated[2].startswith("Nội dung hai.")    # PHẢI vẫn ở đúng vị trí index 2, không bị dồn xuống 1
    assert any("Thiếu nội dung" in e or "thiếu" in e.lower() for e in errors)


def test_marker_trung_so_khong_tu_gan_ban_nao():
    """Cùng số CHAPTER 0 xuất hiện 2 lần với nội dung khác nhau — không được tự ý
    chọn 1 bản, phải trả None (ambiguous) + lỗi rõ ràng để retry riêng."""
    raw = (
        "=== CHAPTER 0 ===\nBản thứ nhất của chương không." * 5 +
        "\n\n=== CHAPTER 0 ===\nBản thứ hai khác hẳn của chương không." * 5 +
        "\n\n=== CHAPTER 1 ===\n" + "Nội dung chương một." * 10 +
        "\n\n%%SUMMARY%%\nTóm tắt."
    )
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=2)

    assert validated[0] is None
    assert validated[1].startswith("Nội dung chương một.")
    assert any("TRÙNG" in e for e in errors)


def test_marker_dao_thu_tu_van_gan_dung_theo_index():
    """Model trả CHAPTER 1 TRƯỚC CHAPTER 0 trong raw text (đảo thứ tự so với input) —
    kết quả PHẢI vẫn gán đúng theo số marker (index), không theo thứ tự xuất hiện.
    Đây là lỗi nghiêm trọng nhất được review chỉ ra: nếu dùng thứ tự xuất hiện thay vì
    index, nội dung chương 1 sẽ bị gán nhầm vào file chương 0."""
    raw = (
        "=== CHAPTER 1 ===\n" + "Đây là nội dung chương một thật sự. " * 10 +
        "\n\n=== CHAPTER 0 ===\n" + "Đây là nội dung chương không thật sự. " * 10 +
        "\n\n%%SUMMARY%%\nTóm tắt."
    )
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=2)

    assert validated[0].startswith("Đây là nội dung chương không thật sự.")
    assert validated[1].startswith("Đây là nội dung chương một thật sự.")
    assert any("thứ tự" in e.lower() for e in errors)


def test_loi_dan_ngoai_marker_khong_bi_gop_vao_chuong_dau():
    """Model viết lời dẫn/giải thích trước marker đầu tiên — không được gộp
    nhầm vào nội dung chương 0, và phải được phát hiện/ghi lại trong errors."""
    raw = (
        "Dưới đây là bản dịch hoàn chỉnh của 2 chương theo yêu cầu:\n\n"
        "=== CHAPTER 0 ===\n" + "Nội dung chương không sạch. " * 10 +
        "\n\n=== CHAPTER 1 ===\n" + "Nội dung chương một sạch. " * 10 +
        "\n\n%%SUMMARY%%\nTóm tắt."
    )
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=2)

    assert validated[0].startswith("Nội dung chương không sạch.")
    assert "Dưới đây là bản dịch" not in validated[0]
    assert validated[1].startswith("Nội dung chương một sạch.")
    assert any("lời dẫn" in e.lower() or "ngoài marker" in e.lower() for e in errors)


def test_chuong_thua_khong_duoc_yeu_cau_bi_bo_qua_va_bao_loi():
    """Response trả nhiều hơn số chương yêu cầu (model tự dịch thêm) — chương thừa
    phải bị bỏ qua (không lọt vào validated) và được ghi lại thành lỗi/cảnh báo."""
    raw = _batch_raw({
        0: "Nội dung chương không." * 10,
        1: "Nội dung chương một." * 10,
        2: "Nội dung chương thừa không ai yêu cầu." * 10,
    })
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=2)

    assert len(validated) == 2
    assert validated[0].startswith("Nội dung chương không.")
    assert validated[1].startswith("Nội dung chương một.")
    assert any("THỪA" in e for e in errors)


def test_khong_co_marker_nao_batch_nhieu_chuong_khong_duoc_doan_bua():
    """Model bỏ hết marker dù được yêu cầu dịch nhiều chương — không được đoán
    cắt raw thành N phần bừa bãi; phải trả toàn bộ None + lỗi rõ ràng để retry riêng."""
    raw = "Một đoạn văn dài không có marker nào cả. " * 20 + "\n\n%%SUMMARY%%\nTóm tắt."
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=3)

    assert validated == [None, None, None]
    assert any("marker" in e.lower() for e in errors)


def test_khong_co_marker_batch_1_chuong_van_nhan_toan_bo_raw():
    """Batch chỉ có 1 chương và model bỏ marker — vẫn chấp nhận toàn bộ nội dung
    làm chương duy nhất (không có gì để nhầm lẫn khi chỉ có 1 chương)."""
    raw = "Nội dung chương duy nhất không có marker. " * 10 + "\n\n%%SUMMARY%%\nTóm tắt."
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=1)

    assert validated[0].startswith("Nội dung chương duy nhất")
    assert errors == []


def test_marker_co_noi_dung_rong_bi_gan_none_de_retry():
    raw = (
        "=== CHAPTER 0 ===\n\n"
        "=== CHAPTER 1 ===\n" + "Nội dung chương một." * 10 +
        "\n\n%%SUMMARY%%\nTóm tắt."
    )
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=2)

    assert validated[0] is None
    assert validated[1].startswith("Nội dung chương một.")
    assert any("RỖNG" in e for e in errors)


def test_glossary_va_summary_van_duoc_parse_dung_khi_co_loi_marker():
    """Dù marker bị lỗi (thiếu chương 1), %%SUMMARY%% và %%GLOSSARY%% vẫn phải
    được tách đúng — lỗi parser 1 phần không được làm hỏng phần còn lại."""
    raw = (
        "=== CHAPTER 0 ===\n" + "Nội dung chương không." * 10 +
        '\n\n%%SUMMARY%%\nBatch tóm tắt cuối.\n\n%%GLOSSARY%%\n{"甲": "Giáp"}'
    )
    validated, summary, glossary, errors = parse_batch_response(raw, num_chapters=2)

    assert validated[0].startswith("Nội dung chương không.")
    assert validated[1] is None
    assert summary == "Batch tóm tắt cuối."
    assert glossary == {"甲": "Giáp"}
