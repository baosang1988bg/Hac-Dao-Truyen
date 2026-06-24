#!/usr/bin/env python3
import os
import sys
import json
import asyncio
from pathlib import Path

# Add Cwd/root path to sys.path
sys.path.append(os.getcwd())
try:
    from novel_manager import load_novel
    from main import find_untranslated_raws, _get_translator, safe_filename, merge_translated_parts, is_split_original, get_split_part_count
except ImportError:
    # Fallback to parent resolves
    sys.path.append(str(Path(__file__).resolve().parents[4]))
    from novel_manager import load_novel
    from main import find_untranslated_raws, _get_translator, safe_filename, merge_translated_parts, is_split_original, get_split_part_count

async def process_batch_async(translator, profile, batch_items, previous_summary=""):
    batch_data = []
    for raw_path, _ in batch_items:
        raw_name = os.path.basename(raw_path)
        title = os.path.splitext(raw_name)[0]
        try:
            with open(raw_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
            batch_data.append((title, content))
        except Exception as e:
            print(f"  ❌ Cannot read {raw_name}: {e}")
            batch_data.append((title, ""))

    print(f"[*] Translating batch of {len(batch_data)} chapters: {[t for t, _ in batch_data]}")
    
    translated_chapters, summary, new_glossary, batch_usage = await asyncio.to_thread(
        translator.translate_batch,
        chapters=batch_data,
        glossary=profile.glossary,
        translation_style=profile.translation_style,
        previous_summary=previous_summary,
        max_retries=3
    )

    for i, (raw_path, out_path) in enumerate(batch_items):
        if i >= len(translated_chapters) or translated_chapters[i] is None:
            print(f"  ❌ Translation failed/missing for: {os.path.basename(raw_path)}")
            continue
            
        translated_text = translated_chapters[i]
        if "[Translation failed" in translated_text:
            print(f"  ❌ Translation failed: {os.path.basename(raw_path)}")
            continue

        try:
            with open(out_path, "w", encoding="utf-8") as f:
                f.write(translated_text)
            print(f"  ✓ Saved: {os.path.basename(out_path)}")
        except Exception as e:
            print(f"  ❌ Error saving {os.path.basename(out_path)}: {e}")

    return summary

async def main():
    slug = "toan-cau-cau-sinh-khai-cuc-mot-chiec-be-go"
    try:
        profile = load_novel(slug)
    except Exception as e:
        print(f"Error loading novel: {e}")
        return

    pending = find_untranslated_raws(profile)
    if not pending:
        print("🎉 No pending files to translate!")
        return

    print(f"🔍 Found {len(pending)} pending files to translate.")
    
    translator = _get_translator()
    
    BATCH_SIZE = 1
    MAX_CONCURRENT = 5
    
    batches = [pending[i:i + BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]
    
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    previous_summary = ""

    async def run_batch_with_sem(batch):
        nonlocal previous_summary
        async with semaphore:
            try:
                summary = await process_batch_async(translator, profile, batch, previous_summary)
                if summary:
                    previous_summary = summary
            except Exception as e:
                print(f"  ❌ Exception processing batch: {e}")

    tasks = [run_batch_with_sem(b) for b in batches]
    await asyncio.gather(*tasks)

    print("\n[*] Checking for completed split chapters to merge...")
    raw_files = sorted(f for f in os.listdir(profile.raw_dir) if f.endswith(".txt"))
    merged_count = 0
    for raw_name in raw_files:
        stem = os.path.splitext(raw_name)[0]
        if is_split_original(profile.raw_dir, stem):
            num_parts = get_split_part_count(profile.raw_dir, stem)
            all_parts_done = True
            for i in range(1, num_parts + 1):
                part_vi_path = os.path.join(profile.translated_dir, f"{safe_filename(stem)}-{i}_VI.md")
                if not os.path.exists(part_vi_path):
                    all_parts_done = False
                    break
            
            if all_parts_done:
                out_path = os.path.join(profile.translated_dir, f"{safe_filename(stem)}_VI.md")
                if not os.path.exists(out_path):
                    ok = merge_translated_parts(profile, stem, num_parts)
                    if ok:
                        print(f"  ✓ Merged split chapter: {stem} ({num_parts} parts)")
                        merged_count += 1

    print(f"\n🎉 Parallel translation complete! Merged {merged_count} split chapters.")

if __name__ == "__main__":
    asyncio.run(main())
