import sys as _sys, os as _os; _sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))  # cho phép import module ở root
"""
verify.py — chạy trên máy thật để test toàn bộ pipeline
Usage: python verify.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))

print("=" * 55)
print("  NOVEL TRANSLATOR — VERIFY")
print("=" * 55)

# ── 1. Check config ──────────────────────────────────────────
print("\n[1/4] Checking config...")
from config import (
    GOOGLE_API_KEYS, GEMINI_MODEL,
    DEEPSEEK_API_KEY, DEEPSEEK_MODEL,
    OLLAMA_ENABLED, OLLAMA_MODEL,
    TRANSLATION_PROVIDER, REQUEST_DELAY_SECONDS,
    BATCH_SIZE, BATCH_MAX_CHARS,
)
print(f"  Gemini keys    : {len(GOOGLE_API_KEYS)} key(s)")
print(f"  Gemini model   : {GEMINI_MODEL}")
print(f"  DeepSeek key   : {'✅ set' if DEEPSEEK_API_KEY else '❌ missing'}")
print(f"  DeepSeek model : {DEEPSEEK_MODEL}")
print(f"  Ollama enabled : {'✅ ' + OLLAMA_MODEL if OLLAMA_ENABLED else '⬜ disabled'}")
print(f"  Provider       : {TRANSLATION_PROVIDER}")
print(f"  Delay          : {REQUEST_DELAY_SECONDS}s")
print(f"  Batch size     : {BATCH_SIZE} chapters, max {BATCH_MAX_CHARS} chars")

# ── 2. Init translator ───────────────────────────────────────
print("\n[2/4] Initializing translator...")
try:
    from translator import NovelTranslator
    t = NovelTranslator()
    print(f"  Gemini backend   : {'✅' if t._gemini else '❌'}")
    print(f"  DeepSeek backend : {'✅' if t._deepseek else '❌'}")
    print(f"  Ollama backend   : {'✅' if t._ollama else '⬜ disabled'}")
except Exception as e:
    print(f"  ❌ Init failed: {e}")
    sys.exit(1)

# ── 3. Load novel profile ────────────────────────────────────
print("\n[3/4] Loading novel profile...")
from novel_manager import load_novel, list_novel_slugs
slugs = list_novel_slugs()
if not slugs:
    print("  ❌ No novels found. Create one with: python main.py new")
    sys.exit(1)

# Dùng truyện đầu tiên có sẵn
slug = slugs[0]
profile = load_novel(slug)
raw_files = sorted(f for f in os.listdir(profile.raw_dir) if f.endswith(".txt")) if os.path.isdir(profile.raw_dir) else []
print(f"  Novel   : {profile.title} ({slug})")
print(f"  Raw dir : {profile.raw_dir}")
print(f"  Files   : {len(raw_files)} chapters")
if not raw_files:
    print("  ❌ No raw files found!")
    sys.exit(1)

# ── 4. Translate chapter 1 ───────────────────────────────────
raw_name = raw_files[0]
raw_path = os.path.join(profile.raw_dir, raw_name)
title    = os.path.splitext(raw_name)[0]

with open(raw_path, "r", encoding="utf-8") as f:
    content = f.read()

print(f"\n[4/4] Translating '{title}' ({len(content)} chars)...")
print(f"  (This may take a few seconds...)\n")

translated, summary, _ = t.translate_chapter(
    title=title,
    content=content,
    glossary=profile.glossary,
)

print()
print("=" * 55)
if "[Translation failed" in translated:
    print("❌  RESULT: FAILED")
    print(translated[:500])
    sys.exit(1)
else:
    print("✅  RESULT: SUCCESS")
    print(f"\n--- Preview (first 500 chars) ---")
    print(translated[:500])
    print("...")
    if summary:
        print(f"\n--- Summary ---")
        print(summary[:200])

    out = os.path.join(profile.translated_dir, f"{title}_VI.md")
    os.makedirs(profile.translated_dir, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(translated)
    print(f"\n✅  Saved to: {out}")
    print(f"\n→  Run full retranslate:")
    print(f"   python main.py retranslate --novel {slug}")
