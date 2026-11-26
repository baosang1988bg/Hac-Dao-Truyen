"""
tools/name_consistency.py
-------------------------
Kiểm tra tên riêng dịch có nhất quán với glossary không (kế hoạch
plans/KE_HOACH_NAME_KIEU_STV_2026-11-26.md, hạng mục #6).

sangtacviet giải quyết tên lệch bằng "name chung" gắn chữ Hán ngay trong nội
dung; HacDaoTruyen chỉ có bản dịch tiếng Việt nên công cụ này đối chiếu
glossary (novel.json → glossary: zh → vi) với từng cặp chương (raw, dịch) để
CẢNH BÁO cho admin những chỗ AI dịch tên khác chuẩn. Công cụ CHỈ ĐỌC: không
ghi gì vào novels/, không gọi cloud.

Hai chế độ (tự chọn theo dữ liệu có trên máy):

  1. Có raw (text_raw/ hoặc raw/ cũ có file):
     Với mỗi cặp chương (raw, translated) ghép theo SỐ CHƯƠNG — dùng
     tools.normalize_chapters.chapter_num như tools/qa_check.py — với mỗi
     thuật ngữ zh xuất hiện trong raw, kiểm tra vi chuẩn có trong bản dịch.
     Báo cáo theo thuật ngữ: số chương có zh, số chương thiếu vi, tỉ lệ thiếu,
     tối đa 10 chương thiếu, kèm "biến thể nghi ngờ" (gợi ý).

  2. Chỉ có bản dịch (raw rỗng — như máy Mac): báo rõ "không có raw", chỉ
     thống kê độ phủ (vi xuất hiện ở bao nhiêu chương) và tìm biến thể nghi
     ngờ cho các tên xuất hiện ít (độ tin cậy THẤP).

Quy tắc so khớp:
  - zh: thuật ngữ dài được ưu tiên; 1 lần xuất hiện của thuật ngữ ngắn bị bỏ
    qua nếu MỌI ký tự của nó đã nằm trong lần xuất hiện của thuật ngữ dài hơn
    (tránh báo sai 夏 khi raw có 夏辰). Giới hạn: thuật ngữ ngắn bị "che" bởi
    hợp của 2 thuật ngữ dài chồng nhau cũng bị bỏ qua; chồng lấn một phần
    (AB + BC trong "ABC") thì cả hai đều được tính.
  - vi: chuẩn hoá Unicode NFC + gộp khoảng trắng + không phân biệt hoa thường;
    khớp NGUYÊN TỪ theo âm tiết ("Hạ Thần" không khớp "Hạ Thầnx"), không vượt
    qua dấu câu. vi có dấu câu bên trong ("Quỷ thuật · Quỷ Hà") thì khớp chuỗi
    con trên văn bản đã chuẩn hoá.
  - Biến thể nghi ngờ (heuristic, chỉ là GỢI Ý): cụm cùng số âm tiết, cùng
    kiểu viết hoa từng âm tiết, trùng ≥ 1 âm tiết với vi chuẩn, không phải
    chính vi chuẩn hay một vi khác đã có trong glossary. Chữ đầu câu được viết
    hoa nên vẫn có nhiễu; thuật ngữ vi bắt đầu bằng chữ thường thì bỏ qua.

Chạy:
  python tools/name_consistency.py --novel <slug> [--json out.json]
         [--min-occurrences N] [--limit-chapters N] [--top N] [--rare-max N]

Mã thoát: 0 khi chạy xong (kể cả có cảnh báo); 2 khi không tìm thấy truyện
hoặc glossary rỗng.
"""

import os
import re
import sys
import json
import argparse
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.normalize_chapters import chapter_num  # noqa: E402

NOVELS_DIR = os.path.join(ROOT, "novels")

# Thư mục raw: novel_manager.NovelProfile.raw_dir là "text_raw"; vài truyện cũ
# (vd som-dang-luc…) còn thư mục "raw" — xét cả hai, theo thứ tự này.
RAW_DIR_NAMES = ("text_raw", "raw")
# Đồng bộ với tools/qa_check.py
_RAW_EXTS = (".txt", ".md")
_RAW_META_PREFIXES = ("Title:", "URL Source:", "Markdown Content:", "Published Time:")
_SPLIT_PART_VI_RE = re.compile(r"^(.+)-(\d+)_VI\.md$")
_SPLIT_PART_RAW_RE = re.compile(r"^(.+)-(\d+)(\.txt|\.md)$", re.I)

MAX_MISSING_LIST = 10      # số chương thiếu tối đa liệt kê cho mỗi thuật ngữ
MAX_VARIANTS = 3           # số biến thể nghi ngờ trả về cho mỗi thuật ngữ
MAX_NGRAM = 8              # số âm tiết tối đa của 1 tên vi được xét theo n-gram

# Ranh giới "đoạn": mọi ký tự không phải chữ/số/khoảng trắng (dấu câu, ·, -, …)
_SEGMENT_SPLIT_RE = re.compile(r"[^\w\s]+|_")
_TOKEN_RE = re.compile(r"[^\W\d_]+|\d+")
_PLAIN_TERM_RE = re.compile(r"^[\w\s]+$")
# Chữ Hán (CJK Unified Ideographs cơ bản + mở rộng A) — khoá glossary hợp lệ phải có
_HAN_RE = re.compile(r"[㐀-䶿一-鿿]")

EXIT_OK = 0
EXIT_NOT_FOUND = 2


# ── Chuẩn hoá & tách âm tiết ──────────────────────────────────────────────────

def normalize_text(text: str) -> str:
    """NFC + gộp khoảng trắng + casefold — dùng cho so khớp không phân biệt hoa thường."""
    text = unicodedata.normalize("NFC", text or "")
    return re.sub(r"\s+", " ", text).strip().casefold()


def _tokens_with_case(text: str) -> list[list[str]]:
    """Tách văn bản (NFC) thành các đoạn không chứa dấu câu, mỗi đoạn là list âm tiết giữ nguyên hoa/thường."""
    text = unicodedata.normalize("NFC", text or "")
    segments = []
    for seg in _SEGMENT_SPLIT_RE.split(text):
        toks = _TOKEN_RE.findall(seg)
        if toks:
            segments.append(toks)
    return segments


def _term_tokens(vi: str) -> tuple[str, ...] | None:
    """Âm tiết (casefold) của 1 vi 'đơn giản' (chỉ chữ + khoảng trắng); None nếu có dấu câu bên trong."""
    nfc = unicodedata.normalize("NFC", vi).strip()
    if not nfc or not _PLAIN_TERM_RE.match(nfc) or "_" in nfc:
        return None
    toks = tuple(t.casefold() for t in _TOKEN_RE.findall(nfc))
    if not toks or len(toks) > MAX_NGRAM:
        return None
    return toks


def _case_pattern(tokens: list[str] | tuple[str, ...]) -> tuple[bool, ...]:
    return tuple(t[:1].isupper() for t in tokens)


class TranslatedChapter:
    """Văn bản 1 chương dịch, kèm chuỗi âm tiết đã chuẩn hoá để tra nhanh."""

    def __init__(self, key, files: list[str], text: str):
        self.key = key            # số chương (int) hoặc tên file nếu không parse được số
        self.files = files
        self.norm = normalize_text(text)
        self.segments = _tokens_with_case(text)
        lows = [[t.casefold() for t in toks] for toks in self.segments]
        self.unigrams = {t for low in lows for t in low}
        # Mỗi đoạn bọc bởi khoảng trắng, các đoạn ngăn bằng "\n" → khớp nguyên
        # âm tiết bằng tìm chuỗi con " a b " mà không vượt qua dấu câu.
        self.token_str = "\n".join(" " + " ".join(low) + " " for low in lows)

    def contains(self, vi_tokens, vi_norm: str) -> bool:
        if vi_tokens is not None:
            if not self.unigrams.issuperset(vi_tokens):
                return False
            return (" " + " ".join(vi_tokens) + " ") in self.token_str
        return bool(vi_norm) and vi_norm in self.norm


# ── Đọc dữ liệu truyện (chỉ đọc) ──────────────────────────────────────────────

# Số file không đọc được (sai encoding/lỗi IO) — ghi vào report["notes"] để
# báo cáo "không phát hiện tên lệch" không bị hiểu nhầm là sạch.
UNREADABLE_FILES: list[str] = []


def _read_text(path: str) -> str:
    # Raw tiếng Trung đôi khi là GBK/GB18030 → thử lần lượt, cuối cùng mới bỏ.
    for enc in ("utf-8-sig", "gb18030"):
        try:
            with open(path, encoding=enc) as fh:
                return fh.read()
        except UnicodeDecodeError:
            continue
        except OSError:
            break
    UNREADABLE_FILES.append(path)
    return ""


def _strip_raw_meta(text: str) -> str:
    return "\n".join(ln for ln in text.splitlines() if not ln.startswith(_RAW_META_PREFIXES))


def load_glossary(novel_dir: str) -> dict:
    """Đọc glossary từ novel.json; bỏ mục không phải chuỗi hoặc rỗng."""
    path = os.path.join(novel_dir, "novel.json")
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, dict):
        return {}
    gl = data.get("glossary") or {}
    if not isinstance(gl, dict):
        return {}
    out = {}
    for zh, vi in gl.items():
        if isinstance(zh, str) and isinstance(vi, str) and zh.strip() and vi.strip():
            out[unicodedata.normalize("NFC", zh.strip())] = vi.strip()
    return out


def index_translated(novel_dir: str) -> dict:
    """Map khoá chương → list file *_VI.md (bỏ phần split khi bản merge đã có, như qa_check)."""
    trans_dir = os.path.join(novel_dir, "translated")
    index = defaultdict(list)
    if not os.path.isdir(trans_dir):
        return {}
    all_md = {f for f in os.listdir(trans_dir) if f.endswith("_VI.md")}
    for f in sorted(all_md):
        m = _SPLIT_PART_VI_RE.match(f)
        if m and f"{m.group(1)}_VI.md" in all_md:
            continue
        n = chapter_num(f)
        index[n if n is not None else f].append(os.path.join(trans_dir, f))
    return dict(index)


def index_raw(novel_dir: str) -> tuple[dict, str | None]:
    """Map số chương → list file raw; trả kèm tên thư mục raw dùng được (None nếu không có)."""
    for name in RAW_DIR_NAMES:
        raw_dir = os.path.join(novel_dir, name)
        if not os.path.isdir(raw_dir):
            continue
        files = {f for f in os.listdir(raw_dir) if f.lower().endswith(_RAW_EXTS)}
        index = defaultdict(list)
        for f in sorted(files):
            m = _SPLIT_PART_RAW_RE.match(f)
            # Phần split "stem-N.txt" khi file gốc "stem.txt" còn → bỏ để không đếm trùng
            if m and f"{m.group(1)}{m.group(3)}" in files:
                continue
            n = chapter_num(f)
            if n is not None:
                index[n].append(os.path.join(raw_dir, f))
        if index:
            return dict(index), name
    return {}, None


# ── So khớp zh trong raw ──────────────────────────────────────────────────────

def count_zh_terms(raw_text: str, terms_longest_first: list[str]) -> Counter:
    """
    Đếm số lần xuất hiện "hiệu lực" của từng thuật ngữ zh trong raw.
    Thuật ngữ dài xét trước và đánh dấu vị trí; 1 lần xuất hiện của thuật ngữ
    ngắn hơn bị bỏ nếu toàn bộ ký tự đã bị thuật ngữ dài hơn che.
    """
    covered = bytearray(len(raw_text))
    counts = Counter()
    for zh in terms_longest_first:
        L = len(zh)
        start = raw_text.find(zh)
        while start != -1:
            end = start + L
            if 0 in covered[start:end]:
                counts[zh] += 1
            covered[start:end] = b"\x01" * L
            start = raw_text.find(zh, start + 1)
    return counts


# ── Biến thể nghi ngờ ─────────────────────────────────────────────────────────

class VariantStats:
    """
    Thống kê các cụm ứng viên biến thể: cụm có số âm tiết thuộc `lengths`, chữ
    đầu viết hoa và chứa ≥1 âm tiết thuộc `wanted_tokens`. Có chỉ mục
    (số âm tiết, âm tiết) → cụm để tra nhanh theo từng tên chuẩn.
    """

    def __init__(self):
        self.occ = Counter()     # (gram, pattern) → số lần xuất hiện
        self.chaps = Counter()   # (gram, pattern) → số chương có cụm
        self.disp = {}           # (gram, pattern) → dạng hiển thị đầu tiên gặp
        self.by_tok = defaultdict(set)

    def add_chapter(self, segments, lengths: set, wanted_tokens: set) -> "VariantStats":
        local = Counter()
        for toks in segments:
            low = [t.casefold() for t in toks]
            for n in lengths:
                for i in range(len(toks) - n + 1):
                    if not toks[i][:1].isupper():
                        continue
                    gram = tuple(low[i:i + n])
                    if wanted_tokens.isdisjoint(gram):
                        continue
                    key = (gram, _case_pattern(toks[i:i + n]))
                    if key not in local:
                        self.disp.setdefault(key, " ".join(toks[i:i + n]))
                    local[key] += 1
        for key, c in local.items():
            self.occ[key] += c
            self.chaps[key] += 1
            for t in set(key[0]):
                self.by_tok[(len(key[0]), t)].add(key)
        return self


def suggest_variants(vi: str, stats_list: list, known_vi: set) -> list[dict]:
    """
    Top biến thể nghi ngờ của `vi` (gợi ý). Ứng viên: cùng số âm tiết, cùng
    kiểu viết hoa, trùng ≥1 âm tiết, khác vi chuẩn và mọi vi khác trong
    glossary. Xếp theo: số âm tiết trùng đúng vị trí, số âm tiết trùng, số
    chương, số lần.
    """
    canon = _term_tokens(vi)
    if canon is None:
        return []
    nfc = unicodedata.normalize("NFC", vi).strip()
    pattern = _case_pattern(_TOKEN_RE.findall(nfc))
    if not pattern or not pattern[0]:
        return []  # vi bắt đầu bằng chữ thường (danh từ chung) → quá nhiễu
    n = len(canon)
    canon_set = set(canon)
    occ, chaps, display = Counter(), Counter(), {}
    for st in stats_list:
        keys = set()
        for t in canon_set:
            keys |= st.by_tok.get((n, t), set())
        for key in keys:
            gram, pat = key
            if pat != pattern or gram == canon or gram in known_vi:
                continue
            occ[gram] += st.occ[key]
            chaps[gram] += st.chaps[key]
            display.setdefault(gram, st.disp[key])

    def rank(g):
        pos = sum(1 for a, b in zip(g, canon) if a == b)
        return (-pos, -len(canon_set & set(g)), -chaps[g], -occ[g], display[g])

    return [
        {"text": display[g], "count": occ[g], "chapters": chaps[g]}
        for g in sorted(occ, key=rank)[:MAX_VARIANTS]
    ]


# ── Phân tích ─────────────────────────────────────────────────────────────────

def _chapter_sort_key(k):
    return (0, k, "") if isinstance(k, int) else (1, 0, str(k))


def analyze(slug: str, novels_dir: str = NOVELS_DIR, min_occurrences: int = 1,
            limit_chapters: int | None = None, rare_max: int = 2) -> dict:
    """
    Phân tích 1 truyện, trả report dict (schema: xem test_json_dung_schema trong test_name_consistency.py).
    Raise FileNotFoundError nếu thiếu truyện/novel.json, ValueError nếu glossary rỗng.
    """
    novel_dir = os.path.join(novels_dir, slug)
    if not os.path.isfile(os.path.join(novel_dir, "novel.json")):
        raise FileNotFoundError(f"Không tìm thấy truyện '{slug}' (thiếu {novel_dir}/novel.json)")
    full_glossary = load_glossary(novel_dir)
    if not full_glossary:
        raise ValueError(f"Truyện '{slug}' không có glossary trong novel.json")
    # Glossary vài truyện có mục khoá là tiếng Việt (vd "A Nhĩ Ca Nông": "A Nhĩ Ca Nông")
    # — không bao giờ xuất hiện trong raw, nên bỏ khỏi phần kiểm tra; vẫn giữ vi
    # của chúng trong known_vi để không gợi ý nhầm thành "biến thể".
    glossary = {zh: vi for zh, vi in full_glossary.items() if _HAN_RE.search(zh)}
    UNREADABLE_FILES.clear()
    notes = []
    skipped = len(full_glossary) - len(glossary)
    if skipped:
        notes.append(f"Bỏ qua {skipped} mục glossary có khoá không chứa chữ Hán.")
    if not glossary:
        raise ValueError(f"Glossary của '{slug}' không có mục nào khoá là chữ Hán")

    vi_tokens = {zh: _term_tokens(vi) for zh, vi in glossary.items()}
    vi_norm = {zh: normalize_text(vi) for zh, vi in glossary.items()}
    known_vi = {t for t in (_term_tokens(v) for v in full_glossary.values()) if t is not None}

    trans_index = index_translated(novel_dir)
    raw_index, raw_dir_name = index_raw(novel_dir)
    has_raw = bool(raw_index)

    if has_raw:
        keys = sorted((k for k in trans_index if isinstance(k, int) and k in raw_index))
        mode = "raw"
        unpaired_t = len([k for k in trans_index if k not in raw_index])
        unpaired_r = len([k for k in raw_index if k not in trans_index])
        if unpaired_t or unpaired_r:
            notes.append(f"Bỏ qua {unpaired_t} chương dịch không có raw và "
                         f"{unpaired_r} chương raw chưa có bản dịch.")
    else:
        keys = sorted(trans_index, key=_chapter_sort_key)
        mode = "translated_only"
        notes.append("Không có raw (text_raw/ hoặc raw/ rỗng) — chỉ thống kê độ phủ "
                     "tên trong bản dịch; biến thể nghi ngờ có độ tin cậy THẤP.")
    if limit_chapters and limit_chapters > 0:
        keys = keys[:limit_chapters]

    chapters = {}
    for k in keys:
        files = trans_index[k]
        text = "\n".join(_read_text(p) for p in files)
        chapters[k] = TranslatedChapter(k, [os.path.basename(p) for p in files], text)

    report = {
        "tool": "name_consistency",
        "schema_version": 1,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "slug": slug,
        "mode": mode,
        "has_raw": has_raw,
        "raw_dir": raw_dir_name,
        "params": {"min_occurrences": min_occurrences, "limit_chapters": limit_chapters,
                   "rare_max": rare_max},
        "stats": {
            "glossary_terms": len(glossary),
            "translated_chapters": len(trans_index),
            "raw_chapters": len(raw_index),
            "chapters_checked": len(chapters),
        },
        "notes": notes,
        "terms": [],
        "coverage": [],
    }

    if has_raw:
        report["terms"] = _analyze_with_raw(glossary, vi_tokens, vi_norm, known_vi,
                                            chapters, raw_index, min_occurrences)
        report["stats"]["terms_with_missing"] = sum(1 for t in report["terms"] if t["chapters_missing_vi"])
    else:
        report["coverage"] = _analyze_coverage(glossary, vi_tokens, vi_norm, known_vi,
                                               chapters, rare_max)
        report["stats"]["rare_terms"] = sum(1 for t in report["coverage"] if t["rare"])
    if UNREADABLE_FILES:
        report["notes"].append(f"{len(UNREADABLE_FILES)} file không đọc được (sai encoding/lỗi IO) bị bỏ qua — "
                               "kết quả có thể thiếu: " + ", ".join(os.path.basename(p) for p in UNREADABLE_FILES[:5]))
    return report


def _analyze_with_raw(glossary, vi_tokens, vi_norm, known_vi, chapters, raw_index, min_occ):
    terms_sorted = sorted(glossary, key=lambda z: (-len(z), z))
    with_zh = defaultdict(list)
    missing = defaultdict(list)
    for k, ch in chapters.items():
        raw = _strip_raw_meta("\n".join(_read_text(p) for p in raw_index[k]))
        raw = unicodedata.normalize("NFC", raw)
        counts = count_zh_terms(raw, terms_sorted)
        for zh, c in counts.items():
            if c < min_occ:
                continue
            with_zh[zh].append(k)
            if not ch.contains(vi_tokens[zh], vi_norm[zh]):
                missing[zh].append(k)

    # Biến thể: đếm n-gram 1 lần cho mỗi chương thiếu, lọc theo âm tiết cần tìm
    lengths, wanted = set(), set()
    for zh in missing:
        t = vi_tokens[zh]
        if t is not None:
            lengths.add(len(t))
            wanted.update(t)
    per_chapter = {}
    for k in {k for ks in missing.values() for k in ks}:
        per_chapter[k] = VariantStats().add_chapter(chapters[k].segments, lengths, wanted)

    rows = []
    for zh, ks in with_zh.items():
        miss = missing.get(zh, [])
        rows.append({
            "zh": zh,
            "vi": glossary[zh],
            "chapters_with_zh": len(ks),
            "chapters_missing_vi": len(miss),
            "missing_ratio": round(len(miss) / len(ks), 3) if ks else 0.0,
            "missing_chapters": sorted(miss)[:MAX_MISSING_LIST],
            "suspected_variants": suggest_variants(glossary[zh], [per_chapter[k] for k in miss], known_vi)
            if miss else [],
        })
    rows.sort(key=lambda r: (-r["chapters_missing_vi"], -r["missing_ratio"], r["zh"]))
    return rows


def _analyze_coverage(glossary, vi_tokens, vi_norm, known_vi, chapters, rare_max):
    total = len(chapters)
    present = {zh: sum(1 for ch in chapters.values() if ch.contains(vi_tokens[zh], vi_norm[zh]))
               for zh in glossary}
    rare = [zh for zh in glossary if present[zh] <= rare_max]
    lengths, wanted = set(), set()
    for zh in rare:
        t = vi_tokens[zh]
        if t is not None:
            lengths.add(len(t))
            wanted.update(t)
    stats = VariantStats()
    if rare:
        for ch in chapters.values():
            stats.add_chapter(ch.segments, lengths, wanted)
    rows = []
    for zh in glossary:
        is_rare = present[zh] <= rare_max
        rows.append({
            "zh": zh,
            "vi": glossary[zh],
            "chapters_with_vi": present[zh],
            "coverage_ratio": round(present[zh] / total, 3) if total else 0.0,
            "rare": is_rare,
            "low_confidence": True,
            "suspected_variants": suggest_variants(glossary[zh], [stats], known_vi) if is_rare else [],
        })
    rows.sort(key=lambda r: (r["chapters_with_vi"], r["zh"]))
    return rows


# ── Xuất kết quả ──────────────────────────────────────────────────────────────

def _fmt_variants(vs: list[dict]) -> str:
    return ", ".join(f"{v['text']} ×{v['count']} ({v['chapters']} ch.)" for v in vs) or "-"


def print_report(report: dict, top: int = 30) -> None:
    s = report["stats"]
    print(f"\nKiểm tra tên nhất quán — {report['slug']}")
    print(f"  Glossary: {s['glossary_terms']} thuật ngữ | chương dịch: {s['translated_chapters']} "
          f"| chương raw: {s['raw_chapters']} | đã xét: {s['chapters_checked']}")
    for n in report["notes"]:
        print(f"  [!] {n}")

    if report["mode"] == "raw":
        bad = [t for t in report["terms"] if t["chapters_missing_vi"]]
        print(f"\n  Thuật ngữ có zh trong raw: {len(report['terms'])} | thiếu vi chuẩn ở ≥1 chương: {len(bad)}")
        if not bad:
            print("  Không phát hiện tên lệch glossary.")
            return
        print(f"\n  {'zh':<10} {'vi chuẩn':<22} {'có zh':>6} {'thiếu':>6} {'tỉ lệ':>6}  chương thiếu (≤10) | biến thể nghi ngờ (gợi ý)")
        for t in bad[:top]:
            chs = ",".join(str(c) for c in t["missing_chapters"])
            print(f"  {t['zh']:<10} {t['vi']:<22} {t['chapters_with_zh']:>6} {t['chapters_missing_vi']:>6} "
                  f"{t['missing_ratio'] * 100:>5.0f}%  {chs} | {_fmt_variants(t['suspected_variants'])}")
        if len(bad) > top:
            print(f"  … còn {len(bad) - top} thuật ngữ (xem --json).")
    else:
        rare = [t for t in report["coverage"] if t["rare"]]
        print(f"\n  Tên xuất hiện ≤ {report['params']['rare_max']} chương: {len(rare)} "
              f"(độ tin cậy THẤP — không có raw để biết chương nào lẽ ra phải có tên)")
        print(f"\n  {'zh':<10} {'vi chuẩn':<22} {'số ch.':>6}  biến thể nghi ngờ (gợi ý)")
        for t in rare[:top]:
            print(f"  {t['zh']:<10} {t['vi']:<22} {t['chapters_with_vi']:>6}  {_fmt_variants(t['suspected_variants'])}")
        if len(rare) > top:
            print(f"  … còn {len(rare) - top} tên ít gặp (xem --json).")
        # Nhiều zh có thể cùng 1 vi (陽/阳 → Dương) — chỉ in mỗi vi 1 lần
        common, seen_vi = [], set()
        for t in sorted(report["coverage"], key=lambda r: -r["chapters_with_vi"]):
            if t["vi"] not in seen_vi and len(common) < 5:
                seen_vi.add(t["vi"])
                common.append(t)
        if common:
            print("\n  Phủ rộng nhất: " + "; ".join(f"{t['vi']} ({t['chapters_with_vi']})" for t in common))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Kiểm tra tên riêng trong bản dịch có nhất quán với glossary (chỉ đọc).")
    ap.add_argument("--novel", required=True, help="slug truyện trong novels/")
    ap.add_argument("--json", dest="json_out", help="ghi báo cáo JSON ra file này (ngoài novels/)")
    ap.add_argument("--min-occurrences", type=int, default=1,
                    help="chế độ raw: zh phải xuất hiện ≥ N lần trong raw của chương mới xét (mặc định 1)")
    ap.add_argument("--limit-chapters", type=int, default=None, help="chỉ xét N chương đầu (theo số chương)")
    ap.add_argument("--top", type=int, default=30, help="số dòng in ra console (mặc định 30)")
    ap.add_argument("--rare-max", type=int, default=2,
                    help="chế độ không raw: tên xuất hiện ≤ N chương coi là ít gặp (mặc định 2)")
    ap.add_argument("--novels-dir", default=NOVELS_DIR, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    try:
        report = analyze(args.novel, novels_dir=args.novels_dir,
                         min_occurrences=max(1, args.min_occurrences),
                         limit_chapters=args.limit_chapters, rare_max=max(0, args.rare_max))
    except (FileNotFoundError, ValueError) as e:
        print(f"[LỖI] {e}", file=sys.stderr)
        return EXIT_NOT_FOUND
    except json.JSONDecodeError as e:
        print(f"[LỖI] novel.json hỏng: {e}", file=sys.stderr)
        return EXIT_NOT_FOUND

    print_report(report, top=max(1, args.top))
    if args.json_out:
        out = os.path.realpath(args.json_out)
        novels_real = os.path.realpath(args.novels_dir)
        try:
            inside = os.path.commonpath([out, novels_real]) == novels_real
        except ValueError:  # Windows: khác ổ đĩa → chắc chắn ngoài novels/
            inside = False
        if inside:
            print("[LỖI] Không ghi báo cáo vào trong novels/ (công cụ chỉ đọc).", file=sys.stderr)
            return EXIT_NOT_FOUND
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=1)
        print(f"\n  Đã ghi JSON: {out}")
    return EXIT_OK


if __name__ == "__main__":
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
            sys.stderr.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
    sys.exit(main())
