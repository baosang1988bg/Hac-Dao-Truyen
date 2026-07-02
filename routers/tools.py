"""
routers/tools.py
----------------
Endpoint công cụ bảo trì: merge_split_parts (stream), cleanup-split-parts,
run_tool (subprocess allowlist cứng).

LƯU Ý thứ tự đăng ký route: /tools/merge_split_parts phải đứng TRƯỚC
/tools/{tool} để FastAPI match route cụ thể trước route generic.
"""

import os
import asyncio

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse

from auth import require_admin
from security_utils import validate_slug, safe_novel_dir, validate_chapter_title

router = APIRouter()


@router.get("/api/novels/{slug}/tools/merge_split_parts", dependencies=[Depends(require_admin)])
async def tool_merge_split_parts(slug: str):
    """
    Streaming tool: Tìm và merge các chương split (xxx-1_VI.md + xxx-2_VI.md → xxx_VI.md).
    Tự động phát hiện tất cả nhóm cần merge, gộp nội dung và ghi file output. (admin)
    """
    import re as _re

    trans_dir = safe_novel_dir(slug, "translated")
    if not os.path.exists(trans_dir):
        raise HTTPException(status_code=404, detail="Novel not found")

    async def _stream():
        yield f"🔍 Quét thư mục translated/...\n"
        await asyncio.sleep(0.05)

        # os.listdir duy nhất 1 lần cho cả request — tái sử dụng list này
        all_trans = sorted(os.listdir(trans_dir))
        # Tìm tất cả file phần: xxx-N_VI.md
        part_re  = _re.compile(r'^(.+)-(\d+)_VI\.md$')
        groups   = {}  # stem → list of (N, filename)
        for f in all_trans:
            m = part_re.match(f)
            if m:
                stem, n = m.group(1), int(m.group(2))
                groups.setdefault(stem, []).append((n, f))

        if not groups:
            yield "✅ Không có nhóm nào cần merge.\n"
            yield "[Process exited with code 0]\n"
            return

        yield f"📦 Tìm thấy {len(groups)} nhóm cần xem xét:\n"
        merged_count  = 0
        skipped_count = 0

        for stem, parts in sorted(groups.items()):
            parts.sort(key=lambda x: x[0])  # sắp xếp theo N
            out_file = f"{stem}_VI.md"
            out_path = os.path.join(trans_dir, out_file)

            # Đọc nội dung từng phần
            contents = []
            ok = True
            for n, fname in parts:
                fpath = os.path.join(trans_dir, fname)
                try:
                    txt = open(fpath, encoding='utf-8').read().strip()
                    contents.append(txt)
                except Exception as e:
                    yield f"  ❌ Không đọc được {fname}: {e}\n"
                    ok = False
                    break

            if not ok:
                skipped_count += 1
                continue

            # Gộp: loại bỏ tiêu đề `# ...` trùng từ phần 2 trở đi
            merged_lines = []
            for i, txt in enumerate(contents):
                lines = txt.splitlines()
                if i > 0:
                    # Bỏ dòng tiêu đề đầu tiên (# ...) nếu trùng
                    while lines and lines[0].startswith('#'):
                        lines.pop(0)
                    while lines and not lines[0].strip():
                        lines.pop(0)
                merged_lines.append('\n'.join(lines))

            merged = '\n\n'.join(merged_lines)

            # Ghi file output
            try:
                with open(out_path, 'w', encoding='utf-8') as wf:
                    wf.write(merged + '\n')
                part_names = ', '.join(f for _, f in parts)
                yield f"  ✅ Merge: [{part_names}] → {out_file} ({len(merged):,} chars)\n"
                merged_count += 1
            except Exception as e:
                yield f"  ❌ Ghi lỗi {out_file}: {e}\n"
                skipped_count += 1

            await asyncio.sleep(0.01)

        yield f"\n📊 Kết quả: {merged_count} nhóm đã merge, {skipped_count} bỏ qua.\n"
        if merged_count > 0:
            yield f"💡 Gợi ý: Chạy lại tab 'Kiểm tra' để cập nhật trạng thái.\n"
        yield "[Process exited with code 0]\n"

    return StreamingResponse(_stream(), media_type="text/plain; charset=utf-8")


@router.post("/api/novels/{slug}/cleanup-split-parts", dependencies=[Depends(require_admin)])
async def cleanup_split_parts(slug: str):
    """
    Xóa các file phần split (-N.txt raw và -N_VI.md translated) sau khi đã verify
    rằng file gốc merged OK. Chỉ xóa phần khi merged file tồn tại và hợp lệ. (admin)
    """
    import re as _re

    raw_dir   = safe_novel_dir(slug, "text_raw")
    trans_dir = safe_novel_dir(slug, "translated")

    if not os.path.exists(raw_dir):
        raise HTTPException(status_code=404, detail="Novel not found")

    # Mỗi thư mục chỉ listdir 1 lần — tái sử dụng cho toàn bộ vòng lặp bên dưới
    all_trans  = set(os.listdir(trans_dir)) if os.path.exists(trans_dir) else set()
    all_raw    = sorted(os.listdir(raw_dir))
    _part_re   = _re.compile(r'^(.+)-(\d+)\.txt$')

    deleted_raw   = []
    deleted_trans = []
    skipped       = []

    for raw_name in all_raw:
        m = _part_re.match(raw_name)
        if not m:
            continue

        part_stem = os.path.splitext(raw_name)[0]   # "第1033章-1"
        orig_stem = m.group(1)                        # "第1033章"

        # Kiểm tra merged file tồn tại và không lỗi
        _mpat = _re.compile(rf'^{_re.escape(orig_stem)}(?:[^-].*)?_VI\.md$')
        merged_ok = False
        for tf in all_trans:
            if _mpat.match(tf):
                mp = os.path.join(trans_dir, tf)
                if os.path.exists(mp) and os.path.getsize(mp) > 500:
                    try:
                        head = open(mp, encoding='utf-8').read(200)
                        if "[Translation failed" not in head:
                            merged_ok = True
                            break
                    except Exception:
                        pass

        if not merged_ok:
            skipped.append(raw_name)
            continue

        # Xóa raw phần
        rp = os.path.join(raw_dir, raw_name)
        try:
            os.remove(rp)
            deleted_raw.append(raw_name)
        except Exception as e:
            skipped.append(f"{raw_name} (raw error: {e})")

        # Xóa translated phần nếu tồn tại
        trans_part = f"{part_stem}_VI.md"
        if trans_part in all_trans:
            tp = os.path.join(trans_dir, trans_part)
            try:
                os.remove(tp)
                deleted_trans.append(trans_part)
            except Exception as e:
                skipped.append(f"{trans_part} (trans error: {e})")

    return {
        "status": "ok",
        "deleted_raw":   deleted_raw,
        "deleted_trans": deleted_trans,
        "skipped":       skipped,
        "summary": (
            f"Đã xóa {len(deleted_raw)} raw parts, {len(deleted_trans)} translated parts"
            + (f", bỏ qua {len(skipped)} (chưa merge)" if skipped else "")
        ),
    }


@router.get("/api/novels/{slug}/tools/{tool}", dependencies=[Depends(require_admin)])
async def run_tool(slug: str, tool: str, chapter_title: str = ""):
    """Chạy tool bảo trì (subprocess, allowlist cứng). (admin)"""
    validate_slug(slug)
    allowed_tools = {
        "fix_chapters":   ["python3", "tools/fix_chapters.py",   "--novel", slug],
        "fix_truncated":  ["python3", "tools/fix_truncated.py",  "--novel", slug],
        "fix_one":        ["python3", "tools/fix_one_chapter.py","--novel", slug],
        "check_keys":     ["python3", "tools/check_keys.py",     "--show"],
        "fix_titles_v2":  ["python3", "tools/fix_titles_v2.py"],
    }

    if tool not in allowed_tools:
        raise HTTPException(status_code=400, detail="Tool not allowed")

    cmd = allowed_tools[tool]
    if tool == "fix_one":
        if not chapter_title:
            raise HTTPException(status_code=400, detail="chapter_title is required for fix_one tool")
        # validate: chặn argument injection (--force, -x...) và ký tự bất thường
        cmd.extend(["--chapter", validate_chapter_title(chapter_title)])

    async def event_generator():
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT
        )
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            yield line.decode('utf-8')
        await process.wait()
        yield f"\n[Process exited with code {process.returncode}]\n"

    return StreamingResponse(event_generator(), media_type="text/plain")
