#!/usr/bin/env python3
"""
migrate_to_cloudflare.py — v3
==============================
Sync novels/ lên Cloudflare D1 + R2.

Fix:
- SQLITE_TOOBIG: mỗi statement tối đa 1 dòng, batch nhỏ 10 chapters
- Glossary lưu riêng trong R2 thay vì nhét vào D1 row
- R2 upload dùng wrangler thực tế

Cách dùng:
  python migrate_to_cloudflare.py --slug xich-tam-tuan-thien
  python migrate_to_cloudflare.py --slug xich-tam-tuan-thien --skip-r2
  python migrate_to_cloudflare.py  # tất cả novels
"""

import os, re, json, subprocess, argparse, sys, tempfile
from pathlib import Path
from datetime import datetime

NOVELS_DIR = Path("novels")
D1_DB_NAME = "hacdao-db"
R2_BUCKET  = "hacdao-chapters"
WRANGLER   = "npx wrangler"
BATCH_SIZE = 10   # chapters mỗi lần gọi D1, nhỏ để tránh TOOBIG

# ─────────────────────────────────────────────────────────────────────────────

def run(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)

def d1_file(sql: str, dry_run=False) -> bool:
    """Chạy SQL qua --file để tránh shell-escape issues."""
    if dry_run:
        print(f"    [DRY-D1] {sql[:80].strip()}...")
        return True
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql',
                                     encoding='utf-8', delete=False) as f:
        f.write(sql + "\n")
        tmp = f.name
    try:
        r = run(f'{WRANGLER} d1 execute {D1_DB_NAME} --remote --file="{tmp}"')
        if r.returncode != 0:
            # In dòng lỗi thực sự, bỏ qua dòng WARNING về downtime
            for line in r.stderr.splitlines():
                if 'WARNING' not in line and line.strip():
                    print(f"    [D1-ERR] {line.strip()}")
            return False
        return True
    finally:
        os.unlink(tmp)

def r2_put(local: Path, key: str, dry_run=False) -> bool:
    """Upload file lên R2."""
    if dry_run:
        print(f"    [DRY-R2] {key}")
        return True
    r = run(f'{WRANGLER} r2 object put "{R2_BUCKET}/{key}" --file="{local}"')
    if r.returncode != 0:
        print(f"    [R2-ERR] {key}: {r.stderr[-150:].strip()}")
        return False
    return True

def q(s) -> str:
    """SQL string literal — escape nháy đơn."""
    return "'" + str(s).replace("'", "''") + "'"

def get_title(fp: Path) -> str:
    try:
        for line in open(fp, encoding='utf-8'):
            line = line.strip()
            if line.startswith('# '):
                return line[2:].strip()
            if re.match(r'^chương\s', line, re.I):
                return line
    except Exception:
        pass
    return fp.stem.replace('_VI', '').replace('-', ' ')

def get_num(name: str) -> int:
    m = re.search(r'(\d+)', name)
    return int(m.group(1)) if m else 0

# ─────────────────────────────────────────────────────────────────────────────

def migrate_novel(slug: str, dry_run=False, skip_r2=False):
    novel_dir = NOVELS_DIR / slug
    nj        = novel_dir / "novel.json"
    trans_dir = novel_dir / "translated"

    if not nj.exists():
        print(f"  [skip] {slug}: không có novel.json")
        return

    data = json.load(open(nj, encoding='utf-8'))
    title = data.get('title', slug)
    print(f"\n📚 {title} ({slug})")

    # ── 1. Novel metadata vào D1 (KHÔNG có glossary — lưu riêng R2) ──────
    # Chỉ lưu các field nhỏ để tránh SQLITE_TOOBIG
    novel_sql = (
        f"INSERT INTO novels (slug, title, original_title, author, genre, "
        f"source_url, last_translated_url, last_chapter_number, total_chapters, "
        f"glossary, translation_style, notes, updated_at) VALUES ("
        f"{q(slug)}, {q(title)}, "
        f"{q(data.get('original_title',''))}, "
        f"{q(data.get('author',''))}, "
        f"{q(data.get('genre',''))}, "
        f"{q(data.get('source_url',''))}, "
        f"{q(data.get('last_translated_url',''))}, "
        f"{data.get('last_chapter_number', 0)}, "
        f"{data.get('total_chapters', 0)}, "
        f"'{{}}', "                          # glossary để trống trong D1
        f"{q(data.get('translation_style',''))}, "
        f"{q(str(data.get('notes',''))[:500])}, "   # giới hạn notes 500 chars
        f"{q(datetime.now().isoformat())}"
        f") ON CONFLICT(slug) DO UPDATE SET "
        f"title=excluded.title, "
        f"last_chapter_number=excluded.last_chapter_number, "
        f"total_chapters=excluded.total_chapters, "
        f"updated_at=excluded.updated_at;"
    )
    ok = d1_file(novel_sql, dry_run)
    print(f"  {'✅' if ok else '❌'} Novel metadata → D1")

    # ── 2. Glossary lên R2 (không bị giới hạn size) ──────────────────────
    glossary = data.get('glossary', {})
    if glossary and not skip_r2:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json',
                                         encoding='utf-8', delete=False) as f:
            json.dump(glossary, f, ensure_ascii=False, indent=2)
            gloss_tmp = f.name
        ok_g = r2_put(Path(gloss_tmp), f"{slug}/glossary.json", dry_run)
        os.unlink(gloss_tmp)
        print(f"  {'✅' if ok_g else '❌'} Glossary ({len(glossary)} terms) → R2")

    # ── 3. Chapters ───────────────────────────────────────────────────────
    if not trans_dir.exists():
        print(f"  ⚠️  Không có translated/")
        return

    files = sorted(
        [f for f in trans_dir.iterdir() if f.suffix == '.md'],
        key=lambda f: get_num(f.name)
    )
    total = len(files)
    if total == 0:
        print(f"  ⚠️  Không có chapter nào")
        return

    print(f"  📖 {total} chapters (batch={BATCH_SIZE})...")
    ok_n = fail_n = 0

    for i in range(0, total, BATCH_SIZE):
        batch = files[i : i + BATCH_SIZE]

        # D1: batch INSERT (1 statement mỗi chapter, không concat thành 1 giant SQL)
        sql_lines = []
        for fp in batch:
            fname  = fp.name
            r2key  = f"{slug}/{fname}"
            num    = get_num(fname)
            ctitle = get_title(fp)
            sql_lines.append(
                f"INSERT INTO chapters (novel_slug,filename,title,chapter_number,r2_key) "
                f"VALUES ({q(slug)},{q(fname)},{q(ctitle[:200])},{num},{q(r2key)}) "
                f"ON CONFLICT(novel_slug,filename) DO UPDATE SET "
                f"title=excluded.title, r2_key=excluded.r2_key;"
            )
        batch_sql = "\n".join(sql_lines)
        d1_ok = d1_file(batch_sql, dry_run)

        # R2: upload từng file
        r2_ok_all = True
        if not skip_r2:
            for fp in batch:
                r2key = f"{slug}/{fp.name}"
                if not r2_put(fp, r2key, dry_run):
                    r2_ok_all = False

        if d1_ok and r2_ok_all:
            ok_n += len(batch)
        else:
            fail_n += len(batch)

        end = min(i + BATCH_SIZE, total)
        bar = f"{end}/{total}"
        if fail_n:
            print(f"    → {bar} ❌ {fail_n} lỗi tích lũy")
        elif end % 100 == 0 or end == total:
            print(f"    → {bar} ✅")

    print(f"  {'✅' if fail_n==0 else '⚠️ '} {ok_n}/{total} OK"
          + (f", {fail_n} lỗi" if fail_n else ""))

# ─────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--slug')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-r2', action='store_true',
                    help='Chỉ update D1, không upload R2')
    args = ap.parse_args()

    if args.dry_run:
        print("🔍 DRY RUN\n")

    r = run(f"{WRANGLER} whoami")
    if r.returncode != 0:
        print("[!] Wrangler chưa login.")
        sys.exit(1)
    for line in r.stdout.splitlines():
        if line.strip():
            print(f"✅ {line.strip()}")
            break

    slugs = [args.slug] if args.slug else [
        d.name for d in NOVELS_DIR.iterdir()
        if d.is_dir() and (d / "novel.json").exists()
    ]
    if not args.slug:
        print(f"📦 {len(slugs)} novels: {', '.join(slugs)}\n")

    for slug in slugs:
        migrate_novel(slug, dry_run=args.dry_run, skip_r2=args.skip_r2)

    print("\n🎉 Xong!")
    if not args.dry_run:
        print("👉 npm run deploy")

if __name__ == '__main__':
    main()
