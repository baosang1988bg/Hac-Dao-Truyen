#!/usr/bin/env python3
"""Sinh bảng âm Hán Việt từng chữ cho HacDaoTruyen.

Nguồn (thứ tự ưu tiên khi xếp âm của một chữ):
  1. ``tools/converter/hanviet_overrides.json`` — sửa tay, THAY toàn bộ danh sách âm.
  2. Âm suy ra từ glossary các truyện (``novels/*/novel.json``): chỉ lấy cặp
     zh→vi mà khoá toàn chữ Hán và số chữ = số âm tiết tiếng Việt. Âm nhiều
     lần xuất hiện đứng trước. Chỉ âm xuất hiện ≥ 2 lần (``--min-promote-count``)
     mới được xếp TRƯỚC âm Unihan; âm chỉ gặp 1 lần đứng sau (1 cặp glossary
     dịch nghĩa lệch không đủ để đổi âm mặc định của chữ).
  3. Unihan ``kVietnamese`` (Unicode, giấy phép Unicode v3). Trường này lẫn
     cả âm Nôm (vd 女 → "nữa", 帝 → "đấy", 丕 → "vậy") nên chỉ dùng làm lớp
     nền; sai thì sửa ở overrides.
  4. Chữ giản thể/phồn thể thiếu dữ liệu mượn âm của biến thể qua
     ``kSimplifiedVariant``/``kTraditionalVariant`` (Unihan_Variants.txt).

Đầu ra:
  (a) ``frontend/src/data/hanviet.json``: ``{"林":"lâm","樂":"lạc|nhạc"}`` — JSON
      gọn (không khoảng trắng), tải lười trong trình duyệt.
  (b) ``tools/converter/data/chinese_phienam.txt``: mỗi dòng ``chữ=âm`` (chỉ âm
      đầu tiên) — đúng định dạng ``VietphraseConverter.load_dictionaries`` đọc.

Lấy dữ liệu Unihan (không bắt buộc — thiếu thì chỉ dùng glossary + overrides):
  * Tải https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip rồi
    ``--unihan Unihan.zip`` (hoặc thư mục đã giải nén, hoặc file Unihan_Readings.txt).
  * Hoặc ``npm pack @mandel59/mojidata`` (gói phân phối lại Unihan theo giấy phép
    Unicode v3), giải nén và ``--mojidata-db package/dist/moji.db``.

Script chỉ ĐỌC ``novels/``, không ghi gì vào đó. Nếu ``chinese_phienam.txt``
đã có NHIỀU dòng hơn bản sắp ghi (vd lỡ chạy thiếu ``--unihan`` → bảng teo lại)
thì KHÔNG ghi đè cả hai file, trừ khi thêm ``--force``.

Ví dụ:
    python tools/build_hanviet.py --unihan ~/Downloads/Unihan.zip
    python tools/build_hanviet.py --mojidata-db /tmp/moji/package/dist/moji.db --force
"""
from __future__ import annotations

import argparse
import gzip
import io
import json
import re
import sqlite3
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_NOVELS = ROOT / "novels"
DEFAULT_OVERRIDES = ROOT / "tools" / "converter" / "hanviet_overrides.json"
DEFAULT_JSON_OUT = ROOT / "frontend" / "src" / "data" / "hanviet.json"
DEFAULT_PHIENAM_OUT = ROOT / "tools" / "converter" / "data" / "chinese_phienam.txt"

UNIHAN_FIELDS = ("kVietnamese", "kSimplifiedVariant", "kTraditionalVariant")

# Khối chữ Hán được giữ mặc định: CJK Unified (khối chính) + Compatibility.
# Ext A (U+3400–4DBF) và các mặt phẳng bổ sung (Ext B trở đi) trong
# kVietnamese gần như toàn chữ Nôm, hầu như không xuất hiện trong truyện Trung
# → bỏ để file JSON nhỏ (bật lại bằng --all-planes). Chữ có trong glossary
# luôn được giữ dù nằm ở khối nào.
BMP_HAN_RANGES = ((0x4E00, 0x9FFF), (0xF900, 0xFAFF))

_HAN_RE = re.compile(
    r"^[㐀-䶿一-鿿豈-﫿\U00020000-\U0003134F]+$"
)
_SYLLABLE_RE = re.compile(r"^[^\W\d_]+$")

# Dấu thanh (dạng tổ hợp sau NFD).
_TONE_MARKS = {"̀", "́", "̃", "̉", "̣"}


# ---------------------------------------------------------------------------
# Chuẩn hoá
# ---------------------------------------------------------------------------

def is_han(text: str) -> bool:
    """True nếu chuỗi khác rỗng và toàn bộ là chữ Hán."""
    return bool(text) and bool(_HAN_RE.match(text))


def in_bmp_han(ch: str) -> bool:
    cp = ord(ch)
    return any(lo <= cp <= hi for lo, hi in BMP_HAN_RANGES)


def normalize_syllable(syl: str) -> str:
    """Chữ thường, NFC, dấu thanh kiểu mới cho oa/oe/uy cuối âm tiết.

    Unihan dùng kiểu cũ ("hoà", "thuỷ"), glossary dự án dùng kiểu mới
    ("hòa", "thủy") — gộp về kiểu mới để không đếm trùng. Không đụng "qu"
    (quý, quỷ) và âm tiết có phụ âm cuối (hoàn, huỳnh).
    """
    s = unicodedata.normalize("NFC", syl.strip().lower())
    if len(s) < 2:
        return s
    decomposed = unicodedata.normalize("NFD", s)
    tone = next((c for c in decomposed if c in _TONE_MARKS), None)
    if tone is None:
        return s
    bare = "".join(c for c in decomposed if c not in _TONE_MARKS)
    base = unicodedata.normalize("NFC", bare)
    if not (base.endswith(("oa", "oe", "uy"))):
        return s
    if base.endswith("uy") and base[:-2].endswith("q"):
        return s
    # Dấu đã nằm ở nguyên âm đầu của cặp thì giữ nguyên.
    first_idx = len(base) - 2
    rebuilt = base[:first_idx + 1] + tone + base[first_idx + 1:]
    return unicodedata.normalize("NFC", rebuilt)


def split_readings(value: str) -> list[str]:
    out: list[str] = []
    for part in re.split(r"[\s|,]+", value or ""):
        if not part:
            continue
        syl = normalize_syllable(part)
        if _SYLLABLE_RE.match(syl) and syl not in out:
            out.append(syl)
    return out


def _codepoints_to_chars(value: str) -> list[str]:
    chars = []
    for tok in (value or "").split():
        tok = tok.split("<", 1)[0]
        if tok.startswith("U+"):
            try:
                chars.append(chr(int(tok[2:], 16)))
            except ValueError:
                continue
    return chars


# ---------------------------------------------------------------------------
# Đọc Unihan
# ---------------------------------------------------------------------------

def parse_unihan_lines(lines, fields=UNIHAN_FIELDS) -> dict[str, dict[str, str]]:
    """Đọc định dạng Unihan: ``U+6797<TAB>kVietnamese<TAB>lâm``."""
    data: dict[str, dict[str, str]] = {f: {} for f in fields}
    for raw in lines:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        if not raw.startswith("U+"):
            continue
        parts = raw.rstrip("\r\n").split("\t", 2)
        if len(parts) != 3 or parts[1] not in data:
            continue
        try:
            ch = chr(int(parts[0][2:], 16))
        except ValueError:
            continue
        data[parts[1]][ch] = parts[2]
    return data


def _merge(dst, src):
    for f, m in src.items():
        dst.setdefault(f, {}).update(m)


def load_unihan(path: Path) -> dict[str, dict[str, str]]:
    """Nhận Unihan.zip, thư mục đã giải nén, hoặc một file Unihan_*.txt."""
    path = Path(path)
    data: dict[str, dict[str, str]] = {f: {} for f in UNIHAN_FIELDS}
    if path.is_dir():
        for name in ("Unihan_Readings.txt", "Unihan_Variants.txt"):
            p = path / name
            if p.exists():
                with open(p, encoding="utf-8") as fh:
                    _merge(data, parse_unihan_lines(fh))
    elif zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if Path(name).name in ("Unihan_Readings.txt", "Unihan_Variants.txt"):
                    with zf.open(name) as fh:
                        _merge(data, parse_unihan_lines(io.TextIOWrapper(fh, encoding="utf-8")))
    else:
        with open(path, encoding="utf-8") as fh:
            _merge(data, parse_unihan_lines(fh))
        # Cho phép trỏ vào Unihan_Readings.txt mà vẫn tự lấy file Variants cạnh nó.
        sibling = path.parent / "Unihan_Variants.txt"
        if sibling.exists() and sibling != path:
            with open(sibling, encoding="utf-8") as fh:
                _merge(data, parse_unihan_lines(fh))
    return data


def load_mojidata(db_path: Path) -> dict[str, dict[str, str]]:
    """Đọc Unihan từ SQLite của gói npm @mandel59/mojidata (chỉ đọc)."""
    data: dict[str, dict[str, str]] = {f: {} for f in UNIHAN_FIELDS}
    uri = f"file:{Path(db_path).resolve()}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    try:
        for field in UNIHAN_FIELDS:
            rows = con.execute(
                f'SELECT "UCS", "value" FROM "unihan_each_{field}" ORDER BY "UCS", "i"'
            ).fetchall()
            grouped: dict[str, list[str]] = defaultdict(list)
            for ucs, value in rows:
                ch = chr(int(ucs[2:], 16)) if ucs.startswith("U+") else ucs
                grouped[ch].append(value)
            data[field] = {ch: " ".join(vals) for ch, vals in grouped.items()}
    finally:
        con.close()
    return data


# ---------------------------------------------------------------------------
# Glossary
# ---------------------------------------------------------------------------

def iter_glossary_pairs(novels_dir: Path):
    """Sinh (zh, vi) từ glossary mọi truyện. Chỉ đọc."""
    for nj in sorted(Path(novels_dir).glob("*/novel.json")):
        try:
            data = json.loads(nj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        glossary = data.get("glossary") if isinstance(data, dict) else None
        if not isinstance(glossary, dict):
            continue
        for zh, vi in glossary.items():
            if isinstance(zh, str) and isinstance(vi, str):
                yield zh.strip(), vi.strip()


def count_glossary(pairs) -> dict[str, Counter]:
    """Đếm âm từng chữ từ các cặp có số chữ Hán = số âm tiết."""
    counts: dict[str, Counter] = defaultdict(Counter)
    for zh, vi in pairs:
        if not is_han(zh):
            continue
        syllables = [normalize_syllable(s) for s in vi.split()]
        if len(syllables) != len(zh):
            continue
        if not all(_SYLLABLE_RE.match(s) for s in syllables):
            continue
        for ch, syl in zip(zh, syllables):
            counts[ch][syl] += 1
    return counts


# ---------------------------------------------------------------------------
# Overrides
# ---------------------------------------------------------------------------

def load_overrides(path: Path | None) -> dict[str, list[str]]:
    """``{"女": "nữ", "行": "hành|hàng"}``; khoá bắt đầu bằng ``_`` là ghi chú,
    giá trị rỗng = xoá chữ khỏi bảng."""
    if not path or not Path(path).exists():
        return {}
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    out: dict[str, list[str]] = {}
    for k, v in raw.items():
        if k.startswith("_") or not isinstance(v, str):
            continue
        k = k.strip()
        if len(k) != 1 or not is_han(k):
            continue
        out[k] = split_readings(v)
    return out


# ---------------------------------------------------------------------------
# Ghép bảng
# ---------------------------------------------------------------------------

def _variants(ch: str, variant_map: dict[str, set[str]]) -> list[str]:
    return sorted(set(variant_map.get(ch, ())) - {ch})


def build_table(
    unihan: dict[str, dict[str, str]] | None,
    gl_counts: dict[str, Counter],
    overrides: dict[str, list[str]],
    *,
    all_planes: bool = False,
    min_new_count: int = 2,
    min_new_share: float = 0.25,
    min_promote_count: int = 2,
) -> dict[str, list[str]]:
    """Trả ``{chữ: [âm1, âm2, ...]}`` đã xếp ưu tiên.

    Thứ tự: overrides của chính chữ (thay toàn bộ) > âm glossary > overrides
    của biến thể phồn/giản > Unihan của chính chữ > Unihan của biến thể.

    Âm từ glossary KHÔNG có trong Unihan/overrides (kể cả biến thể) phải xuất
    hiện ít nhất ``min_new_count`` lần VÀ chiếm ≥ ``min_new_share`` số lần chữ
    đó xuất hiện mới được nhận — lọc nhiễu khi glossary dịch nghĩa chứ không
    phiên âm (vd 主 trong 领主 → "chúa"). Chữ không có nguồn nào khác thì nhận
    mọi âm glossary.

    Âm glossary chỉ đứng TRƯỚC âm Unihan khi xuất hiện ≥ ``min_promote_count``
    lần; ít hơn thì xếp sau Unihan (vẫn giữ làm âm phụ).
    """
    unihan = unihan or {}
    uni_read = {ch: split_readings(v) for ch, v in unihan.get("kVietnamese", {}).items()}
    uni_read = {ch: r for ch, r in uni_read.items() if r}

    # Biến thể phồn↔giản, hai chiều.
    variant_map: dict[str, set[str]] = defaultdict(set)
    for field in ("kSimplifiedVariant", "kTraditionalVariant"):
        for ch, value in unihan.get(field, {}).items():
            for other in _codepoints_to_chars(value):
                if other != ch:
                    variant_map[ch].add(other)
                    variant_map[other].add(ch)

    chars = set(uni_read) | set(gl_counts) | set(overrides)
    # Chữ chỉ có qua biến thể (vd giản thể 陈 ← 陳) cũng được thêm vào.
    for ch in list(chars):
        chars.update(variant_map.get(ch, ()))

    table: dict[str, list[str]] = {}
    for ch in chars:
        if ch in overrides:
            if overrides[ch]:
                table[ch] = list(overrides[ch])
            continue
        if not all_planes and not in_bmp_han(ch) and ch not in gl_counts:
            continue
        variants = _variants(ch, variant_map)
        own_uni = uni_read.get(ch, [])
        var_uni = [r for v in variants for r in uni_read.get(v, [])]
        var_ovr = [r for v in variants for r in overrides.get(v, [])]
        known = set(own_uni) | set(var_uni) | set(var_ovr)

        # Âm glossary: của chính chữ (đếm đủ) cộng của biến thể.
        gl = Counter(gl_counts.get(ch, {}))
        for v in variants:
            for syl, n in gl_counts.get(v, {}).items():
                gl[syl] += n
        total = sum(gl.values()) or 1
        gl_sorted = sorted(gl.items(), key=lambda kv: (-kv[1], kv[0]))
        gl_ok = [
            syl for syl, n in gl_sorted
            if not known or syl in known
            or (n >= min_new_count and n / total >= min_new_share)
        ]

        gl_strong = [syl for syl in gl_ok if gl[syl] >= min_promote_count]
        gl_weak = [syl for syl in gl_ok if gl[syl] < min_promote_count]
        ordered: list[str] = []
        for syl in gl_strong + var_ovr + own_uni + var_uni + gl_weak:
            if syl not in ordered:
                ordered.append(syl)
        if ordered:
            table[ch] = ordered
    return table


def to_json_bytes(table: dict[str, list[str]]) -> bytes:
    data = {ch: "|".join(table[ch]) for ch in sorted(table, key=ord)}
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def count_lines(path: Path) -> int:
    """Số dòng khác rỗng của file (không có file → 0)."""
    try:
        with open(path, encoding="utf-8") as fh:
            return sum(1 for line in fh if line.strip())
    except OSError:
        return 0


def to_phienam_text(table: dict[str, list[str]]) -> str:
    lines = [f"{ch}={table[ch][0]}" for ch in sorted(table, key=ord) if table[ch]]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Sinh bảng âm Hán Việt (hanviet.json + chinese_phienam.txt)")
    ap.add_argument("--unihan", type=Path, help="Unihan.zip, thư mục giải nén, hoặc Unihan_Readings.txt")
    ap.add_argument("--mojidata-db", type=Path, help="moji.db trong gói npm @mandel59/mojidata")
    ap.add_argument("--novels", type=Path, default=DEFAULT_NOVELS)
    ap.add_argument("--overrides", type=Path, default=DEFAULT_OVERRIDES)
    ap.add_argument("--json-out", type=Path, default=DEFAULT_JSON_OUT)
    ap.add_argument("--phienam-out", type=Path, default=DEFAULT_PHIENAM_OUT)
    ap.add_argument("--min-new-count", type=int, default=2)
    ap.add_argument("--min-new-share", type=float, default=0.25)
    ap.add_argument("--min-promote-count", type=int, default=2,
                    help="số lần tối thiểu để âm glossary được xếp trước âm Unihan")
    ap.add_argument("--all-planes", action="store_true", help="giữ cả Ext A và chữ ngoài BMP (chủ yếu chữ Nôm)")
    ap.add_argument("--dry-run", action="store_true", help="chỉ in thống kê, không ghi file")
    ap.add_argument("--force", action="store_true",
                    help="ghi đè kể cả khi chinese_phienam.txt hiện có nhiều dòng hơn bản mới")
    args = ap.parse_args(argv)

    unihan = None
    source = "glossary + overrides (không có Unihan)"
    if args.unihan:
        unihan = load_unihan(args.unihan)
        source = f"Unihan ({args.unihan})"
    elif args.mojidata_db:
        unihan = load_mojidata(args.mojidata_db)
        source = f"Unihan qua mojidata ({args.mojidata_db})"

    gl_counts = count_glossary(iter_glossary_pairs(args.novels))
    overrides = load_overrides(args.overrides)
    table = build_table(
        unihan, gl_counts, overrides,
        all_planes=args.all_planes, min_new_count=args.min_new_count,
        min_new_share=args.min_new_share, min_promote_count=args.min_promote_count,
    )

    js = to_json_bytes(table)
    multi = sum(1 for r in table.values() if len(r) > 1)
    print(f"[hanviet] nguồn: {source}")
    print(f"[hanviet] chữ từ glossary: {len(gl_counts)}, overrides: {len(overrides)}")
    print(f"[hanviet] tổng số chữ: {len(table)} (nhiều âm: {multi})")
    print(f"[hanviet] hanviet.json: {len(js):,} B raw, {len(gzip.compress(js, 9)):,} B gzip")

    if args.dry_run:
        return 0
    phienam = to_phienam_text(table)
    new_lines = phienam.count("\n")
    old_lines = count_lines(args.phienam_out)
    if old_lines > new_lines and not args.force:
        print(
            f"[hanviet] CẢNH BÁO: {args.phienam_out} hiện có {old_lines} dòng > {new_lines} dòng sắp ghi "
            "(quên --unihan/--mojidata-db?). Không ghi đè file nào; thêm --force nếu chủ ý.",
            file=sys.stderr,
        )
        return 1
    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.write_bytes(js + b"\n")
    args.phienam_out.parent.mkdir(parents=True, exist_ok=True)
    args.phienam_out.write_text(phienam, encoding="utf-8")
    print(f"[hanviet] đã ghi {args.json_out} và {args.phienam_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
