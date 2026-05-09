"""
fix_truncated.py
----------------
Tìm và fix tất cả chương bị cắt giữa chừng (truncation).
Khác với fix_chapters.py (chỉ tìm missing/failed), script này
phát hiện chương có nội dung nhưng kết thúc đột ngột — dấu hiệu
bị Gemini cắt do output token limit.

Cách dùng:
    python fix_truncated.py --novel <slug>          # scan + fix
    python fix_truncated.py --novel <slug> --report # chỉ báo cáo
    python fix_truncated.py --all                   # tất cả truyện
"""
import os, sys, re, time, argparse, json as _json
from datetime import datetime as _dt
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

from novel_manager import load_novel, list_novel_slugs


# ── Session stats persistence ─────────────────────────────────────────────────
def _save_session_stats(slug: str, chapters_done: int, session_usage: dict, started_at: str = None):
    """Lưu token/cost stats của phiên fix_truncated vào file JSON."""
    os.makedirs("logs", exist_ok=True)
    ts = _dt.now().strftime("%Y%m%d_%H%M%S")
    stats_file = os.path.join("logs", f"fix_{slug}_{ts}_stats.json")

    ended_at     = _dt.now().isoformat()
    duration_sec = 0
    if started_at:
        try:
            duration_sec = int((_dt.fromisoformat(ended_at) - _dt.fromisoformat(started_at)).total_seconds())
        except Exception:
            pass

    stats = {
        "slug":           slug,
        "timestamp":      ended_at,
        "chapters_done":  chapters_done,
        "total_tokens":   session_usage.get("total_tokens", 0),
        "input_tokens":   session_usage.get("input_tokens", 0),
        "output_tokens":  session_usage.get("output_tokens", 0),
        "cost_usd":       session_usage.get("cost_usd", 0.0),
        "models":         sorted(session_usage.get("models", set())),
        "chapters_saved": session_usage.get("chapters_saved", []),
        "errors":         session_usage.get("errors", []),
        "started_at":     started_at or ended_at,
        "ended_at":       ended_at,
        "duration_sec":   duration_sec,
    }
    try:
        with open(stats_file, "w", encoding="utf-8") as f:
            _json.dump(stats, f, ensure_ascii=False, indent=2)
        print(f"  [*] Stats saved: {stats_file}")
    except Exception as e:
        print(f"  [!] Could not save stats: {e}")

# ── Dấu hiệu bị cắt giữa chừng ──────────────────────────────────────────────
# Câu cuối cùng của file không kết thúc đúng cách
_INCOMPLETE_ENDINGS = [
    # Câu chưa hết
    r'[,，、；：\s]$',          # kết thúc bằng dấu phẩy / dấu câu lửng
    r'[^\.\!\?\。\！\？」』》）]$',  # không có dấu câu kết thúc
]

_COMPLETE_MARKERS = [
    "(Hết chương)", "(hết chương)", "Hết chương",
    "(End)", "(完)", "本章完",
]

def is_truncated(filepath: str) -> bool:
    """Kiểm tra file dịch có bị cắt giữa chừng không."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read().strip()
    except Exception:
        return False

    if not content or len(content) < 200:
        return False  # quá ngắn → để fix_chapters.py xử lý

    # Nếu có marker kết thúc → OK
    for marker in _COMPLETE_MARKERS:
        if marker in content[-200:]:
            return False

    # Lấy dòng cuối có nội dung
    lines = [l.strip() for l in content.split('\n') if l.strip()]
    if not lines:
        return False
    last_line = lines[-1]

    # Bỏ qua file chỉ có %%SUMMARY%%
    # Không skip dòng ngắn ở đây — dòng ngắn < 15 chars là dấu hiệu bị cắt
    if last_line.startswith('%%'):
        return False

    # Dấu hiệu câu chưa hoàn chỉnh: kết thúc bằng dấu phẩy, dấu chấm lửng,
    # hoặc không có dấu câu kết thúc chuẩn
    if last_line.endswith((',', '，', '、', '；', '：', '...',)):
        return True

    # Dòng cuối quá ngắn (< 15 chars) — câu bị cắt giữa chừng (vd: '"M', 'Ca…')
    if len(last_line) < 15:
        return True

    # Câu đang kể chuyện bị cắt (không có dấu câu cuối)
    ends_ok = any(last_line.endswith(m) for m in ('.', '!', '?', '。', '！', '？', '"', '"', '»', '）', ')'))
    if not ends_ok and len(last_line) > 10:
        return True

    return False


def ratio_check(raw_path: str, trans_path: str) -> float:
    """Tỷ lệ bytes trans/raw. Vietnamese thường 1.3–2.5x."""
    try:
        raw_size   = os.path.getsize(raw_path)
        trans_size = os.path.getsize(trans_path)
        return trans_size / raw_size if raw_size > 0 else 0
    except Exception:
        return 0


def scan_novel(slug: str) -> list[dict]:
    """Trả về danh sách chương bị truncate.

    Nhận biết split chapters:
    - File gốc đã split (stem-1.txt tồn tại) → kiểm tra merged file
    - File phần (stem-N) → bỏ qua nếu file gốc đã merge OK
    """
    profile = load_novel(slug)
    if not os.path.isdir(profile.raw_dir) or not os.path.isdir(profile.translated_dir):
        return []

    all_raw = set(os.listdir(profile.raw_dir))
    _part_re = re.compile(r'^(.+)-(\d+)$')

    issues = []
    for raw_name in sorted(f for f in all_raw if f.endswith('.txt')):
        stem       = os.path.splitext(raw_name)[0]
        raw_path   = os.path.join(profile.raw_dir, raw_name)
        trans_path = os.path.join(profile.translated_dir, f"{stem}_VI.md")

        # ── File gốc đã split → kiểm tra merged file ────────────────────
        if f"{stem}-1.txt" in all_raw:
            # Dùng merged file để check truncation
            if not os.path.exists(trans_path) or os.path.getsize(trans_path) < 100:
                continue  # chưa merge → fix_chapters xử lý
            ratio     = ratio_check(raw_path, trans_path)
            truncated = is_truncated(trans_path)
            if truncated or ratio < 0.5:
                issues.append({
                    "stem": stem, "raw_path": raw_path,
                    "trans_path": trans_path,
                    "ratio": ratio, "truncated": truncated,
                    "is_split_orig": True,
                })
            continue

        # ── File phần split (stem-N) → bỏ qua nếu gốc đã merge OK ──────
        pm = _part_re.match(stem)
        if pm:
            orig_stem = pm.group(1)
            # Prefix match vì gốc có thể có tiêu đề dài: "第1033章 xxx_VI.md"
            _no_extra_part = re.compile(rf'^{re.escape(orig_stem)}(?:[^-].*)?_VI\.md$')
            all_trans = os.listdir(profile.translated_dir)
            orig_merged_ok = False
            for orig_f in all_trans:
                if not _no_extra_part.match(orig_f):
                    continue
                orig_vi = os.path.join(profile.translated_dir, orig_f)
                if os.path.exists(orig_vi) and os.path.getsize(orig_vi) > 100:
                    try:
                        head = open(orig_vi, encoding='utf-8').read(200)
                        if "[Translation failed" not in head:
                            orig_merged_ok = True
                            break
                    except Exception:
                        pass
            if orig_merged_ok:
                continue  # gốc đã merge OK → bỏ qua phần

        # ── File thường ──────────────────────────────────────────────────
        if not os.path.exists(trans_path):
            continue  # missing → fix_chapters.py
        if os.path.getsize(trans_path) < 100:
            continue  # quá ngắn → fix_chapters.py

        ratio     = ratio_check(raw_path, trans_path)
        truncated = is_truncated(trans_path)
        if truncated or ratio < 0.5:
            issues.append({
                "stem": stem, "raw_path": raw_path,
                "trans_path": trans_path,
                "ratio": ratio, "truncated": truncated,
                "is_split_orig": False,
            })

    return issues


def fix_chapter(issue: dict, profile, translator) -> tuple[bool, dict]:
    """Dịch lại 1 chương. Tự động split nếu raw > CHAPTER_SPLIT_THRESHOLD.
    Returns (success, merged_usage_dict).
    """
    with open(issue["raw_path"], "r", encoding="utf-8") as f:
        content = f.read().strip()

    if not content:
        return False, {}

    # Import split logic từ main.py
    try:
        from main import split_chapter_content, merge_translated_parts, CHAPTER_SPLIT_THRESHOLD
    except ImportError:
        CHAPTER_SPLIT_THRESHOLD = 4500
        split_chapter_content   = None
        merge_translated_parts  = None

    stem       = issue["stem"]
    trans_path = issue["trans_path"]
    is_large   = split_chapter_content and len(content) > CHAPTER_SPLIT_THRESHOLD

    # Nếu là file gốc đã split → dịch lại từng phần rồi re-merge
    is_split_orig = issue.get("is_split_orig", False)

    if is_split_orig or is_large:
        chunks = split_chapter_content(content) if split_chapter_content else [content]
        print(f"    [✂] {len(content):,} chars → {len(chunks)} phần")

        merged_usage = {"total_tokens":0,"input_tokens":0,"output_tokens":0,"cost_usd":0.0,"model":""}
        all_ok = True

        for idx, chunk in enumerate(chunks, start=1):
            part_stem  = f"{stem}-{idx}"
            part_out   = os.path.join(profile.translated_dir, f"{part_stem}_VI.md")
            part_raw   = os.path.join(profile.raw_dir, f"{part_stem}.txt")
            # Lưu raw phần nếu chưa có
            if not os.path.exists(part_raw):
                with open(part_raw, "w", encoding="utf-8") as f:
                    f.write(chunk)

            translated, _, usage = translator.translate_chapter(
                title=part_stem,
                content=chunk,
                glossary=profile.glossary,
                translation_style=profile.translation_style,
                max_retries=3,
            )
            if "[Translation failed" in translated[:200]:
                print(f"    ❌ FAILED part {idx}: {translated[:80]}")
                all_ok = False
                break

            with open(part_out, "w", encoding="utf-8") as f:
                f.write(translated)
            print(f"    ✓ Part {idx}: {os.path.getsize(part_out):,}B")
            merged_usage["total_tokens"]  += usage.get("total_tokens", 0)
            merged_usage["input_tokens"]  += usage.get("input_tokens", 0)
            merged_usage["output_tokens"] += usage.get("output_tokens", 0)
            merged_usage["cost_usd"]      += usage.get("cost_usd", 0.0)
            merged_usage["model"]          = usage.get("model", merged_usage["model"])
            time.sleep(2)

        if all_ok and merge_translated_parts:
            ok = merge_translated_parts(profile, stem, len(chunks))
            if ok:
                print(f"    ✅ Merged {len(chunks)} phần → {os.path.getsize(trans_path):,}B")
                return True, merged_usage
            else:
                print(f"    ❌ Merge thất bại")
                return False, merged_usage

        return all_ok, merged_usage

    # ── File thường (không split) ────────────────────────────────────────
    translated, _, usage = translator.translate_chapter(
        title=stem,
        content=content,
        glossary=profile.glossary,
        translation_style=profile.translation_style,
        max_retries=3,
    )

    if "[Translation failed" in translated[:200]:
        print(f"    ❌ FAILED: {translated[:120]}")
        return False, usage or {}

    with open(trans_path, "w", encoding="utf-8") as f:
        f.write(translated)

    print(f"    ✅ {os.path.getsize(trans_path):,}B — {translated[:70].replace(chr(10),' ')}...")
    return True, usage or {}


def main():
    parser = argparse.ArgumentParser(description="🔧 Fix chương bị truncate (cắt giữa chừng)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--novel", metavar="SLUG")
    group.add_argument("--all",   action="store_true")
    parser.add_argument("--report", action="store_true", help="Chỉ báo cáo, không fix")
    args = parser.parse_args()

    slugs = list_novel_slugs() if args.all else [args.novel]

    total_found = total_fixed = 0

    for slug in slugs:
        try:
            profile = load_novel(slug)
        except FileNotFoundError as e:
            print(f"[!] {e}"); continue

        print(f"\n── {profile.title} ({slug}) ──────────────────────")
        issues = scan_novel(slug)

        if not issues:
            print(f"  ✅ Không tìm thấy chương nào bị cắt")
            continue

        total_found += len(issues)
        print(f"  ⚠️  Tìm thấy {len(issues)} chương nghi ngờ bị cắt:")
        for iss in issues:
            flag = "✂️  truncated" if iss["truncated"] else f"📉 ratio={iss['ratio']:.2f}x"
            print(f"    {flag}  {iss['stem']}")

        if args.report:
            continue

        print(f"\n  🔧 Đang fix {len(issues)} chương...")
        from translator import NovelTranslator
        translator = NovelTranslator()
        fixed = 0

        # Session tracking
        started_at = _dt.now().isoformat()
        session_usage = {
            "total_tokens": 0, "input_tokens": 0, "output_tokens": 0,
            "cost_usd": 0.0, "models": set(),
            "chapters_saved": [], "errors": [],
        }

        for iss in issues:
            print(f"\n  [{fixed+1}/{len(issues)}] {iss['stem']}")
            ok, usage = fix_chapter(iss, profile, translator)
            if ok:
                fixed += 1
                session_usage["chapters_saved"].append(iss["stem"])
            else:
                session_usage["errors"].append(f"Truncated fix thất bại: {iss['stem']}")
            # Accumulate tokens
            session_usage["total_tokens"]  += usage.get("total_tokens", 0)
            session_usage["input_tokens"]  += usage.get("input_tokens", 0)
            session_usage["output_tokens"] += usage.get("output_tokens", 0)
            session_usage["cost_usd"]      += usage.get("cost_usd", 0.0)
            if usage.get("model"):
                session_usage["models"].add(usage["model"])
            time.sleep(3)

        total_fixed += fixed
        print(f"\n  ✅ {fixed}/{len(issues)} chương đã fix")

        # Lưu stats nếu có dịch
        if fixed > 0 or len(issues) > 0:
            _save_session_stats(slug, fixed, session_usage, started_at=started_at)

    print(f"\n{'='*55}")
    print(f"  Tổng: tìm {total_found} chương bị cắt, fix {total_fixed} thành công")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    main()
