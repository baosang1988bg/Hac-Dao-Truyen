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
import copy
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass, field, fields, asdict
from typing import Optional


NOVELS_BASE_DIR = "novels"

_MISSING = object()


# ── Lock + ghi atomic cho novel.json ─────────────────────────────────────────
#
# D03: lock phải bao trọn chu trình đọc-sửa-ghi (không chỉ phần ghi), và ghi
# phải atomic (temp file cùng thư mục đích rồi os.replace()) để tránh hỏng
# file khi crash giữa chừng. Cơ chế lock dựa trên os.mkdir() — atomic ở cấp hệ
# điều hành trên cả POSIX/Windows, không cần thêm dependency — mô phỏng theo
# cơ chế mkdir-lock đã có sẵn trong tools/sync_budget.py (SyncBudget._locked),
# triển khai lại tại đây để novel_manager.py không phụ thuộc tools/.

@contextmanager
def _profile_lock(profile_path: str, timeout: float = 10.0):
    lock_dir = str(profile_path) + ".lock"
    os.makedirs(os.path.dirname(profile_path) or ".", exist_ok=True)
    deadline = time.monotonic() + timeout
    while True:
        try:
            os.mkdir(lock_dir)
            break
        except FileExistsError:
            if time.monotonic() > deadline:
                raise RuntimeError(f"Timeout chờ khoá ghi profile: {profile_path}")
            time.sleep(0.01)
    try:
        yield
    finally:
        try:
            os.rmdir(lock_dir)
        except OSError:
            pass


def _atomic_write_json(path: str, data: dict):
    """Ghi JSON atomic: file tạm cùng thư mục đích rồi os.replace().
    Nếu có exception giữa chừng, file gốc không bị đụng tới."""
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".novel-", suffix=".json.tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _merge_glossary_field(disk: dict, mine: dict, baseline: dict) -> dict:
    """Merge 3-way theo từng key glossary: giữ key người khác vừa thêm/sửa
    trên đĩa, áp key mình đã thêm/sửa/xoá so với baseline lúc load."""
    merged = dict(disk)
    for k, v in mine.items():
        if baseline.get(k, _MISSING) != v:
            merged[k] = v
    for k in baseline:
        if k not in mine:
            merged.pop(k, None)
    return merged


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

    # F03: gỡ xuất bản (takedown) TÁCH BIỆT khỏi total_chapters/status
    # ongoing-completed — 1 truyện completed vẫn có thể bị gỡ vì lý do bản
    # quyền. published=False ẩn khỏi mọi đường đọc công khai nhưng KHÔNG xóa
    # dữ liệu trên đĩa — admin có thể restore. license_note là bằng chứng
    # provenance/license TÙY CHỌN do admin tự ghi, không suy luận tự động.
    published: bool = True
    takedown_reason: str = ""
    takedown_at: str = ""
    license_note: str = ""

    def __post_init__(self):
        # _snapshot: giá trị field lúc load/khởi tạo — dùng để merge 3-way khi
        # save() (field nào tôi thực sự thay đổi so với baseline thì tôi
        # thắng, field nào tôi không đụng tới thì lấy bản mới nhất trên đĩa).
        # _extra: field JSON lạ (chưa có trong schema hiện tại) cần bảo toàn.
        self._snapshot = {f.name: copy.deepcopy(getattr(self, f.name)) for f in fields(self)}
        self._extra = {}

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
        """Lưu profile xuống novel.json.

        Khoá trọn chu trình đọc-sửa-ghi (đọc lại bản mới nhất trên đĩa, merge
        theo field, rồi ghi atomic) để 2 tiến trình/luồng ghi đồng thời không
        làm mất update của nhau (D03)."""
        self.ensure_dirs()
        with _profile_lock(self.profile_path):
            self._save_locked()

    def _save_locked(self):
        """Thân của save(); giả định lock ghi profile đã được giữ."""
        field_names = [f.name for f in fields(self)]
        file_exists = os.path.exists(self.profile_path)
        current_raw = {}
        if file_exists:
            try:
                with open(self.profile_path, "r", encoding="utf-8") as f:
                    current_raw = json.load(f)
                if not isinstance(current_raw, dict):
                    current_raw = {}
            except Exception:
                current_raw = {}

        if not file_exists:
            # Chưa có file trên đĩa (tạo mới) — không có gì để merge, ghi
            # nguyên trạng thái hiện tại.
            merged = {name: getattr(self, name) for name in field_names}
            merged.update(getattr(self, "_extra", {}) or {})
        else:
            merged = dict(current_raw)  # bắt đầu từ bản mới nhất + field lạ
            snapshot = getattr(self, "_snapshot", {}) or {}
            for name in field_names:
                mine = getattr(self, name)
                if name == "glossary":
                    merged["glossary"] = _merge_glossary_field(
                        disk=current_raw.get("glossary", {}) or {},
                        mine=mine or {},
                        baseline=snapshot.get("glossary", {}) or {},
                    )
                    continue
                baseline = snapshot.get(name, _MISSING)
                if baseline is _MISSING or mine != baseline:
                    # Field này tôi đã thay đổi so với lúc load -> tôi thắng.
                    merged[name] = mine
                # else: giữ nguyên giá trị mới nhất trên đĩa (có thể do tiến
                # trình khác vừa ghi field này).

        _atomic_write_json(self.profile_path, merged)

        # Đồng bộ lại self + snapshot theo đúng những gì vừa ghi xuống đĩa, để
        # lần save() kế tiếp diff đúng so với baseline mới.
        for name in field_names:
            if name in merged:
                setattr(self, name, merged[name])
        self._extra = {k: v for k, v in merged.items() if k not in field_names}
        self._snapshot = {name: copy.deepcopy(getattr(self, name)) for name in field_names}

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

    # Khoá cả bước kiểm tra tồn tại lẫn bước ghi đầu tiên trong 1 lock, tránh
    # 2 lời gọi create_novel() đồng thời cùng slug cùng vượt qua check rồi
    # cùng ghi đè lẫn nhau (TOCTOU).
    with _profile_lock(profile_path):
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
        profile.ensure_dirs()
        profile._save_locked()
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
    valid_fields = {f.name for f in fields(NovelProfile)}
    filtered_data = {k: v for k, v in data.items() if k in valid_fields}
    profile = NovelProfile(**filtered_data)
    # Bảo toàn field JSON lạ chưa có trong schema hiện tại (D03) — sẽ được
    # ghi lại nguyên vẹn ở lần save() kế tiếp.
    profile._extra = {k: v for k, v in data.items() if k not in valid_fields}
    return profile


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
