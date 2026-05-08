"""
fix_one_chapter.py
------------------
Dịch lại MỘT chương cụ thể từ raw — an toàn, không batch.

Cách dùng:
    python fix_one_chapter.py --novel <slug> --chapter "第127章 我心如月钩折"

Tự động:
  - Đọc file raw tương ứng
  - Dịch đơn lẻ (KHÔNG batch, không bị cắt)
  - Ghi đè file translated
  - In preview kết quả
"""
import os, sys, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv()

def _save_session_stats(slug: str, chapters_done: int, session_usage: dict):
    """
    Lưu token/cost stats của session vào file JSON riêng.
    File: logs/<slug>_<timestamp>_stats.json
    """
    import os
    import json as _json
    from datetime import datetime as _dt

    os.makedirs("logs", exist_ok=True)
    ts = _dt.now().strftime("%Y%m%d_%H%M%S")
    stats_file = os.path.join("logs", f"{slug}_{ts}_stats.json")

    stats = {
        "slug":          slug,
        "timestamp":     _dt.now().isoformat(),
        "chapters_done": chapters_done,
        "total_tokens":  session_usage.get("total_tokens", 0),
        "input_tokens":  session_usage.get("input_tokens", 0),
        "output_tokens": session_usage.get("output_tokens", 0),
        "cost_usd":      session_usage.get("cost_usd", 0.0),
        "models":        sorted(session_usage.get("models", set())),
    }
    try:
        with open(stats_file, "w", encoding="utf-8") as f:
            _json.dump(stats, f, ensure_ascii=False, indent=2)
        print(f"[*] Đã lưu thống kê chi phí: {stats_file}")
    except Exception as e:
        print(f"[!] Không lưu được stats file: {e}")


def main():
    parser = argparse.ArgumentParser(description="🔧 Dịch lại 1 chương cụ thể")
    parser.add_argument("--novel",   required=True, metavar="SLUG",  help="Slug truyện")
    parser.add_argument("--chapter", required=True, metavar="STEM",  help="Tên file raw (không có .txt)")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ kiểm tra, không dịch")
    args = parser.parse_args()

    from novel_manager import load_novel
    profile = load_novel(args.novel)

    raw_path   = os.path.join(profile.raw_dir,        f"{args.chapter}.txt")
    trans_path = os.path.join(profile.translated_dir, f"{args.chapter}_VI.md")

    # ── Kiểm tra file raw ──
    if not os.path.exists(raw_path):
        print(f"❌ Không tìm thấy raw: {raw_path}")
        sys.exit(1)

    raw_size = os.path.getsize(raw_path)
    with open(raw_path, "r", encoding="utf-8") as f:
        content = f.read().strip()

    trans_size_before = os.path.getsize(trans_path) if os.path.exists(trans_path) else 0

    print(f"\n{'='*60}")
    print(f"  Novel   : {profile.title}")
    print(f"  Chương  : {args.chapter}")
    print(f"  Raw     : {raw_size:,} bytes  ({len(content):,} chars)")
    print(f"  Trans   : {trans_size_before:,} bytes (trước khi fix)")
    print(f"{'='*60}\n")

    if args.dry_run:
        print("  [dry-run] Dừng tại đây — không dịch.")
        return

    if not content:
        print("❌ File raw rỗng!")
        sys.exit(1)

    print("[*] Đang dịch (KHÔNG batch — dịch đơn lẻ để tránh bị cắt)...")

    from translator import NovelTranslator
    translator = NovelTranslator()

    translated, summary, usage = translator.translate_chapter(
        title=args.chapter,
        content=content,
        glossary=profile.glossary,
        translation_style=profile.translation_style,
        max_retries=3,
    )

    if "[Translation failed" in translated[:200]:
        print(f"\n❌ FAILED:\n{translated[:300]}")
        sys.exit(1)

    # Ghi file
    os.makedirs(profile.translated_dir, exist_ok=True)
    with open(trans_path, "w", encoding="utf-8") as f:
        f.write(translated)

    trans_size_after = os.path.getsize(trans_path)

    # Lưu stats
    session_usage = {
        "total_tokens": usage.get("total_tokens", 0),
        "input_tokens": usage.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0),
        "cost_usd": usage.get("cost_usd", 0.0),
        "models": {usage["model"]} if usage.get("model") else set()
    }
    _save_session_stats(profile.slug, 1, session_usage)

    print(f"\n{'='*60}")
    print(f"  ✅ Thành công!")
    print(f"  Trans size : {trans_size_before:,}B → {trans_size_after:,}B")
    print(f"  Tỷ lệ      : {trans_size_after/raw_size:.2f}x (raw={raw_size:,}B)")
    print(f"{'='*60}")
    print(f"\n── Preview (200 chars đầu) ──")
    print(translated[:200].replace('\n', ' '))
    print(f"\n── Preview (200 chars cuối) ──")
    print(translated[-200:].replace('\n', ' '))
    if summary:
        print(f"\n── Summary ──")
        print(summary[:200])


if __name__ == "__main__":
    main()
