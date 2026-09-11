"""
test_pipeline_glossary.py
--------------------------
D02 — Glossary nhất quán.

Không gọi AI thật: dùng novel_manager.create_novel (fixture local, đã có
autouse isolated_app trong conftest.py cô lập NOVELS_BASE_DIR vào tmp_path)
và gọi thẳng các hàm pipeline (update_profile_glossary_safely, _finish_batch,
TranslationContext) với dữ liệu giả lập.

Phạm vi kiểm tra:
  - Validate shape term (key/value phải là string không rỗng).
  - Term mới hợp lệ được ghi + revision tăng.
  - Term đã có nhưng AI đề xuất nghĩa khác -> KHÔNG ghi đè, trả về conflict.
  - Term đã có với đúng giá trị cũ -> không phải conflict, không tăng revision.
  - Snapshot/summary không bị cập nhật sai thứ tự khi batch hoàn thành không
    theo thứ tự dispatch (batch seq lớn hơn xong trước, batch seq nhỏ hơn
    xong sau không được làm "tụt lùi" previous_summary).
"""
import argparse
import logging

import novel_manager
import pipeline


def _make_profile(slug="glossary-test-novel"):
    return novel_manager.create_novel(
        "Glossary Test Novel", "", slug=slug, glossary={"甲": "Giáp"}
    )


def _make_ctx(profile, chapters=10):
    args = argparse.Namespace(chapters=chapters)
    logger = logging.getLogger("test-pipeline-glossary")
    ctx = pipeline.TranslationContext(
        args=args,
        profile=profile,
        logger=logger,
        translator=None,
        report_progress=lambda *a, **k: None,
        is_cancelled=lambda: False,
    )
    return ctx


# ── Validate shape ────────────────────────────────────────────────────────────

def test_term_khong_hop_le_bi_bo_qua_khong_ghi():
    profile = _make_profile("glossary-invalid-shape")
    added, glossary, conflicts = pipeline.update_profile_glossary_safely(
        profile.slug,
        {"": "rỗng key", "  ": "  ", "Hợp Lệ": "Valid", "Số": 123, "Rỗng value": ""},
        logger=None,
    )
    assert added == 1
    assert "Hợp Lệ" in glossary and glossary["Hợp Lệ"] == "Valid"
    assert "" not in glossary
    assert "Số" not in glossary
    assert "Rỗng value" not in glossary
    assert conflicts == []


# ── Term mới + revision ──────────────────────────────────────────────────────

def test_term_moi_duoc_ghi_va_revision_tang():
    profile = _make_profile("glossary-new-term-revision")
    rev_before = pipeline.current_glossary_revision(profile.slug)
    added, glossary, conflicts = pipeline.update_profile_glossary_safely(
        profile.slug, {"新名字": "Tên Mới"}, logger=None
    )
    rev_after = pipeline.current_glossary_revision(profile.slug)

    assert added == 1
    assert glossary["新名字"] == "Tên Mới"
    assert rev_after == rev_before + 1
    assert conflicts == []


# ── Conflict: term đã có, AI đề xuất nghĩa khác ──────────────────────────────

def test_term_da_co_nghia_khac_bi_coi_la_conflict_khong_ghi_de():
    profile = _make_profile("glossary-conflict")
    # "甲" đã có nghĩa "Giáp" (khởi tạo lúc create_novel)
    added, glossary, conflicts = pipeline.update_profile_glossary_safely(
        profile.slug, {"甲": "Nghĩa Khác Hoàn Toàn"}, logger=None
    )

    assert added == 0
    assert glossary["甲"] == "Giáp"          # KHÔNG bị ghi đè
    assert len(conflicts) == 1
    assert conflicts[0]["term"] == "甲"
    assert conflicts[0]["current_value"] == "Giáp"
    assert conflicts[0]["suggested_value"] == "Nghĩa Khác Hoàn Toàn"

    # Conflict phải được ghi lại persistent (glossary_meta.json), không chỉ
    # trả về 1 lần rồi mất — để admin có thể xem lại sau.
    meta = pipeline._load_glossary_meta(profile.slug)
    assert any(c["term"] == "甲" for c in meta["conflicts"])


def test_term_da_co_dung_gia_tri_cu_khong_phai_conflict():
    profile = _make_profile("glossary-same-value")
    added, glossary, conflicts = pipeline.update_profile_glossary_safely(
        profile.slug, {"甲": "Giáp"}, logger=None
    )
    assert added == 0
    assert conflicts == []


def test_conflict_khong_lam_tang_revision():
    profile = _make_profile("glossary-conflict-no-revision-bump")
    rev_before = pipeline.current_glossary_revision(profile.slug)
    pipeline.update_profile_glossary_safely(profile.slug, {"甲": "Khác"}, logger=None)
    rev_after = pipeline.current_glossary_revision(profile.slug)
    assert rev_after == rev_before


# ── Summary không bị tụt lùi khi batch hoàn thành sai thứ tự ─────────────────

def test_finish_batch_khong_tut_lui_khi_batch_cu_xong_tre():
    """Batch seq=1 (dispatch sau, có thể là chương mới hơn) hoàn thành TRƯỚC
    batch seq=0 (dispatch trước) — mô phỏng batch chạy song song, batch 0 bị
    rate-limit/retry lâu hơn batch 1. Khi batch 0 xong trễ, previous_summary
    (đã được batch 1 set) KHÔNG được phép bị ghi đè lùi lại bởi summary cũ
    hơn của batch 0."""
    profile = _make_profile("glossary-summary-order")
    ctx = _make_ctx(profile)

    batch0 = [("Chương 1", "nội dung 1")]
    batch1 = [("Chương 2", "nội dung 2")]

    # batch1 (seq=1) hoàn thành trước
    pipeline._finish_batch(ctx, batch1, ["url2"], {}, "Tóm tắt batch 1 (mới hơn)", batch_seq=1)
    assert ctx.previous_summary == "Tóm tắt batch 1 (mới hơn)"
    assert ctx.last_applied_summary_seq == 1

    # batch0 (seq=0) hoàn thành SAU — summary của nó CŨ hơn, không được ghi đè
    pipeline._finish_batch(ctx, batch0, ["url1"], {}, "Tóm tắt batch 0 (cũ hơn)", batch_seq=0)
    assert ctx.previous_summary == "Tóm tắt batch 1 (mới hơn)"
    assert ctx.last_applied_summary_seq == 1


def test_finish_batch_van_cap_nhat_dung_thu_tu_binh_thuong():
    """Trường hợp bình thường: batch hoàn thành đúng thứ tự dispatch (0 rồi 1)
    — previous_summary phải theo đúng batch mới nhất."""
    profile = _make_profile("glossary-summary-order-normal")
    ctx = _make_ctx(profile)

    pipeline._finish_batch(ctx, [("Chương 1", "c1")], ["url1"], {}, "Tóm tắt 0", batch_seq=0)
    assert ctx.previous_summary == "Tóm tắt 0"

    pipeline._finish_batch(ctx, [("Chương 2", "c2")], ["url2"], {}, "Tóm tắt 1", batch_seq=1)
    assert ctx.previous_summary == "Tóm tắt 1"


def test_finish_batch_khong_co_seq_van_tuong_thich_nguoc():
    """batch_seq=None (caller cũ không truyền) — giữ hành vi cũ: luôn cập nhật."""
    profile = _make_profile("glossary-summary-no-seq")
    ctx = _make_ctx(profile)
    pipeline._finish_batch(ctx, [("Chương 1", "c1")], ["url1"], {}, "Tóm tắt A")
    assert ctx.previous_summary == "Tóm tắt A"
    pipeline._finish_batch(ctx, [("Chương 2", "c2")], ["url2"], {}, "Tóm tắt B")
    assert ctx.previous_summary == "Tóm tắt B"


# ── glossary_conflicts được gom vào session_usage của phiên dịch ────────────

def test_finish_batch_gom_conflict_vao_session_usage():
    profile = _make_profile("glossary-session-usage-conflict")
    ctx = _make_ctx(profile)
    pipeline._finish_batch(
        ctx, [("Chương 1", "c1")], ["url1"], {"甲": "Nghĩa khác"}, "Tóm tắt", batch_seq=0
    )
    assert len(ctx.session_usage["glossary_conflicts"]) == 1
    assert ctx.session_usage["glossary_conflicts"][0]["term"] == "甲"
