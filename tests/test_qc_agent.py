"""
tests/test_qc_agent.py
------------------------
Test `check_translation_quality()` (agents/qc_agent.py) — hàm thuần Python,
KHÔNG gọi AI/network, KHÔNG cần google-adk cài đặt. Theo spec
docs/superpowers/specs/2026-09-10-adk-pass2-qc-design.md mục 7.
"""

from agents.qc_agent import check_translation_quality, MIN_LENGTH_RATIO, MAX_LENGTH_RATIO


# ── Hán tự sót ────────────────────────────────────────────────────────────

def test_fail_when_chinese_char_leftover():
    original = "这是一个测试章节。" * 5
    translated = "Đây là bản dịch còn sót 汉字 chưa dịch hết."
    passed, reason = check_translation_quality(original, translated)
    assert passed is False
    assert reason is not None
    assert "汉字" in reason or "Hán tự" in reason


def test_pass_when_no_chinese_char_and_ratio_ok():
    original = "这是一个测试章节，内容足够长以便计算比例。" * 3
    translated = "Đây là một chương thử nghiệm, nội dung đủ dài để tính tỷ lệ." * 3
    passed, reason = check_translation_quality(original, translated)
    assert passed is True
    assert reason is None


# ── Biên tỷ lệ độ dài — cả 2 hướng ──────────────────────────────────────

def test_ratio_exactly_min_boundary_passes():
    original = "x" * 100
    translated = "y" * int(100 * MIN_LENGTH_RATIO)  # ratio đúng = 0.3
    passed, reason = check_translation_quality(original, translated)
    assert passed is True
    assert reason is None


def test_ratio_just_below_min_boundary_fails():
    original = "x" * 100
    translated = "y" * (int(100 * MIN_LENGTH_RATIO) - 1)  # ratio < 0.3
    passed, reason = check_translation_quality(original, translated)
    assert passed is False
    assert "Tỷ lệ độ dài" in reason


def test_ratio_exactly_max_boundary_passes():
    original = "x" * 100
    translated = "y" * int(100 * MAX_LENGTH_RATIO)  # ratio đúng = 3.0
    passed, reason = check_translation_quality(original, translated)
    assert passed is True
    assert reason is None


def test_ratio_just_above_max_boundary_fails():
    original = "x" * 100
    translated = "y" * (int(100 * MAX_LENGTH_RATIO) + 1)  # ratio > 3.0
    passed, reason = check_translation_quality(original, translated)
    assert passed is False
    assert "Tỷ lệ độ dài" in reason


def test_ratio_in_range_passes():
    original = "x" * 100
    translated = "y" * 150  # ratio = 1.5, trong khoảng
    passed, reason = check_translation_quality(original, translated)
    assert passed is True
    assert reason is None


# ── Case biên khác ─────────────────────────────────────────────────────────

def test_empty_original_and_translated_fails():
    passed, reason = check_translation_quality("", "")
    assert passed is False
    assert reason is not None


def test_empty_original_but_nonempty_translated_passes():
    # Không chia được cho 0 — không nên coi là lỗi khi có bản dịch thật sự.
    passed, reason = check_translation_quality("", "Một câu dịch hợp lệ.")
    assert passed is True
    assert reason is None


def test_clean_case_pass_reason_none():
    original = "普通的测试内容，用来验证正常流程，这段文字需要足够长才能让比例落在合理范围内。"
    translated = "Nội dung kiểm thử bình thường, dùng để xác nhận luồng hoạt động đúng."
    passed, reason = check_translation_quality(original, translated)
    assert passed is True
    assert reason is None


def test_chinese_char_check_takes_priority_over_ratio():
    # Cả 2 điều kiện đều fail — Hán tự sót phải được báo cáo trước (không quan
    # trọng ratio nữa), theo đúng thứ tự spec mục 4.1.
    original = "x" * 100
    translated = "汉字" * 100  # vừa còn Hán tự vừa ratio bất thường (2.0, thực ra nằm trong range)
    passed, reason = check_translation_quality(original, translated)
    assert passed is False
    assert "Hán tự" in reason or "汉字" in reason
