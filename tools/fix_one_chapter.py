import sys as _sys, os as _os; _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))  # cho phép import module ở root
"""
fix_one_chapter.py
------------------
Dịch lại MỘT chương cụ thể từ raw — an toàn, không bị cắt nội dung nhờ logic chia nhỏ tự động.

Cách dùng:
    python fix_one_chapter.py --novel <slug> --chapter "Tên_Chương"
"""
import os, sys, argparse, re
from dotenv import load_dotenv
from novel_manager import load_novel
from translator import NovelTranslator
from datetime import datetime
# Dùng bản canonical của split_chapter_content từ chapter_utils (tránh duplicate với main.py)
from chapter_utils import split_chapter_content

load_dotenv()

def _save_session_stats(slug: str, chapters_done: int, session_usage: dict, started_at=None):
    import json as _json
    os.makedirs("logs", exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    stats_file = os.path.join("logs", f"fix_{slug}_{ts}_stats.json")
    
    stats = {
        "slug":          slug,
        "timestamp":     datetime.now().isoformat(),
        "chapters_done": chapters_done,
        "total_tokens":  session_usage.get("total_tokens", 0),
        "input_tokens":  session_usage.get("input_tokens", 0),
        "output_tokens": session_usage.get("output_tokens", 0),
        "cost_usd":      session_usage.get("cost_usd", 0.0),
        "models":        list(session_usage.get("models", [])),
        "chapters_saved": session_usage.get("chapters_saved", []),
        "errors":        session_usage.get("errors", []),
    }
    
    if started_at:
        stats["started_at"] = started_at
        stats["ended_at"] = datetime.now().isoformat()

    try:
        with open(stats_file, "w", encoding="utf-8") as f:
            _json.dump(stats, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[!] Không lưu được stats file: {e}")

def main():
    parser = argparse.ArgumentParser(description="🔧 Dịch lại 1 chương cụ thể")
    parser.add_argument("--novel",   required=True, metavar="SLUG",  help="Slug truyện")
    parser.add_argument("--chapter", required=True, metavar="STEM",  help="Tên file raw (không có .txt)")
    args = parser.parse_args()

    profile = load_novel(args.novel)
    raw_path = os.path.join(profile.raw_dir, f"{args.chapter}.txt")
    
    if not os.path.exists(raw_path):
        print(f"❌ Không tìm thấy raw: {raw_path}")
        sys.exit(1)

    with open(raw_path, "r", encoding="utf-8") as f:
        content = f.read().strip()

    if not content:
        print("❌ File raw rỗng!")
        sys.exit(1)

    threshold = int(os.getenv("CHAPTER_SPLIT_THRESHOLD", "4500"))
    work_items = split_chapter_content(content, threshold)
    is_split = len(work_items) > 1

    print(f"\n{'='*60}")
    print(f"  Novel   : {profile.title}")
    print(f"  Chương  : {args.chapter}")
    print(f"  Raw size: {len(content):,} chars")
    if is_split:
        print(f"  [✂] Tự động chia thành {len(work_items)} phần (mỗi phần ~{threshold} ký tự)")
    print(f"{'='*60}\n")

    translator = NovelTranslator()
    started_at = datetime.now().isoformat()
    total_usage = {"total_tokens": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "models": set()}

    for i, part_content in enumerate(work_items):
        suffix = f"-{i+1}" if is_split else ""
        part_title = f"{args.chapter}{suffix}"
        
        print(f"[*] Đang dịch phần {i+1}/{len(work_items)}: {part_title}...")
        
        translated, summary, usage = translator.translate_chapter(
            title=part_title,
            content=part_content,
            glossary=profile.glossary,
            translation_style=profile.translation_style
        )

        out_filename = f"{args.chapter}{suffix}_VI.md"
        out_path = os.path.join(profile.translated_dir, out_filename)
        
        os.makedirs(profile.translated_dir, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(translated)
        
        # Thống kê
        total_usage["total_tokens"] += usage.get("total_tokens", 0)
        total_usage["input_tokens"] += usage.get("input_tokens", 0)
        total_usage["output_tokens"] += usage.get("output_tokens", 0)
        total_usage["cost_usd"] += usage.get("cost_usd", 0.0)
        if usage.get("model"):
            total_usage["models"].add(usage["model"])

        print(f"  ✅ Đã lưu: {out_filename}")

    # Lưu stats
    _save_session_stats(profile.slug, 1, total_usage, started_at=started_at)

    print(f"\n{'='*60}")
    print(f"  ✨ Hoàn thành dịch chương {args.chapter}!")
    print(f"  Tổng chi phí: ${total_usage['cost_usd']:.4f}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
