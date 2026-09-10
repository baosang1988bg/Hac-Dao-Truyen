"""Test cho tools/epub_to_chapters.py — tập trung vào lớp validate an toàn của
_validate_epub_archive() trước khi cho ebooklib mở EPUB (là file ZIP):
  - EPUB hợp lệ nhỏ vẫn xử lý được bình thường.
  - Zip bomb (entry khai báo dung lượng giải nén cực lớn) bị từ chối.
  - Entry chứa path traversal (zip slip, vd "../../etc/passwd") bị từ chối.
  - Archive có quá nhiều entry bị từ chối.

Không cần EPUB thật, không cần mạng — mọi fixture EPUB được tạo bằng zipfile/ebooklib
ngay trong test.
"""
import zipfile

import pytest

from tools import epub_to_chapters as m


def _build_valid_epub(path):
    """Tạo 1 EPUB hợp lệ tối thiểu bằng ebooklib để test happy-path thật sự đi
    qua epub.read_epub()."""
    from ebooklib import epub

    book = epub.EpubBook()
    book.set_identifier("test-id-123")
    book.set_title("Truyện Test")
    book.set_language("vi")

    chap1 = epub.EpubHtml(title="Chương 1", file_name="chap_01.xhtml", lang="vi")
    chap1.content = "<h1>Chương 1</h1><p>Nội dung chương một dùng để kiểm thử.</p>"
    book.add_item(chap1)

    book.toc = (epub.Link("chap_01.xhtml", "Chương 1", "chap1"),)
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", chap1]

    epub.write_epub(str(path), book)
    return path


def test_valid_small_epub_is_parsed(tmp_path):
    epub_path = _build_valid_epub(tmp_path / "valid.epub")

    result = m.parse_epub(str(epub_path))

    assert len(result["chapters"]) == 1
    assert result["chapters"][0]["number"] == 1
    assert "Nội dung chương một" in result["chapters"][0]["content"]


def test_zip_bomb_rejected(tmp_path, monkeypatch):
    # Hạ ngưỡng tổng dung lượng giải nén xuống rất nhỏ để không phải tạo file
    # nhiều GB thật trong test — vẫn kiểm chứng đúng logic đếm tổng file_size
    # khai báo trong archive và từ chối khi vượt ngưỡng (đây chính là cơ chế
    # chặn zip bomb: entry khai báo giải nén khổng lồ từ file nén nhỏ).
    monkeypatch.setattr(m, "MAX_EPUB_UNCOMPRESSED_BYTES", 1000)

    bomb_path = tmp_path / "bomb.epub"
    # Dữ liệu lặp lại nén rất tốt: nén nhỏ nhưng "giải nén" (file_size khai báo)
    # vượt xa ngưỡng 1000 bytes đã hạ ở trên.
    payload = b"0" * 5000
    with zipfile.ZipFile(bomb_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("bomb.txt", payload)

    with pytest.raises(m.EpubValidationError, match="zip bomb"):
        m.parse_epub(str(bomb_path))


def test_path_traversal_entry_rejected(tmp_path):
    evil_path = tmp_path / "evil.epub"
    with zipfile.ZipFile(evil_path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("../../etc/passwd", "pwned")

    with pytest.raises(m.EpubValidationError, match="path traversal"):
        m.parse_epub(str(evil_path))


def test_too_many_entries_rejected(tmp_path, monkeypatch):
    # Hạ ngưỡng số entry để không phải tạo 100k+ entry thật trong test.
    monkeypatch.setattr(m, "MAX_EPUB_ENTRIES", 10)

    many_path = tmp_path / "many.epub"
    with zipfile.ZipFile(many_path, "w") as zf:
        for i in range(20):
            zf.writestr(f"file_{i}.txt", "x")

    with pytest.raises(m.EpubValidationError, match="quá nhiều entry"):
        m.parse_epub(str(many_path))


def test_entry_path_validator_accepts_normal_paths():
    # Không raise cho các path bình thường trong EPUB.
    m._validate_entry_path("mimetype")
    m._validate_entry_path("OEBPS/chap_01.xhtml")
    m._validate_entry_path("META-INF/container.xml")


def test_entry_path_validator_rejects_absolute_path():
    with pytest.raises(m.EpubValidationError):
        m._validate_entry_path("/etc/passwd")


def test_oversized_compressed_file_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(m, "MAX_EPUB_COMPRESSED_BYTES", 10)

    small_path = tmp_path / "small.epub"
    with zipfile.ZipFile(small_path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")

    with pytest.raises(m.EpubValidationError, match="quá lớn"):
        m.parse_epub(str(small_path))
