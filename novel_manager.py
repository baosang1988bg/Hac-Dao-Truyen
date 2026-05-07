"""
novel_manager.py
----------------
Quản lý profile của nhiều truyện. Mỗi truyện có 1 thư mục riêng trong novels/
chứa file novel.json và các thư mục text_raw/, translated/.

Cấu trúc:
    novels/
        <slug>/
            novel.json
            text_raw/
            translated/
"""

import os
import json
import re
from dataclasses import dataclass, field, asdict
from typing import Optional


NOVELS_BASE_DIR = "novels"


# ── Dataclass: profile của 1 truyện ──────────────────────────────────────────

@dataclass
class NovelProfile:
    # Thông tin cơ bản
    slug: str                         # tên thư mục, vd: "than-dao-de-ton"
    title: str                        # tên hiển thị, vd: "Thần Đạo Đế Tôn"
    original_title: str = ""          # tên gốc tiếng Trung
    author: str = ""
    source_url: str = ""              # URL chương đầu tiên (điểm bắt đầu)
    genre: str = "cultivation"        # cultivation | modern | romance | ...

    # Trạng thái dịch
    last_translated_url: str = ""     # URL chương dịch cuối cùng
    last_chapter_number: int = 0      # số chương đã dịch
    total_chapters: int = 0           # tổng số chương (0 = chưa biết)

    # Glossary riêng của truyện (ghi đè global)
    glossary: dict = field(default_factory=dict)

    # Style prompt riêng (để trống = dùng global)
    translation_style: str = ""

    # Ghi chú
    notes: str = ""

    # ── Computed paths ──

    @property
    def base_dir(self) -> str:
        return os.path.join(NOVELS_BASE_DIR, self.slug)

    @property
    def raw_dir(self) -> str:
        return os.path.join(self.base_dir, "text_raw")

    @property
    def translated_dir(self) -> str:
        return os.path.join(self.base_dir, "translated")

    @property
    def profile_path(self) -> str:
        return os.path.join(self.base_dir, "novel.json")

    def ensure_dirs(self):
        """Tạo các thư mục cần thiết nếu chưa có."""
        os.makedirs(self.raw_dir, exist_ok=True)
        os.makedirs(self.translated_dir, exist_ok=True)

    # ── Serialization ──

    def save(self):
        """Lưu profile xuống novel.json."""
        self.ensure_dirs()
        data = asdict(self)
        # Xoá bỏ computed properties (không thể serialize)
        with open(self.profile_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def update_progress(self, chapter_url: str, chapter_number: int):
        """Cập nhật tiến độ dịch và lưu lại."""
        self.last_translated_url = chapter_url
        self.last_chapter_number = chapter_number
        self.save()

    def add_glossary_entry(self, original: str, translated: str):
        """Thêm 1 entry vào glossary và lưu lại."""
        self.glossary[original] = translated
        self.save()


# ── CRUD functions ──────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Chuyển tên truyện thành slug dùng làm tên thư mục."""
    text = text.lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")


def create_novel(
    title: str,
    source_url: str,
    original_title: str = "",
    author: str = "",
    genre: str = "cultivation",
    glossary: Optional[dict] = None,
    translation_style: str = "",
    notes: str = "",
    slug: str = "",
) -> NovelProfile:
    """
    Tạo profile mới cho 1 truyện và lưu xuống disk.
    Raise ValueError nếu slug đã tồn tại.
    """
    if not slug:
        slug = slugify(title)

    profile_path = os.path.join(NOVELS_BASE_DIR, slug, "novel.json")
    if os.path.exists(profile_path):
        raise ValueError(
            f"Novel '{slug}' already exists. "
            f"Use load_novel('{slug}') to load it, or choose a different name."
        )

    profile = NovelProfile(
        slug=slug,
        title=title,
        original_title=original_title,
        author=author,
        source_url=source_url,
        genre=genre,
        glossary=glossary or {},
        translation_style=translation_style,
        notes=notes,
    )
    profile.save()
    return profile


def load_novel(slug: str) -> NovelProfile:
    """Load profile của 1 truyện từ novel.json. Raise FileNotFoundError nếu không tồn tại."""
    profile_path = os.path.join(NOVELS_BASE_DIR, slug, "novel.json")
    if not os.path.exists(profile_path):
        raise FileNotFoundError(
            f"Novel '{slug}' not found. "
            f"Available novels: {list_novel_slugs()}\n"
            f"Create a new one with: python main.py new"
        )
    with open(profile_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return NovelProfile(**data)


def list_novel_slugs() -> list[str]:
    """Trả về danh sách slug của tất cả truyện đang có."""
    if not os.path.isdir(NOVELS_BASE_DIR):
        return []
    slugs = []
    for entry in sorted(os.scandir(NOVELS_BASE_DIR), key=lambda e: e.name):
        if entry.is_dir() and os.path.exists(os.path.join(entry.path, "novel.json")):
            slugs.append(entry.name)
    return slugs


def list_novels() -> list[NovelProfile]:
    """Trả về danh sách đầy đủ profile của tất cả truyện."""
    return [load_novel(slug) for slug in list_novel_slugs()]


def print_novel_list():
    """In bảng danh sách truyện ra console."""
    novels = list_novels()
    if not novels:
        print("  (Chưa có truyện nào. Dùng: python main.py new)")
        return

    print(f"\n{'─'*70}")
    print(f"  {'SLUG':<25} {'TITLE':<25} {'CHAPTERS':>8}  {'STATUS'}")
    print(f"{'─'*70}")
    for n in novels:
        status = f"chapter {n.last_chapter_number}" if n.last_chapter_number else "chưa bắt đầu"
        total = f"/{n.total_chapters}" if n.total_chapters else ""
        print(f"  {n.slug:<25} {n.title:<25} {str(n.last_chapter_number) + total:>8}  {status}")
    print(f"{'─'*70}\n")
