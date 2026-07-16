"""
tools/normalize_chapters.py
---------------------------
Chuẩn hóa thư mục translated/ của từng truyện (roadmap 1.3):

  1. PHÂN LOẠI file không phải chương (cảm ngôn, xin nghỉ, tổng kết quyển,
     thông báo...) → chuyển sang novels/<slug>/extras/
  2. PHÁT HIỆN chương trùng số (2 bản dịch cùng chương) → giữ bản mới nhất
     (mtime), bản cũ chuyển sang extras/duplicates/
  3. PHÁT HIỆN file phần split (…-1_VI.md, …-2_VI.md) khi bản merge đã tồn tại
     → chuyển sang extras/split_parts/ (an toàn hơn xóa)
  4. (Tùy chọn --rename) Đổi toàn bộ về convention duy nhất
     "Chương NNNN - Tiêu đề_VI.md". CẢNH BÁO: đổi tên làm lệch r2_key trên
     production — chỉ dùng kèm kế hoạch re-migrate + dọn D1.

Mặc định DRY-RUN (chỉ in, không đụng file). Thêm --apply để thực thi.
Mọi thao tác --apply đều ghi mapping vào novels/<slug>/normalize_log.json
(dạng [{"action","from","to"}]) để hoàn tác được.

Chạy:
  python3 tools/normalize_chapters.py                    # dry-run tất cả truyện
  python3 tools/normalize_chapters.py --slug <slug>      # dry-run 1 truyện
  python3 tools/normalize_chapters.py --slug <slug> --apply
"""

import os
import re
import sys
import json
import shutil
import argparse
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOVELS_DIR = os.path.join(ROOT, "novels")

# Dấu hiệu file KHÔNG phải chương truyện (ghi chú của tác giả).
# Lưu ý: 番外 (ngoại truyện) vẫn là nội dung đọc được — không đưa vào đây.
NON_CHAPTER_PATTERNS = re.compile(
    r"感言|请假|請假|通知|上架|总结|總結|小结|小結|完本|封推|加更说明|"
    r"没写完|写给你的信|一起来写|打赏|月票|推荐票|单章|寫故事終是寫人|写故事终是写人|"
    r"cảm ngôn|xin nghỉ|tổng kết|thông báo|lời tâm sự"
    , re.IGNORECASE,
)

CN_DIGITS = {'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
CN_UNITS = {'十':10,'百':100,'千':1000,'万':10000}


def _cn_to_int(s):
    total, section, num = 0, 0, 0
    for ch in s:
        if ch in CN_DIGITS:
            num = CN_DIGITS[ch]
        elif ch in CN_UNITS:
            u = CN_UNITS[ch]
            if u == 10000:
                total += (section + num) * u
                section, num = 0, 0
            else:
                section += (num if num else 1) * u
                num = 0
        else:
            return None
    return total + section + num


def chapter_num(fname: str):
    """Parse số chương từ tên file — hỗ trợ 'Chương N', '第N章', '第一百章', 'NN_chuong-n'."""
    base = fname[:-3] if fname.endswith(".md") else fname
    m = re.search(r"Chương\s+(\d+)", base, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"第(\d+)章", base)
    if m:
        return int(m.group(1))
    m = re.search(r"第([零一二两三四五六七八九十百千万]+)章", base)  # bắt buộc 章
    if m:
        v = _cn_to_int(m.group(1))
        if v is not None:
            return v
    m = re.search(r"chapter[-_]?(\d+)", base, re.I)
    if m:
        return int(m.group(1))
    m = re.match(r"\s*(\d+)", base)
    if m:
        return int(m.group(1))
    return None


def title_from_file(path: str, fallback: str) -> str:
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh.readlines()[:5]:
                if line.startswith("# "):
                    t = line[2:].strip()
                    t = re.sub(r"^Chương\s+\d+\s*[:：\-–]\s*", "", t, flags=re.I)
                    return t
    except Exception:
        pass
    return fallback


_SPLIT_PART_RE = re.compile(r"^(.+?)\s*-?(\d)_VI\.md$")


def analyze(slug: str):
    """Trả về dict các nhóm hành động cho 1 truyện."""
    trans_dir = os.path.join(NOVELS_DIR, slug, "translated")
    if not os.path.isdir(trans_dir):
        return None
    files = sorted(f for f in os.listdir(trans_dir) if f.endswith(".md"))
    all_set = set(files)

    non_chapters, split_parts, numbered = [], [], []
    for f in files:
        # File có số chương hợp lệ luôn được coi là chương (kể cả khi tiêu đề
        # chứa từ như "thông báo/tổng kết" — tránh false positive). Chỉ file
        # KHÔNG parse được số mới bị xếp vào extras.
        if chapter_num(f) is None:
            non_chapters.append(f)
            continue
        m = _SPLIT_PART_RE.match(f)
        if m and f"{m.group(1)}_VI.md" in all_set:
            split_parts.append(f)  # bản merge đã tồn tại
            continue
        numbered.append((chapter_num(f), f))

    # Trùng số chương → giữ bản mtime mới nhất
    by_num = {}
    dupes = []
    numbered.sort(key=lambda x: (x[0], os.path.getmtime(os.path.join(trans_dir, x[1]))))
    for n, f in numbered:
        if n in by_num:
            dupes.append((n, by_num[n]))  # bản cũ hơn bị thay
        by_num[n] = f

    return {
        "trans_dir": trans_dir,
        "non_chapters": non_chapters,
        "split_parts": split_parts,
        "dupes": dupes,
        "keep": by_num,
    }


def apply_moves(slug: str, plan: dict, do_rename: bool, log: list):
    trans_dir = plan["trans_dir"]
    extras = os.path.join(NOVELS_DIR, slug, "extras")

    def move(f, sub):
        dst_dir = os.path.join(extras, sub) if sub else extras
        os.makedirs(dst_dir, exist_ok=True)
        src, dst = os.path.join(trans_dir, f), os.path.join(dst_dir, f)
        shutil.move(src, dst)
        log.append({"action": f"move:{sub or 'extras'}", "from": src, "to": dst})

    for f in plan["non_chapters"]:
        move(f, "")
    for f in plan["split_parts"]:
        move(f, "split_parts")
    for _, f in plan["dupes"]:
        move(f, "duplicates")

    if do_rename:
        for n, f in sorted(plan["keep"].items()):
            src = os.path.join(trans_dir, f)
            title = title_from_file(src, os.path.splitext(f)[0])
            safe = re.sub(r'[\\/*?:"<>|]', "", title)[:80].strip() or f"chuong-{n}"
            new = f"Chương {n:04d} - {safe}_VI.md"
            if new != f:
                dst = os.path.join(trans_dir, new)
                if os.path.exists(dst):
                    continue  # không ghi đè
                shutil.move(src, dst)
                log.append({"action": "rename", "from": src, "to": dst})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", help="chỉ xử lý 1 truyện")
    ap.add_argument("--apply", action="store_true", help="thực thi (mặc định dry-run)")
    ap.add_argument("--rename", action="store_true",
                    help="đổi tên về convention 'Chương NNNN - Tiêu đề_VI.md' "
                         "(CẢNH BÁO: cần re-migrate Cloudflare sau đó)")
    args = ap.parse_args()

    slugs = [args.slug] if args.slug else sorted(
        d for d in os.listdir(NOVELS_DIR)
        if os.path.isdir(os.path.join(NOVELS_DIR, d, "translated"))
    )

    grand = {"non": 0, "split": 0, "dupes": 0}
    for slug in slugs:
        plan = analyze(slug)
        if not plan:
            continue
        n_non, n_split, n_dup = len(plan["non_chapters"]), len(plan["split_parts"]), len(plan["dupes"])
        if not (n_non or n_split or n_dup or args.rename):
            print(f"✅ {slug}: sạch ({len(plan['keep'])} chương)")
            continue
        print(f"\n📚 {slug} — {len(plan['keep'])} chương giữ lại")
        if n_non:
            print(f"  → extras/           : {n_non} file không phải chương")
            for f in plan["non_chapters"][:5]:
                print(f"      - {f}")
            if n_non > 5:
                print(f"      ... và {n_non-5} file nữa")
        if n_split:
            print(f"  → extras/split_parts: {n_split} file phần split (đã có bản merge)")
        if n_dup:
            print(f"  → extras/duplicates : {n_dup} bản dịch cũ bị trùng số chương")
            for n, f in plan["dupes"][:5]:
                print(f"      - chương {n}: {f}")
        grand["non"] += n_non; grand["split"] += n_split; grand["dupes"] += n_dup

        if args.apply:
            log = []
            apply_moves(slug, plan, args.rename, log)
            log_path = os.path.join(NOVELS_DIR, slug, "normalize_log.json")
            existing = []
            if os.path.exists(log_path):
                existing = json.load(open(log_path, encoding="utf-8"))
            existing.append({"ts": datetime.now().isoformat(), "ops": log})
            json.dump(existing, open(log_path, "w", encoding="utf-8"),
                      ensure_ascii=False, indent=1)
            print(f"  ✅ Đã áp dụng {len(log)} thao tác (log: novels/{slug}/normalize_log.json)")

    mode = "APPLY" if args.apply else "DRY-RUN (thêm --apply để thực thi)"
    print(f"\n[{mode}] Tổng: {grand['non']} extras, {grand['split']} split, {grand['dupes']} trùng.")
    if not args.apply and (grand["non"] or grand["split"] or grand["dupes"]):
        print("Lưu ý: file chỉ bị DI CHUYỂN sang extras/, không xóa. "
              "Sau khi apply nên chạy migrate_to_cloudflare.py cho truyện bị đổi.")


if __name__ == "__main__":
    main()
