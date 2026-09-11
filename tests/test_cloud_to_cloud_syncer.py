"""E04/E06 — cloud_to_cloud_syncer.py: chunk theo byte, expected_r2_key,
báo cáo 409/partial-success rõ ràng, không gán ID chapters.json làm EPUB ID.

Toàn bộ test dùng fake Drive service + fake send_chunk_persistent — KHÔNG gọi
mạng/Google Drive/D1/R2 thật.
"""
import hashlib
import json

import pytest

import tools.cloud_to_cloud_syncer as syncer


# ── E04: chunk theo cả số chương lẫn số byte ───────────────────────────────

def test_chunk_chapters_respects_count_limit():
    chapters = [{'filename': f'c{i}.md', 'content': 'x'} for i in range(60)]
    chunks = syncer.chunk_chapters(chapters, max_count=25, max_bytes=10_000_000)
    assert [len(c) for c in chunks] == [25, 25, 10]


def test_chunk_chapters_splits_further_on_byte_budget_even_under_count_limit():
    # 5 chương "nặng" (mỗi chương ~400KB nội dung) — dưới giới hạn 25 chương/chunk
    # nhưng nếu gộp hết vào 1 chunk sẽ vượt xa max_bytes nhỏ ta đặt ở đây.
    big_content = 'x' * 400_000
    chapters = [{'filename': f'c{i}.md', 'content': big_content} for i in range(5)]
    chunks = syncer.chunk_chapters(chapters, max_count=25, max_bytes=1_000_000)
    assert len(chunks) > 1, "chunk phải tách nhỏ theo byte dù số chương ít hơn giới hạn đếm"
    for chunk in chunks:
        size = sum(len(json.dumps(c, ensure_ascii=False).encode('utf-8')) for c in chunk)
        # Cho phép 1 chương đơn lẻ vượt ngưỡng (không thể chia nhỏ hơn), nhưng
        # >1 chương trong cùng chunk thì tổng phải nằm trong ngân sách.
        if len(chunk) > 1:
            assert size <= 1_000_000


def test_chunk_chapters_keeps_oversized_single_chapter_alone():
    huge = {'filename': 'huge.md', 'content': 'x' * 5_000_000}
    small = {'filename': 'small.md', 'content': 'y'}
    chunks = syncer.chunk_chapters([huge, small], max_count=25, max_bytes=1_000_000)
    assert chunks[0] == [huge]
    assert chunks[1] == [small]


# ── compute_content_key: phải khớp thuật toán Worker (src/index.js) ────────

def test_compute_content_key_matches_worker_hash_algorithm():
    slug, title, content = 'demo', 'Chương 1', 'Nội dung'
    body = f"# {title}\n\n{content}"
    expected_hash = hashlib.sha256(body.encode('utf-8')).hexdigest()
    assert syncer.compute_content_key(slug, title, content) == f"demo/content/{expected_hash}.md"


def test_compute_content_key_does_not_double_prefix_heading():
    # Content đã tự có heading '#' — Worker giữ nguyên, không thêm heading nữa.
    content = "# Đã có heading\n\nphần thân"
    key = syncer.compute_content_key('demo', 'Chương 1', content)
    expected_hash = hashlib.sha256(content.encode('utf-8')).hexdigest()
    assert key == f"demo/content/{expected_hash}.md"


# ── E06: KHÔNG gán ID chapters.json làm ID EPUB khi thiếu EPUB thật ────────

class _FakeRequest:
    def __init__(self, data):
        self._data = data

    def execute(self):
        return self._data


class _FakeFiles:
    def __init__(self, store):
        self.store = store

    def get_media(self, fileId):
        return _FakeRequest(self.store[fileId])


class _FakeService:
    def __init__(self, store):
        self.store = store

    def files(self):
        return _FakeFiles(self.store)


def _novel_data(chapters, epub_id=None):
    files = {'chapters': {'id': 'CHAPS_ID'}}
    if epub_id:
        files['epub'] = {'id': epub_id}
    return {'files': files}, {'CHAPS_ID': json.dumps(chapters).encode('utf-8')}


def test_missing_epub_sends_empty_drive_file_id_not_chapters_json_id(monkeypatch):
    chapters = [{'filename': 'c1.md', 'title': 'C1', 'content': 'noi dung', 'number': 1}]
    novel_data, store = _novel_data(chapters, epub_id=None)
    monkeypatch.setattr(syncer, 'get_thread_service', lambda: _FakeService(store))

    captured = {}

    def fake_send(conn, payload, max_retries=5, budget=None):
        captured['payload'] = payload
        return {'success': True}, conn

    monkeypatch.setattr(syncer, 'send_chunk_persistent', fake_send)
    result = syncer.sync_novel_from_drive('demo', novel_data, budget=object())
    assert result['success'] is True
    # KHÔNG được là 'CHAPS_ID' (ID của chapters.json) — đó là bug E06 gốc.
    assert captured['payload']['drive_file_id'] != 'CHAPS_ID'
    assert captured['payload']['drive_file_id'] == ''


def test_real_epub_id_is_sent_when_present(monkeypatch):
    chapters = [{'filename': 'c1.md', 'title': 'C1', 'content': 'noi dung', 'number': 1}]
    novel_data, store = _novel_data(chapters, epub_id='REAL_EPUB_ID')
    monkeypatch.setattr(syncer, 'get_thread_service', lambda: _FakeService(store))

    captured = {}

    def fake_send(conn, payload, max_retries=5, budget=None):
        captured['payload'] = payload
        return {'success': True}, conn

    monkeypatch.setattr(syncer, 'send_chunk_persistent', fake_send)
    result = syncer.sync_novel_from_drive('demo', novel_data, budget=object())
    assert result['success'] is True
    assert captured['payload']['drive_file_id'] == 'REAL_EPUB_ID'


# ── E04: 409 conflict → báo cáo rõ, KHÔNG retry mù, partial success đúng ───

def test_conflict_reports_filename_and_partial_success_without_blind_retry(monkeypatch):
    chapters = [
        {'filename': 'c1.md', 'title': 'C1', 'content': 'noi dung 1', 'number': 1},
        {'filename': 'c2.md', 'title': 'C2', 'content': 'noi dung 2', 'number': 2},
    ]
    # Ép mỗi chương thành 1 chunk riêng để mô phỏng partial success rõ ràng.
    monkeypatch.setattr(syncer, 'chunk_chapters', lambda chaps, **k: [[c] for c in chaps])
    novel_data, store = _novel_data(chapters, epub_id=None)
    monkeypatch.setattr(syncer, 'get_thread_service', lambda: _FakeService(store))

    calls = []

    def fake_send(conn, payload, max_retries=5, budget=None):
        calls.append(payload)
        if len(calls) == 1:
            return {'success': True}, conn
        # Chunk thứ 2 bị Worker từ chối vì đã đổi trên Cloudflare (409).
        return {'success': False, 'status': 409, 'conflict': True, 'filename': 'c2.md',
                'error': 'Chapter changed; reconcile before replacing'}, conn

    monkeypatch.setattr(syncer, 'send_chunk_persistent', fake_send)
    result = syncer.sync_novel_from_drive('demo', novel_data, budget=object())

    assert result['success'] is False
    assert result['conflict'] is True
    assert result['conflict_filename'] == 'c2.md'
    # Partial success: chương 1 (chunk đầu) đã đồng bộ OK trước khi gặp conflict.
    assert result['chapters_synced_before_failure'] == 1
    assert 'c1.md' in result['updated_keys']
    # Không có lần gọi thứ 3 nào — tức KHÔNG tự động retry mù sau 409.
    assert len(calls) == 2


def test_generic_failure_still_reports_partial_success_count(monkeypatch):
    chapters = [
        {'filename': 'c1.md', 'title': 'C1', 'content': 'noi dung 1', 'number': 1},
        {'filename': 'c2.md', 'title': 'C2', 'content': 'noi dung 2', 'number': 2},
        {'filename': 'c3.md', 'title': 'C3', 'content': 'noi dung 3', 'number': 3},
    ]
    monkeypatch.setattr(syncer, 'chunk_chapters', lambda chaps, **k: [[c] for c in chaps])
    novel_data, store = _novel_data(chapters, epub_id=None)
    monkeypatch.setattr(syncer, 'get_thread_service', lambda: _FakeService(store))

    calls = []

    def fake_send(conn, payload, max_retries=5, budget=None):
        calls.append(payload)
        if len(calls) <= 2:
            return {'success': True}, conn
        return {'success': False, 'error': 'HTTP 500: server lỗi'}, conn

    monkeypatch.setattr(syncer, 'send_chunk_persistent', fake_send)
    result = syncer.sync_novel_from_drive('demo', novel_data, budget=object())

    assert result['success'] is False
    assert result.get('conflict') is not True
    # 2/3 chương đã sync OK trước khi chunk thứ 3 lỗi — PHẢI được báo rõ,
    # không được coi cả truyện là "0% thành công" hay ngược lại "hoàn tất".
    assert result['chapters_synced_before_failure'] == 2
    assert len(result['updated_keys']) == 2


def test_known_keys_are_sent_as_expected_r2_key(monkeypatch):
    chapters = [{'filename': 'c1.md', 'title': 'C1', 'content': 'noi dung', 'number': 1}]
    novel_data, store = _novel_data(chapters, epub_id=None)
    monkeypatch.setattr(syncer, 'get_thread_service', lambda: _FakeService(store))

    captured = {}

    def fake_send(conn, payload, max_retries=5, budget=None):
        captured['payload'] = payload
        return {'success': True}, conn

    monkeypatch.setattr(syncer, 'send_chunk_persistent', fake_send)
    known_keys = {'c1.md': 'demo/content/OLD_KEY.md'}
    syncer.sync_novel_from_drive('demo', novel_data, budget=object(), known_keys=known_keys)
    sent_chapter = captured['payload']['chapters'][0]
    assert sent_chapter['expected_r2_key'] == 'demo/content/OLD_KEY.md'
