import json

from tools import auto_check_novel


class _FakeResponse:
    def __init__(self, body: str):
        self._body = body.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self._body


def test_fetch_latest_chapters_parses_links(monkeypatch):
    def fake_urlopen(request, timeout):
        assert request.get_header("X-no-cache") == "true"
        assert timeout == 30
        return _FakeResponse(
            "* [第1512章 跨界征軍](https://www.novel543.com/0606657941/8096_1512.html)\n"
            "* [第1513章 一戰功成](https://www.novel543.com/0606657941/8096_1513.html)"
        )

    monkeypatch.setattr(auto_check_novel.urllib.request, "urlopen", fake_urlopen)

    chapters = auto_check_novel.fetch_latest_chapters("https://r.jina.ai/https://example.com/novel/")

    assert [c["number"] for c in chapters] == [1512, 1513]
    assert chapters[0]["url"] == "https://www.novel543.com/0606657941/8096_1512.html"


def test_discover_auto_check_slugs_reads_novel_json_flag(tmp_path, monkeypatch):
    novels_dir = tmp_path / "novels"
    (novels_dir / "truyen-bat").mkdir(parents=True)
    (novels_dir / "truyen-tat").mkdir(parents=True)
    (novels_dir / "truyen-khong-cau-hinh").mkdir(parents=True)

    (novels_dir / "truyen-bat" / "novel.json").write_text(
        json.dumps({"slug": "truyen-bat", "auto_check": {"enabled": True, "source_index_url": "https://x/"}}),
        encoding="utf-8",
    )
    (novels_dir / "truyen-tat" / "novel.json").write_text(
        json.dumps({"slug": "truyen-tat", "auto_check": {"enabled": False}}),
        encoding="utf-8",
    )
    (novels_dir / "truyen-khong-cau-hinh" / "novel.json").write_text(
        json.dumps({"slug": "truyen-khong-cau-hinh"}),
        encoding="utf-8",
    )

    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", novels_dir)

    assert auto_check_novel.discover_auto_check_slugs() == ["truyen-bat"]


def test_check_and_translate_novel_skips_when_auto_check_config_missing(tmp_path, monkeypatch):
    novels_dir = tmp_path / "novels"
    novel_dir = novels_dir / "truyen-thieu-cau-hinh"
    novel_dir.mkdir(parents=True)
    (novel_dir / "novel.json").write_text(
        json.dumps({"slug": "truyen-thieu-cau-hinh", "last_chapter_number": 5}),
        encoding="utf-8",
    )

    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", novels_dir)

    # Không có auto_check.source_index_url → bỏ qua êm, KHÔNG raise, KHÔNG
    # gọi mạng/dịch — đây là hành vi "cấu hình thiếu" khác với "lỗi hạ tầng".
    assert auto_check_novel.check_and_translate_novel("truyen-thieu-cau-hinh") is True


def test_check_and_translate_novel_reports_no_new_chapters(tmp_path, monkeypatch):
    novels_dir = tmp_path / "novels"
    novel_dir = novels_dir / "truyen-da-cap-nhat"
    novel_dir.mkdir(parents=True)
    (novel_dir / "novel.json").write_text(
        json.dumps({
            "slug": "truyen-da-cap-nhat",
            "last_chapter_number": 10,
            "auto_check": {"enabled": True, "source_index_url": "https://example.com/novel/"},
        }),
        encoding="utf-8",
    )

    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", novels_dir)
    monkeypatch.setattr(auto_check_novel, "fetch_latest_chapters", lambda url: [
        {"number": 9, "original_title": "第9章 x", "raw_title": "x", "url": "https://x/9"},
        {"number": 10, "original_title": "第10章 y", "raw_title": "y", "url": "https://x/10"},
    ])

    assert auto_check_novel.check_and_translate_novel("truyen-da-cap-nhat") is True


FAILED_BODY = "# Chương 1522: 局勢和種樹\n[Translation failed]\nError: No backend available\n"


def _make_novel_with_failed_chapter(tmp_path):
    novels_dir = tmp_path / "novels"
    novel_dir = novels_dir / "truyen-loi"
    trans_dir = novel_dir / "translated"
    trans_dir.mkdir(parents=True)
    (novel_dir / "novel.json").write_text(json.dumps({
        "slug": "truyen-loi",
        "last_translated_url": "https://x/1524",
        "last_chapter_number": 1524,
        "total_chapters": 1524,
        "auto_check": {"enabled": True, "source_index_url": "https://x/"},
    }), encoding="utf-8")
    (novel_dir / "catalog.json").write_text(json.dumps([
        {"number": 1522, "url": "https://x/1522"},
        {"number": 1523, "url": "https://x/1523"},
    ]), encoding="utf-8")
    (novel_dir / "failed_chapters.json").write_text(json.dumps([
        {"url": "https://x/1522", "title": "第1522章 局勢和種樹", "error": "x", "ts": "t"},
    ]), encoding="utf-8")
    failed_file = trans_dir / "Chương 1522 - 局勢和種樹_VI.md"
    failed_file.write_text(FAILED_BODY, encoding="utf-8")
    (trans_dir / "Chương 1523 - Hữu Bằng_VI.md").write_text("# Chương 1523: Hữu Bằng\nNội dung tốt\n", encoding="utf-8")
    return novels_dir, novel_dir, failed_file


def test_find_failed_chapters_detects_failure_marker(tmp_path):
    _, novel_dir, failed_file = _make_novel_with_failed_chapter(tmp_path)

    assert auto_check_novel.find_failed_chapters(novel_dir / "translated") == {1522: failed_file}


def test_retry_failed_chapters_overwrites_original_file_and_restores_progress(tmp_path, monkeypatch):
    novels_dir, novel_dir, failed_file = _make_novel_with_failed_chapter(tmp_path)
    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", novels_dir)
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        # Pipeline thật ghi file theo tên tiêu đề TIẾNG VIỆT và kéo tiến độ
        # novel.json lùi về chương vừa dịch lại.
        (novel_dir / "translated" / "Chương 1522 - Thế Cục Và Trồng Cây_VI.md").write_text(
            "# Chương 1522: Thế Cục Và Trồng Cây\nBản dịch mới\n", encoding="utf-8")
        meta = json.loads((novel_dir / "novel.json").read_text(encoding="utf-8"))
        meta.update(last_translated_url="https://x/1522", last_chapter_number=1522)
        (novel_dir / "novel.json").write_text(json.dumps(meta), encoding="utf-8")

        class R:
            returncode = 0
        return R()

    monkeypatch.setattr(auto_check_novel.subprocess, "run", fake_run)

    fixed, still_failed = auto_check_novel.retry_failed_chapters("truyen-loi")

    assert fixed == [1522] and still_failed == []
    assert "--url" in calls[0] and "https://x/1522" in calls[0]
    # Giữ đúng tên file cũ → Worker upsert đè dòng D1 cũ, không tạo chương 1522 trùng.
    assert sorted(p.name for p in (novel_dir / "translated").glob("Chương 1522*")) == [failed_file.name]
    assert "Bản dịch mới" in failed_file.read_text(encoding="utf-8")
    meta = json.loads((novel_dir / "novel.json").read_text(encoding="utf-8"))
    assert meta["last_chapter_number"] == 1524 and meta["last_translated_url"] == "https://x/1524"
    assert not (novel_dir / "failed_chapters.json").exists()


def test_retry_failed_chapters_reports_still_failed(tmp_path, monkeypatch):
    novels_dir, novel_dir, failed_file = _make_novel_with_failed_chapter(tmp_path)
    monkeypatch.setattr(auto_check_novel, "NOVELS_DIR", novels_dir)

    class R:
        returncode = 0
    monkeypatch.setattr(auto_check_novel.subprocess, "run", lambda cmd, **kw: R())

    fixed, still_failed = auto_check_novel.retry_failed_chapters("truyen-loi")

    assert fixed == [] and still_failed == [1522]
    assert failed_file.read_text(encoding="utf-8") == FAILED_BODY
    assert (novel_dir / "failed_chapters.json").exists()


def test_sync_via_worker_api_never_publishes_failed_translation(tmp_path, monkeypatch):
    _, novel_dir, _ = _make_novel_with_failed_chapter(tmp_path)
    monkeypatch.setenv("HACDAO_SYNC_KEY", "k")
    sent = []

    def fake_send_chunk(conn, payload, **kw):
        sent.extend(c["number"] for c in payload["chapters"])
        return {"success": True}, None

    import tools.sync_transport as st
    monkeypatch.setattr(st, "send_chunk", fake_send_chunk)

    result = auto_check_novel.sync_via_worker_api(
        "truyen-loi", {"title": "T"}, [{"number": 1522}, {"number": 1523}], tmp_path)

    assert result is False
    assert sent == [1523]
