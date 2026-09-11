"""
tests/test_orchestrator_pass2_qc.py
--------------------------------------
Test vòng QC + Pass 2 (polish) có điều kiện của agents/orchestrator.py
(`run_pass2_qc_for_chapter`) — theo spec
docs/superpowers/specs/2026-09-10-adk-pass2-qc-design.md mục 7.

Toàn bộ test mock `translate_chapter_standalone`/`polish_chapter_standalone`/
`check_translation_quality` ở cấp module `agents.orchestrator` — KHÔNG gọi
google.genai/network thật, KHÔNG cần cài google-adk (hàm test là
`run_pass2_qc_for_chapter`, hoàn toàn độc lập với ADK Runner/SequentialAgent).

Dự án không có pytest-asyncio cài sẵn — mọi coroutine được chạy bằng
`asyncio.run(...)` trong test function đồng bộ thông thường (không dùng
@pytest.mark.asyncio).
"""

import asyncio
import json

import pytest

import agents.orchestrator as orch
import agents as agents_pkg


# ── Helpers: fake standalone functions với side-effect theo thứ tự gọi ──────

def _sequence_async(outputs):
    """Trả về 1 async callable, mỗi lần gọi lấy phần tử tiếp theo trong `outputs`
    (dừng lại ở phần tử cuối nếu gọi nhiều hơn số phần tử có sẵn)."""
    state = {"n": 0}

    async def _fake(*args, **kwargs):
        i = min(state["n"], len(outputs) - 1)
        state["n"] += 1
        return outputs[i]

    _fake.state = state
    return _fake


def _sequence_sync(outputs):
    state = {"n": 0}

    def _fake(*args, **kwargs):
        i = min(state["n"], len(outputs) - 1)
        state["n"] += 1
        return outputs[i]

    _fake.state = state
    return _fake


def _usage(model="gemini-2.5-flash", tokens=10, cost=0.0):
    return {"model": model, "input_tokens": tokens // 2, "output_tokens": tokens // 2,
            "total_tokens": tokens, "cost_usd": cost}


def _run(coro):
    """
    Chạy 1 coroutine trong test đồng bộ (không cần pytest-asyncio). Dùng
    `asyncio.get_event_loop()` (giống helper trong tests/test_scraper_novel543.py)
    thay vì `asyncio.run()` — `asyncio.run()` tự đóng event loop sau mỗi lần
    gọi, làm hỏng `asyncio.get_event_loop()` (API cũ, không tự tạo lại loop)
    dùng ở các test module khác chạy chung tiến trình pytest.
    """
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _clear_adk_env(monkeypatch):
    """Đảm bảo mỗi test bắt đầu từ trạng thái cờ mặc định (tắt hết) — mỗi test
    tự set biến cần thiết, tránh rò rỉ giữa các test."""
    for name in ("ADK_QC_ENABLED", "ADK_PASS2_ENABLED", "ADK_QC_MAX_RETRY", "ADK_PASS2_MAX_RETRY"):
        monkeypatch.delenv(name, raising=False)


# ── (e) Cả 2 cờ tắt — không gọi QC/Polish nào cả ────────────────────────────

def test_flags_off_skips_qc_and_polish_entirely(monkeypatch):
    qc_fake = _sequence_sync([(True, None)])
    translate_fake = _sequence_async([("should_not_be_called", "summary", _usage())])
    polish_fake = _sequence_async([("should_not_be_called", _usage())])
    monkeypatch.setattr(orch, "check_translation_quality", qc_fake)
    monkeypatch.setattr(orch, "translate_chapter_standalone", translate_fake)
    monkeypatch.setattr(orch, "polish_chapter_standalone", polish_fake)

    result = _run(orch.run_pass2_qc_for_chapter(
        translator=object(),
        title="Chương 1",
        content="raw gốc",
        pass1_text="bản dịch pass 1",
        pass1_usage=_usage(tokens=100, cost=0.0),
    ))

    assert qc_fake.state["n"] == 0
    assert translate_fake.state["n"] == 0
    assert polish_fake.state["n"] == 0
    assert result["final_text"] == "bản dịch pass 1"
    assert result["stage"] == "pass1_qc_disabled"
    assert result["qc_passed"] is None
    assert result["qc_reason"] is None
    assert result["usage"]["total_tokens"] == 100


# ── (a) QC bật, fail 1 lần rồi pass (trong giới hạn retry) ──────────────────

def test_qc_only_fail_once_then_pass_retries_translator(monkeypatch):
    monkeypatch.setenv("ADK_QC_ENABLED", "true")
    monkeypatch.setenv("ADK_PASS2_ENABLED", "false")
    monkeypatch.setenv("ADK_QC_MAX_RETRY", "2")

    qc_fake = _sequence_sync([(False, "còn sót Hán tự"), (True, None)])
    translate_fake = _sequence_async([("bản dịch lần 2", "summary", _usage(tokens=20))])
    polish_fake = _sequence_async([("KHÔNG được gọi", _usage())])
    monkeypatch.setattr(orch, "check_translation_quality", qc_fake)
    monkeypatch.setattr(orch, "translate_chapter_standalone", translate_fake)
    monkeypatch.setattr(orch, "polish_chapter_standalone", polish_fake)

    result = _run(orch.run_pass2_qc_for_chapter(
        translator=object(),
        title="Chương 1",
        content="raw gốc",
        pass1_text="bản dịch lần 1",
        pass1_usage=_usage(tokens=10),
    ))

    assert translate_fake.state["n"] == 1        # đúng 1 lần retry
    assert polish_fake.state["n"] == 0            # Pass 2 tắt — không gọi
    assert result["final_text"] == "bản dịch lần 2"
    assert result["stage"] == "pass1_qc_pass"
    assert result["qc_passed"] is True
    assert result["usage"]["total_tokens"] == 30  # 10 (pass1) + 20 (retry)


# ── (b) QC bật, hết retry vẫn fail — dùng bản Pass 1 gốc + ghi failed_chapters ─

def test_qc_only_exhausts_retries_falls_back_to_last_pass1_and_records_failure(
    monkeypatch, tmp_path
):
    monkeypatch.chdir(tmp_path)
    slug = "demo-novel"
    (tmp_path / "novels" / slug).mkdir(parents=True)

    monkeypatch.setenv("ADK_QC_ENABLED", "true")
    monkeypatch.setenv("ADK_PASS2_ENABLED", "false")
    monkeypatch.setenv("ADK_QC_MAX_RETRY", "2")

    qc_fake = _sequence_sync([
        (False, "reason lần 0"),
        (False, "reason lần 1"),
        (False, "reason lần 2 (cuối)"),
    ])
    translate_fake = _sequence_async([
        ("bản retry 1", "summary", _usage(tokens=10)),
        ("bản retry 2 (cuối)", "summary", _usage(tokens=10)),
    ])
    monkeypatch.setattr(orch, "check_translation_quality", qc_fake)
    monkeypatch.setattr(orch, "translate_chapter_standalone", translate_fake)

    result = _run(orch.run_pass2_qc_for_chapter(
        translator=object(),
        title="Chương 2",
        content="raw gốc",
        pass1_text="bản gốc pass1",
        pass1_usage=_usage(tokens=10),
        novel_slug=slug,
        url="https://example.com/c2",
    ))

    assert translate_fake.state["n"] == 2  # đúng == ADK_QC_MAX_RETRY
    assert result["final_text"] == "bản retry 2 (cuối)"  # bản Pass 1 cuối cùng, CHƯA pass QC
    assert result["stage"] == "pass1_qc_fail"
    assert result["qc_passed"] is False
    assert result["qc_reason"] == "reason lần 2 (cuối)"

    failed_path = tmp_path / "novels" / slug / "failed_chapters.json"
    assert failed_path.is_file()
    entries = json.loads(failed_path.read_text(encoding="utf-8"))
    assert len(entries) == 1
    assert entries[0]["title"] == "Chương 2"
    assert entries[0]["url"] == "https://example.com/c2"
    assert "pass1" in entries[0]["error"]
    assert "2/2" in entries[0]["error"]
    assert "reason lần 2 (cuối)" in entries[0]["error"]


# ── (c) QC + Pass2 bật — polish fail 1 lần rồi pass ─────────────────────────

def test_qc_and_pass2_polish_fails_once_then_passes(monkeypatch):
    monkeypatch.setenv("ADK_QC_ENABLED", "true")
    monkeypatch.setenv("ADK_PASS2_ENABLED", "true")
    monkeypatch.setenv("ADK_QC_MAX_RETRY", "2")
    monkeypatch.setenv("ADK_PASS2_MAX_RETRY", "2")

    # check_translation_quality được gọi: 1 lần cho Pass1 (pass ngay), rồi
    # 1 lần cho polish đầu tiên (fail), rồi 1 lần cho polish sau retry (pass).
    qc_fake = _sequence_sync([
        (True, None),               # Pass 1 pass ngay — không cần translate retry
        (False, "văn phong lỗi"),   # QC2 lần đầu trên bản polish — fail
        (True, None),               # QC2 sau khi polish lại — pass
    ])
    translate_fake = _sequence_async([("KHÔNG được gọi", "summary", _usage())])
    polish_fake = _sequence_async([
        ("bản polish 1", _usage(tokens=15)),
        ("bản polish 2 (final)", _usage(tokens=15)),
    ])
    monkeypatch.setattr(orch, "check_translation_quality", qc_fake)
    monkeypatch.setattr(orch, "translate_chapter_standalone", translate_fake)
    monkeypatch.setattr(orch, "polish_chapter_standalone", polish_fake)

    result = _run(orch.run_pass2_qc_for_chapter(
        translator=object(),
        title="Chương 3",
        content="raw gốc",
        pass1_text="bản pass1 đã pass qc",
        pass1_usage=_usage(tokens=10),
    ))

    assert translate_fake.state["n"] == 0     # Pass 1 pass ngay, không retry
    assert polish_fake.state["n"] == 2        # 1 lần đầu + 1 retry
    assert result["final_text"] == "bản polish 2 (final)"
    assert result["stage"] == "polish_qc_pass"
    assert result["qc_passed"] is True
    assert result["usage"]["total_tokens"] == 10 + 15 + 15


# ── (d) QC + Pass2 bật — polish hết retry vẫn fail → dùng lại bản Pass 1 ────

def test_qc_and_pass2_polish_exhausts_retries_falls_back_to_pass1(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    slug = "demo-novel-2"
    (tmp_path / "novels" / slug).mkdir(parents=True)

    monkeypatch.setenv("ADK_QC_ENABLED", "true")
    monkeypatch.setenv("ADK_PASS2_ENABLED", "true")
    monkeypatch.setenv("ADK_QC_MAX_RETRY", "2")
    monkeypatch.setenv("ADK_PASS2_MAX_RETRY", "2")

    qc_fake = _sequence_sync([
        (True, None),                  # Pass 1 pass ngay
        (False, "polish lỗi lần 0"),
        (False, "polish lỗi lần 1"),
        (False, "polish lỗi lần 2 (cuối)"),
    ])
    translate_fake = _sequence_async([("KHÔNG được gọi", "summary", _usage())])
    polish_fake = _sequence_async([
        ("polish 0", _usage(tokens=5)),
        ("polish 1", _usage(tokens=5)),
        ("polish 2 (cuối)", _usage(tokens=5)),
    ])
    monkeypatch.setattr(orch, "check_translation_quality", qc_fake)
    monkeypatch.setattr(orch, "translate_chapter_standalone", translate_fake)
    monkeypatch.setattr(orch, "polish_chapter_standalone", polish_fake)

    result = _run(orch.run_pass2_qc_for_chapter(
        translator=object(),
        title="Chương 4",
        content="raw gốc",
        pass1_text="bản pass1 đã pass qc (giữ lại)",
        pass1_usage=_usage(tokens=10),
        novel_slug=slug,
        url="https://example.com/c4",
    ))

    assert polish_fake.state["n"] == 3  # 1 lần đầu + 2 retry (== ADK_PASS2_MAX_RETRY)
    assert result["final_text"] == "bản pass1 đã pass qc (giữ lại)"  # ưu tiên #2 — Pass 1 đã pass QC
    assert result["stage"] == "polish_qc_fail_fallback_pass1"
    assert result["qc_passed"] is False
    assert result["qc_reason"] == "polish lỗi lần 2 (cuối)"

    failed_path = tmp_path / "novels" / slug / "failed_chapters.json"
    entries = json.loads(failed_path.read_text(encoding="utf-8"))
    assert len(entries) == 1
    assert "pass2" in entries[0]["error"]
    assert "2/2" in entries[0]["error"]
    assert "polish lỗi lần 2 (cuối)" in entries[0]["error"]


# ── (f) QC tắt, Pass2 bật — polish chạy 1 lần, không có QC gate/retry ───────

def test_qc_disabled_pass2_enabled_polishes_unconditionally_once(monkeypatch):
    monkeypatch.setenv("ADK_QC_ENABLED", "false")
    monkeypatch.setenv("ADK_PASS2_ENABLED", "true")

    qc_fake = _sequence_sync([(True, None)])
    translate_fake = _sequence_async([("KHÔNG được gọi", "summary", _usage())])
    polish_fake = _sequence_async([("bản polish duy nhất", _usage(tokens=8))])
    monkeypatch.setattr(orch, "check_translation_quality", qc_fake)
    monkeypatch.setattr(orch, "translate_chapter_standalone", translate_fake)
    monkeypatch.setattr(orch, "polish_chapter_standalone", polish_fake)

    result = _run(orch.run_pass2_qc_for_chapter(
        translator=object(),
        title="Chương 5",
        content="raw gốc",
        pass1_text="bản pass1",
        pass1_usage=_usage(tokens=10),
    ))

    assert qc_fake.state["n"] == 0        # QC tắt — không gọi check nào
    assert translate_fake.state["n"] == 0
    assert polish_fake.state["n"] == 1    # polish 1 lần, không retry (không có QC gate)
    assert result["final_text"] == "bản polish duy nhất"
    assert result["stage"] == "polish_no_qc"
    assert result["qc_passed"] is None
    assert result["qc_reason"] is None


# ── Giới hạn retry âm/quá lớn (agents/__init__.py) — fallback về default ────

@pytest.mark.parametrize("raw_value", ["-1", "999", "abc", ""])
def test_qc_max_retry_invalid_values_fallback_to_default(monkeypatch, raw_value):
    monkeypatch.setenv("ADK_QC_MAX_RETRY", raw_value)
    assert agents_pkg.get_qc_max_retry() == 2


@pytest.mark.parametrize("raw_value", ["-5", "1000", "xyz"])
def test_pass2_max_retry_invalid_values_fallback_to_default(monkeypatch, raw_value):
    monkeypatch.setenv("ADK_PASS2_MAX_RETRY", raw_value)
    assert agents_pkg.get_pass2_max_retry() == 2


def test_qc_max_retry_valid_value_is_respected(monkeypatch):
    monkeypatch.setenv("ADK_QC_MAX_RETRY", "5")
    assert agents_pkg.get_qc_max_retry() == 5


def test_flags_default_off_when_unset():
    assert agents_pkg.is_qc_enabled() is False
    assert agents_pkg.is_pass2_enabled() is False
