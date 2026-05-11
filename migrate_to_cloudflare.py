#!/usr/bin/env python3
"""
migrate_to_cloudflare.py — v5
==============================
Sync novels/ lên Cloudflare D1 + R2.

Fix v5:
- chapter_number lấy từ title (không phải filename)
- Bỏ split parts (-N_VI.md) nếu đã có merged version
- Filename tiếng Trung không có 第N章 → author note (num=0)
- R2 key = base64(filename) — không collision

Cách dùng:
  python migrate_to_cloudflare.py --slug xich-tam-tuan-thien --limit 20
  python migrate_to_cloudflare.py --slug xich-tam-tuan-thien
  python migrate_to_cloudflare.py --slug xich-tam-tuan-thien --skip-r2
"""

import os, re, json, subprocess, argparse, sys, tempfile, base64
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

NOVELS_DIR  = Path("novels")
D1_DB_NAME  = "hacdao-db"
R2_BUCKET   = "hacdao-chapters"
BATCH_SIZE  = 10
SYNC_STATE  = Path(".sync_state.json")   # lưu trạng thái sync mỗi novel

# ── Sync State ────────────────────────────────────────────────────────────────

def load_sync_state() -> dict:
    """Đọc file .sync_state.json — trả về {} nếu chưa có."""
    if SYNC_STATE.exists():
        try:
            return json.loads(SYNC_STATE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {}

def save_sync_state(state: dict):
    """Ghi state vào .sync_state.json."""
    SYNC_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding='utf-8')

def get_novel_sync_info(slug: str) -> dict:
    """Lấy thông tin sync của 1 novel. Trả về dict rỗng nếu chưa sync lần nào."""
    return load_sync_state().get(slug, {})

def get_synced_filenames(slug: str) -> set:
    """Query D1 để lấy danh sách filenames đã có — dùng để detect author notes mới."""
    sql = f"SELECT filename FROM chapters WHERE novel_slug='{slug}';"
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', encoding='utf-8', delete=False) as f:
        f.write(sql)
        tmp = f.name
    try:
        r = run_safe([get_wrangler(), 'd1', 'execute', D1_DB_NAME, '--remote',
                      f'--file={tmp}', '--json'])
        if r.returncode != 0:
            print(f"    [D1-query-ERR] {r.stderr[-200:].strip()}")
            return None

        # Wrangler có thể in warning/log lines trước JSON thật
        # Scan từng dòng, tìm dòng bắt đầu bằng '[' và parse được
        stdout = r.stdout.strip()
        data = None
        for i, line in enumerate(stdout.splitlines()):
            line = line.strip()
            if line.startswith('['):
                try:
                    data = json.loads('\n'.join(stdout.splitlines()[i:]))
                    break
                except json.JSONDecodeError:
                    continue

        if not data:
            print(f"    [D1-query-ERR] Không có data. stdout: {stdout[:300]}")
            return None

        rows = data[0].get('results', []) if data else []
        return {row['filename'] for row in rows if 'filename' in row}

    except json.JSONDecodeError as e:
        print(f"    [D1-query-ERR] JSON parse: {e}")
        return None
    except Exception as e:
        print(f"    [D1-query-ERR] {e}")
        return None
    finally:
        os.unlink(tmp)

def update_novel_sync(slug: str, last_chapter: int, last_filename: str, total_synced: int):
    """Cập nhật trạng thái sync sau khi hoàn tất."""
    state = load_sync_state()
    state[slug] = {
        "last_synced_at":      datetime.now().isoformat(),
        "last_chapter_number": last_chapter,
        "last_filename":       last_filename,
        "total_synced":        total_synced,
    }
    save_sync_state(state)
    print(f"  💾 Sync state saved → last chapter: {last_chapter}, total: {total_synced}")

# ── Wrangler ──────────────────────────────────────────────────────────────────

def get_wrangler():
    ext = '.cmd' if os.name == 'nt' else ''
    local = os.path.join(os.getcwd(), 'node_modules', '.bin', f'wrangler{ext}')
    if os.path.exists(local):
        return [local]
    return [f'npx{ext}', 'wrangler']

def run_safe(args: list) -> subprocess.CompletedProcess:
    if isinstance(args[0], list):
        args = args[0] + args[1:]
    return subprocess.run(args, capture_output=True, text=True, encoding='utf-8')

def d1_file(sql: str, dry_run=False) -> bool:
    if dry_run:
        print(f"    [DRY-D1] {sql[:60].strip()}...")
        return True
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', encoding='utf-8', delete=False) as f:
        f.write(sql + "\n")
        tmp = f.name
    try:
        r = run_safe([get_wrangler(), 'd1', 'execute', D1_DB_NAME, '--remote', f'--file={tmp}'])
        if r.returncode != 0:
            for line in r.stderr.splitlines():
                if 'WARNING' not in line and line.strip():
                    print(f"    [D1-ERR] {line.strip()}")
            return False
        return True
    finally:
        os.unlink(tmp)

def r2_exists(key: str) -> bool:
    """Kiểm tra file đã có trong R2 chưa — dùng để skip khi resume."""
    r = run_safe([get_wrangler(), 'r2', 'object', 'get',
                  f"{R2_BUCKET}/{key}", '--file=/dev/null', '--remote'])
    return r.returncode == 0

def r2_put(local: Path, key: str, dry_run=False) -> bool:
    if dry_run:
        return True
    r = run_safe([get_wrangler(), 'r2', 'object', 'put',
                  f"{R2_BUCKET}/{key}", f"--file={local}", '--remote'])
    if r.returncode != 0:
        print(f"    [R2-ERR] {key[:60]}: {r.stderr[-120:].strip()}")
        return False
    return True

# ── Helpers ───────────────────────────────────────────────────────────────────

def filename_to_r2key(slug: str, filename: str) -> str:
    """base64 url-safe encode filename — tránh ký tự đặc biệt trong R2 key."""
    encoded = base64.urlsafe_b64encode(filename.encode('utf-8')).decode('ascii')
    return f"{slug}/b64_{encoded}"

def q(s) -> str:
    return "'" + str(s).replace("'", "''") + "'"

def get_title(fp: Path) -> str:
    try:
        with open(fp, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line.startswith('# '):
                    return line[2:].strip()
                if re.match(r'^chương\s', line, re.I):
                    return line
    except Exception:
        pass
    return fp.stem.replace('_VI', '').replace('-', ' ')

def get_chapter_number(title: str, filename: str) -> int:
    """
    Extract chapter number — số frontend dùng để navigate.

    Ưu tiên:
    1. Filename bắt đầu bằng 第N章 → lấy N (chapter thật, tiếng Trung)
    2. Filename bắt đầu bằng số (01_, 02_) + title có 'Chương N' → lấy N
    3. Title có 'Chương N' và filename KHÔNG phải tiếng Trung thuần → lấy N
    4. Còn lại (author notes, lời tác giả) → 0
    """
    # Case 1: 第N章... — chapter thật
    m = re.match(r'^第(\d+)章', filename)
    if m:
        return int(m.group(1))

    # Case 2: 01_chuong-1_... — numbered Vietnamese filename
    m = re.match(r'^(\d+)_', filename)
    if m:
        mt = re.search(r'[Cc]hương\s*(\d+)', title)
        if mt:
            return int(mt.group(1))

    # Case 3: title có số chương, filename không phải tiếng Trung thuần
    mt = re.search(r'(?:第(\d+)章|[Cc]hapter\s*(\d+)|[Cc]hương\s*(\d+))', title)
    if mt:
        # Filename bắt đầu bằng tiếng Trung (không phải 第N章) → author note split
        if re.match(r'^[一-鿿㐀-䶿]', filename):
            return 0
        return int(mt.group(1) or mt.group(2) or mt.group(3))

    return 0

def is_split_part(filename: str) -> bool:
    """File dạng xxx-N_VI.md (split part)."""
    return bool(re.search(r'-\d+_VI\.md$', filename))

def has_merged_version(filename: str, all_names: set) -> bool:
    """Kiểm tra xem split part đã có merged version chưa."""
    merged = re.sub(r'-\d+(_VI\.md)$', r'\1', filename)
    return merged != filename and merged in all_names

def get_effective_files(trans_dir: Path) -> list:
    """
    Lấy danh sách files hợp lệ:
    - Loại bỏ split parts (-N_VI.md) nếu đã có merged version
    - Sort theo chapter_number rồi theo filename
    """
    all_files = [f for f in trans_dir.iterdir() if f.suffix == '.md']
    all_names = {f.name for f in all_files}

    effective = [
        f for f in all_files
        if not (is_split_part(f.name) and has_merged_version(f.name, all_names))
    ]

    # Sort: chapter thật (num>0) trước, author notes (num=0) sau, trong cùng nhóm sort theo filename
    def sort_key(fp):
        title = get_title(fp)
        num = get_chapter_number(title, fp.name)
        return (0 if num > 0 else 1, num, fp.name)

    return sorted(effective, key=sort_key)

# ── Migration ─────────────────────────────────────────────────────────────────

def migrate_novel(slug: str, dry_run=False, skip_r2=False, skip_d1=False, limit=None, resume=False, from_chapter=None, extra_files=None):
    novel_dir = NOVELS_DIR / slug
    nj        = novel_dir / "novel.json"
    trans_dir = novel_dir / "translated"

    if not nj.exists():
        print(f"  [skip] {slug}: không có novel.json")
        return

    data  = json.load(open(nj, encoding='utf-8'))
    title = data.get('title', slug)
    print(f"\n📚 {title} ({slug})")

    # ── 1. Novel metadata → D1 ──────────────────────────────────────────
    novel_sql = (
        f"INSERT INTO novels (slug,title,original_title,author,genre,"
        f"source_url,last_translated_url,last_chapter_number,total_chapters,"
        f"glossary,translation_style,notes,updated_at) VALUES ("
        f"{q(slug)},{q(title)},"
        f"{q(data.get('original_title',''))},"
        f"{q(data.get('author',''))},"
        f"{q(data.get('genre',''))},"
        f"{q(data.get('source_url',''))},"
        f"{q(data.get('last_translated_url',''))},"
        f"{data.get('last_chapter_number',0)},"
        f"{data.get('total_chapters',0)},"
        f"'{{}}',{q(data.get('translation_style',''))},"
        f"{q(str(data.get('notes',''))[:400])},"
        f"{q(datetime.now().isoformat())}"
        f") ON CONFLICT(slug) DO UPDATE SET "
        f"title=excluded.title,last_chapter_number=excluded.last_chapter_number,"
        f"total_chapters=excluded.total_chapters,updated_at=excluded.updated_at;"
    )
    if not skip_d1:
        ok = d1_file(novel_sql, dry_run)
        print(f"  {'✅' if ok else '❌'} Novel metadata → D1")
    else:
        print(f"  [skip-d1] Novel metadata")

    # ── 2. Glossary → R2 ────────────────────────────────────────────────
    glossary = data.get('glossary', {})
    if glossary and not skip_r2:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json',
                                         encoding='utf-8', delete=False) as f:
            json.dump(glossary, f, ensure_ascii=False, indent=2)
            gloss_tmp = f.name
        ok_g = r2_put(Path(gloss_tmp), f"{slug}/glossary.json", dry_run)
        os.unlink(gloss_tmp)
        print(f"  {'✅' if ok_g else '❌'} Glossary ({len(glossary)} terms) → R2")

    # ── 3. Chapters ──────────────────────────────────────────────────────
    if not trans_dir.exists():
        print(f"  ⚠️  Không có translated/")
        return

    files = get_effective_files(trans_dir)

    # --from-chapter N: chapters từ N trở đi + extra_files (author notes mới từ smart-sync)
    if from_chapter is not None:
        new_chapters = [f for f in files
                        if get_chapter_number(get_title(f), f.name) >= from_chapter]
        new_notes    = extra_files or []
        files        = new_notes + new_chapters
        if new_notes:
            print(f"  📝 {len(new_notes)} author note(s) mới sẽ được sync")

    if limit:
        files = files[:limit]
    total = len(files)
    if total == 0:
        print(f"  ⚠️  Không có chapter nào")
        return

    story = sum(1 for f in files if get_chapter_number(get_title(f), f.name) > 0)
    notes = total - story
    resume_str = " [resume mode — skip existing]" if resume else ""
    print(f"  📖 {total} files ({story} chapters + {notes} author notes){resume_str}")

    ok_n = skip_n = fail_n = 0

    for i in range(0, total, BATCH_SIZE):
        batch = files[i : i + BATCH_SIZE]
        sql_lines = []
        r2_batch  = []  # files cần upload R2 trong batch này

        for fp in batch:
            fname  = fp.name
            r2key  = filename_to_r2key(slug, fname)
            ctitle = get_title(fp)
            num    = get_chapter_number(ctitle, fname)

            # Resume mode: skip nếu R2 đã có file này
            if resume and not skip_r2 and r2_exists(r2key):
                skip_n += 1
                continue

            sql_lines.append(
                f"INSERT INTO chapters (novel_slug,filename,title,chapter_number,r2_key) "
                f"VALUES ({q(slug)},{q(fname)},{q(ctitle[:200])},{num},{q(r2key)}) "
                f"ON CONFLICT(novel_slug,filename) DO UPDATE SET "
                f"title=excluded.title,r2_key=excluded.r2_key,chapter_number=excluded.chapter_number;"
            )
            r2_batch.append((fp, r2key))

        # Nếu toàn bộ batch đã có trong R2 → skip D1 luôn
        if not sql_lines:
            end = min(i + BATCH_SIZE, total)
            if end % 200 == 0 or end == total:
                print(f"    → {end}/{total} ⏭ {skip_n} skipped")
            continue

        d1_ok = True if skip_d1 else d1_file("\n".join(sql_lines), dry_run)

        r2_ok_all = True
        if not skip_r2:
            for fp, r2key in r2_batch:
                if not r2_put(fp, r2key, dry_run):
                    r2_ok_all = False

        if d1_ok and r2_ok_all:
            ok_n += len(r2_batch)
        else:
            fail_n += len(r2_batch)

        end = min(i + BATCH_SIZE, total)
        if end % 100 == 0 or end == total or fail_n > 0:
            parts = [f"{end}/{total}"]
            if skip_n:  parts.append(f"⏭ {skip_n} skipped")
            if fail_n:  parts.append(f"❌ {fail_n} lỗi")
            else:       parts.append("✅")
            print(f"    → {' '.join(parts)}")

    summary = f"{ok_n} uploaded"
    if skip_n:  summary += f", {skip_n} skipped (already existed)"
    if fail_n:  summary += f", {fail_n} lỗi"
    print(f"  {'✅' if fail_n==0 else '⚠️ '} {summary}")

    # ── Lưu sync state tự động sau mỗi lần chạy thành công ───────────────
    if not dry_run and ok_n > 0:
        # Tìm chapter number lớn nhất trong batch vừa sync
        synced_files = [f for f in files if not (
            resume and r2_exists(filename_to_r2key(slug, f.name))
        )] if resume else files

        max_chapter = max(
            (get_chapter_number(get_title(f), f.name) for f in files),
            default=0
        )
        last_file = files[-1].name if files else ""

        # Đếm tổng chapters đã sync (lấy từ state cũ + mới upload)
        prev_state   = get_novel_sync_info(slug)
        prev_total   = prev_state.get("total_synced", 0)
        total_synced = max(prev_total, prev_total + ok_n)

        update_novel_sync(slug, max_chapter, last_file, total_synced)

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--slug')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--skip-r2', action='store_true', help='Bỏ qua upload R2, chỉ update D1')
    ap.add_argument('--skip-d1', action='store_true', help='Bỏ qua D1, chỉ upload R2')
    ap.add_argument('--resume', action='store_true',
                    help='Bỏ qua file đã có trong R2, chỉ upload phần còn thiếu')
    ap.add_argument('--from-chapter', type=int, dest='from_chapter',
                    help='Chỉ sync chapters từ số N trở đi (nhanh, không check R2)')
    ap.add_argument('--smart-sync', action='store_true', dest='smart_sync',
                    help='Tự động đọc sync state, chỉ upload chapters mới hơn lần sync trước')
    ap.add_argument('--status', action='store_true',
                    help='Xem trạng thái sync hiện tại của tất cả novels')
    ap.add_argument('--set-synced', action='store_true', dest='set_synced',
                    help='Đánh dấu toàn bộ local files là đã synced (dùng khi đã sync thủ công trước đó)')
    ap.add_argument('--limit', type=int, help='Giới hạn số file (để test)')
    args = ap.parse_args()

    if args.dry_run:
        print("🔍 DRY RUN\n")

    # --set-synced: cập nhật state từ local files, không upload gì
    if args.set_synced:
        slugs = [args.slug] if args.slug else [
            d.name for d in NOVELS_DIR.iterdir()
            if d.is_dir() and (d / "novel.json").exists()
        ]
        for slug in slugs:
            trans_dir = NOVELS_DIR / slug / "translated"
            if not trans_dir.exists():
                print(f"  [skip] {slug}: không có translated/")
                continue
            files = get_effective_files(trans_dir)
            max_chap  = max((get_chapter_number(get_title(f), f.name) for f in files), default=0)
            last_file = files[-1].name if files else ""
            update_novel_sync(slug, max_chap, last_file, len(files))
            print(f"  ✅ {slug}: marked {len(files)} files synced, last chapter {max_chap}")
        return

    # --status: chỉ xem state, không làm gì
    if args.status:
        state = load_sync_state()
        if not state:
            print("Chưa có sync state nào. Chạy migrate lần đầu trước.")
            return
        print("📊 Sync State:\n")
        for slug, info in state.items():
            # Đếm total files local hiện tại
            trans_dir = NOVELS_DIR / slug / "translated"
            local_total = len([f for f in trans_dir.iterdir() if f.suffix == '.md']) if trans_dir.exists() else 0
            local_effective = len(get_effective_files(trans_dir)) if trans_dir.exists() else 0
            new_count = local_effective - info.get('total_synced', 0)
            print(f"  📚 {slug}")
            print(f"     Last sync   : {info.get('last_synced_at','?')[:19]}")
            print(f"     Last chapter: {info.get('last_chapter_number','?')}")
            print(f"     Synced      : {info.get('total_synced','?')} files")
            print(f"     Local now   : {local_effective} files (raw: {local_total})")
            if new_count > 0:
                print(f"     ⚠️  Chưa sync: ~{new_count} files mới")
            else:
                print(f"     ✅ Đã sync đầy đủ")
            print()
        return

    r = run_safe([get_wrangler(), 'whoami'])
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
        from_chapter   = args.from_chapter
        extra_files    = []   # author notes mới cần sync thêm

        # --smart-sync: tự đọc state + query D1 để detect mọi file mới
        if args.smart_sync and from_chapter is None:
            info = get_novel_sync_info(slug)
            if info:
                last_chap = info.get('last_chapter_number', 0)
                last_sync = info.get('last_synced_at', '?')[:19]
                from_chapter = last_chap + 1
                print(f"  🔄 Smart sync: last sync {last_sync}, chapter {last_chap} → chapters từ {from_chapter}")

                # Detect author notes mới: query D1 lấy filenames đã có,
                # so sánh với local để tìm files num=0 chưa được sync
                print(f"  🔍 Kiểm tra author notes mới...")
                synced_names = get_synced_filenames(slug)
                if synced_names is not None:
                    trans_dir = NOVELS_DIR / slug / "translated"
                    all_local = get_effective_files(trans_dir)
                    # Author notes local chưa có trong D1
                    extra_files = [
                        f for f in all_local
                        if get_chapter_number(get_title(f), f.name) == 0
                        and f.name not in synced_names
                    ]
                    if extra_files:
                        print(f"  📝 Phát hiện {len(extra_files)} author note(s) mới: "
                              + ", ".join(f.name[:40] for f in extra_files))
                    else:
                        print(f"  ✅ Không có author note mới")
                else:
                    print(f"  ⚠️  Không query được D1, bỏ qua check author notes")
            else:
                print(f"  ℹ️  Chưa có sync state cho {slug}, sync toàn bộ")

        migrate_novel(slug, dry_run=args.dry_run, skip_r2=args.skip_r2,
                      skip_d1=args.skip_d1, limit=args.limit, resume=args.resume,
                      from_chapter=from_chapter, extra_files=extra_files)

    print("\n🎉 Xong!")
    if not args.dry_run:
        print("👉 npm run deploy")

if __name__ == '__main__':
    main()
