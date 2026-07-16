"""
tools/qa_check.py
-----------------
QA chất lượng dịch (roadmap 3.5) — chấm điểm health từng chương đã dịch.

Với mỗi file novels/<slug>/translated/*_VI.md, đối chiếu file raw tương ứng
trong text_raw/ (khớp theo số chương, parse bằng chapter_num của
tools/normalize_chapters.py):

  - han_chars     : số ký tự Hán còn sót trong bản dịch — >20 là đỏ (-40)
  - failed_marker : chứa '[Translation failed' → điểm 0, đỏ ngay
  - len_ratio     : len(dịch)/len(raw) — <0.5 hoặc >4 nghi thiếu đoạn/lặp (-30)
  - para_ratio    : số đoạn dịch / số đoạn raw — <0.6 nghi thiếu đoạn (-20)

Kết quả ghi novels/<slug>/qa_report.json:
  {generated_at, chapters: [{file, chapter, score, issues, ...}],
   summary: {red, yellow, green}}

Chạy:
  python3 tools/qa_check.py --slug <slug>   # 1 truyện: in bảng + ghi json
  python3 tools/qa_check.py --all           # mọi truyện có translated/
"""

import os
import re
import sys
import json
import argparse
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from tools.normalize_chapters import chapter_num  # noqa: E402

NOVELS_DIR = os.path.join(ROOT, "novels")

# Ký tự Hán (CJK Unified Ideographs cơ bản)
HAN_RE = re.compile(r"[一-鿿]")
FAILED_MARKER = "[Translation failed"
# File phần split "…-1_VI.md" — bỏ qua khi bản merge đã tồn tại (đồng bộ với
# routers/novels.py và tools/normalize_chapters.py)
_SPLIT_PART_RE = re.compile(r"^(.+)-(\d+)_VI\.md$")

# Đuôi file raw chấp nhận được trong text_raw/
_RAW_EXTS = (".txt", ".md")
# Dòng metadata do crawler chèn vào đầu file raw — không tính vào nội dung
_RAW_META_PREFIXES = ("Title:", "URL Source:", "Markdown Content:", "Published Time:")


def _read_text(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except (OSError, UnicodeDecodeError):
        return ""


def _strip_raw_meta(text: str) -> str:
    """Bỏ các dòng metadata crawler ở file raw để so sánh công bằng."""
    return "\n".join(
        ln for ln in text.splitlines() if not ln.startswith(_RAW_META_PREFIXES)
    )


def _paragraphs(text: str) -> int:
    """Đếm số đoạn = dòng không rỗng, bỏ dòng heading markdown."""
    return sum(
        1 for ln in text.splitlines()
        if ln.strip() and not ln.lstrip().startswith("#")
    )


def _raw_index(novel_dir: str) -> dict:
    """Map số chương → list đường dẫn file raw (1 chương có thể nhiều part)."""
    raw_dir = os.path.join(novel_dir, "text_raw")
    index = {}
    if not os.path.isdir(raw_dir):
        return index
    for f in sorted(os.listdir(raw_dir)):
        if not f.lower().endswith(_RAW_EXTS):
            continue
        n = chapter_num(f)
        if n is not None:
            index.setdefault(n, []).append(os.path.join(raw_dir, f))
    return index


def score_chapter(vi_text: str, raw_text: str | None) -> dict:
    """
    Chấm 1 chương: trả {score, issues, han_chars, len_ratio, para_ratio, has_raw}.
    Score: 100 trừ dần — failed_marker: =0; han>20: -40; len_ratio lệch: -30;
    para_ratio thiếu: -20.
    """
    issues = []
    score = 100

    failed = FAILED_MARKER in vi_text
    han = len(HAN_RE.findall(vi_text))
    len_ratio = para_ratio = None

    if han > 20:
        issues.append(f"han_chars={han} (>20 ký tự Hán còn sót)")
        score -= 40

    if raw_text:
        vi_len = len(vi_text.strip())
        raw_len = len(raw_text.strip())
        len_ratio = round(vi_len / max(1, raw_len), 2)
        if len_ratio < 0.5 or len_ratio > 4:
            issues.append(f"len_ratio={len_ratio} (nghi thiếu đoạn/lặp, chuẩn 0.5–4)")
            score -= 30
        para_ratio = round(_paragraphs(vi_text) / max(1, _paragraphs(raw_text)), 2)
        if para_ratio < 0.6:
            issues.append(f"para_ratio={para_ratio} (<0.6, nghi thiếu đoạn)")
            score -= 20

    if failed:
        issues.append("failed_marker: chứa '[Translation failed'")
        score = 0

    return {
        "score": max(0, score),
        "issues": issues,
        "han_chars": han,
        "len_ratio": len_ratio,
        "para_ratio": para_ratio,
        "has_raw": raw_text is not None,
    }


def _color(entry: dict) -> str:
    """red / yellow / green theo quy ước: failed hoặc han>20 hoặc score<50 → đỏ."""
    if entry["score"] == 0 or entry["han_chars"] > 20 or entry["score"] < 50:
        return "red"
    return "green" if not entry["issues"] else "yellow"


def run_qa(slug: str, write: bool = True) -> dict:
    """
    Chấm toàn bộ chương đã dịch của 1 truyện, trả report dict và (mặc định)
    ghi novels/<slug>/qa_report.json. Raise FileNotFoundError nếu truyện
    chưa có thư mục translated/.
    """
    novel_dir = os.path.join(NOVELS_DIR, slug)
    trans_dir = os.path.join(novel_dir, "translated")
    if not os.path.isdir(trans_dir):
        raise FileNotFoundError(f"Không tìm thấy novels/{slug}/translated/")

    all_md = set(f for f in os.listdir(trans_dir) if f.endswith("_VI.md"))
    files = []
    for f in all_md:
        m = _SPLIT_PART_RE.match(f)
        if m and f"{m.group(1)}_VI.md" in all_md:
            continue  # phần split đã có bản merge → bỏ
        files.append(f)

    raw_index = _raw_index(novel_dir)

    chapters = []
    for f in sorted(files, key=lambda x: (chapter_num(x) is None, chapter_num(x) or 0, x)):
        vi_text = _read_text(os.path.join(trans_dir, f))
        n = chapter_num(f)
        raw_text = None
        if n is not None and n in raw_index:
            raw_text = _strip_raw_meta(
                "\n".join(_read_text(p) for p in raw_index[n])
            )
        entry = {"file": f, "chapter": n}
        entry.update(score_chapter(vi_text, raw_text))
        entry["color"] = _color(entry)
        chapters.append(entry)

    summary = {"red": 0, "yellow": 0, "green": 0}
    for c in chapters:
        summary[c["color"]] += 1

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "slug": slug,
        "total": len(chapters),
        "chapters": chapters,
        "summary": summary,
    }
    if write:
        out_path = os.path.join(novel_dir, "qa_report.json")
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=1)
    return report


def _print_report(report: dict, max_rows: int = 25) -> None:
    s = report["summary"]
    print(f"\n📚 {report['slug']} — {report['total']} chương "
          f"| 🟢 {s['green']}  🟡 {s['yellow']}  🔴 {s['red']}")
    bad = [c for c in report["chapters"] if c["color"] != "green"]
    if not bad:
        print("   Tất cả chương đều xanh — không phát hiện vấn đề.")
        return
    print(f"   {'Chương':>7} | {'Điểm':>4} | Vấn đề")
    print(f"   {'-'*7}-+-{'-'*4}-+-{'-'*40}")
    for c in bad[:max_rows]:
        mark = "🔴" if c["color"] == "red" else "🟡"
        num = c["chapter"] if c["chapter"] is not None else "?"
        print(f"   {str(num):>7} | {c['score']:>4} | {mark} {'; '.join(c['issues'])}")
    if len(bad) > max_rows:
        print(f"   ... và {len(bad) - max_rows} chương có vấn đề nữa (xem qa_report.json)")


def main():
    ap = argparse.ArgumentParser(description="QA chất lượng dịch từng chương")
    ap.add_argument("--slug", help="chỉ chấm 1 truyện")
    ap.add_argument("--all", action="store_true", help="chấm mọi truyện có translated/")
    args = ap.parse_args()

    if not args.slug and not args.all:
        ap.error("cần --slug <slug> hoặc --all")

    slugs = [args.slug] if args.slug else sorted(
        d for d in os.listdir(NOVELS_DIR)
        if os.path.isdir(os.path.join(NOVELS_DIR, d, "translated"))
    )

    grand = {"red": 0, "yellow": 0, "green": 0}
    for slug in slugs:
        try:
            report = run_qa(slug)
        except FileNotFoundError as e:
            print(f"⚠ {slug}: {e}")
            continue
        _print_report(report)
        for k in grand:
            grand[k] += report["summary"][k]
        print(f"   → đã ghi novels/{slug}/qa_report.json")

    if len(slugs) > 1:
        print(f"\nTổng: 🟢 {grand['green']}  🟡 {grand['yellow']}  🔴 {grand['red']}")


if __name__ == "__main__":
    main()
