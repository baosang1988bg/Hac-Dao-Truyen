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
    """Trả về danh sách chương bị truncate."""
    profile = load_novel(slug)
    if not os.path.isdir(profile.raw_dir) or not os.path.isdir(profile.translated_dir):
        return []

    issues = []
    for raw_name in sorted(f for f in os.listdir(profile.raw_dir) if f.endswith('.txt')):
        stem      = os.path.splitext(raw_name)[0]
        trans_name = f"{stem}_VI.md"
        raw_path   = os.path.join(profile.raw_dir, raw_name)
        trans_path = os.path.join(profile.translated_dir, trans_name)

        if not os.path.exists(trans_path):
            continue  # missing → fix_chapters.py

        if os.path.getsize(trans_path) < 100:
            continue  # quá ngắn → fix_chapters.py

        ratio = ratio_check(raw_path, trans_path)
        truncated = is_truncated(trans_path)

        if truncated or ratio < 0.5:
            issues.append({
                "stem":       stem,
                "raw_path":   raw_path,
                "trans_path": trans_path,
                "ratio":      ratio,
                "truncated":  truncated,
            })

    return issues


def fix_chapter(issue: dict, profile, translator) -> tuple[bool, dict]:
    """Dịch lại 1 chương. Returns (success, usage_dict)."""
    with open(issue["raw_path"], "r", encoding="utf-8") as f:
        content = f.read().strip()

    if not content:
        return False, {}

    translated, _, usage = translator.translate_chapter(
        title=issue["stem"],
        content=content,
        glossary=profile.glossary,
        translation_style=profile.translation_style,
        max_retries=3,
    )

    if "[Translation failed" in translated[:200]:
        print(f"    ❌ FAILED: {translated[:120]}")
        return False, usage or {}

    with open(issue["trans_path"], "w", encoding="utf-8") as f:
        f.write(translated)

    new_size = os.path.getsize(issue["trans_path"])
    print(f"    ✅ {new_size:,}B — {translated[:70].replace(chr(10),' ')}...")
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
