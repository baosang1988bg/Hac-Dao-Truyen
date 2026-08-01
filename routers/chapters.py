"""
routers/chapters.py
-------------------
Endpoint chương: danh sách chương đã dịch, nội dung chương, health check.
Kèm các helper nhận diện file split đã merge (_find_merged_vi...).
"""

import os
import re

from fastapi import APIRouter, HTTPException

from security_utils import safe_novel_dir, safe_join
from chapter_utils import extract_chapter_number_from_text

router = APIRouter()


@router.get("/api/novels/{slug}/chapters")
def list_chapters(slug: str):
    """Lấy danh sách các chương đã dịch.

    Lọc bỏ các file phần split (xxx-N_VI.md) nếu file gốc đã được merge
    (xxx_VI.md tồn tại) — tránh hiển thị trùng lặp trên UI.
    """
    translated_dir = safe_novel_dir(slug, "translated")
    if not os.path.exists(translated_dir):
        return []

    all_files = set(f for f in os.listdir(translated_dir) if f.endswith(".md"))

    # Pattern nhận diện file phần split: xxx-N_VI.md (N là số nguyên)
    _split_part_re = re.compile(r'^(.+)-(\d+)_VI\.md$')

    filtered = []
    for f in all_files:
        m = _split_part_re.match(f)
        if m:
            # File này là phần split (xxx-N_VI.md)
            # Chỉ giữ nếu file gốc (xxx_VI.md) CHƯA tồn tại (merge chưa xong)
            orig_file = f"{m.group(1)}_VI.md"
            if orig_file in all_files:
                continue  # Gốc đã merge → bỏ qua phần này
        filtered.append(f)

    def get_chapter_num(filename):
        return extract_chapter_number_from_text(filename)

    # Khử trùng lặp khi 2 quy ước đặt tên khác nhau cùng tồn tại cho 1 số chương
    # (vd: "chapter-1431txt_VI.md" kiểu cũ và "1431_ten-chuong_VI.md" kiểu mới
    # từ epub_to_chapters.py) — nếu không khử, danh sách chương sẽ có 2 dòng
    # cùng số thứ tự, làm lệch pha giữa index trong danh sách và nội dung thật
    # sự được trả về ở get_chapter_content() (khiến nút "chương tiếp theo" bị
    # lặp lại chương hiện tại thay vì sang chương kế). Duyệt theo thứ tự alphabet
    # trước rồi chỉ giữ file ĐẦU TIÊN gặp cho mỗi số chương — khớp đúng quy tắc
    # chọn file của get_chapter_content() bên dưới (cũng duyệt sorted(all_files)
    # và trả về file khớp đầu tiên), đảm bảo 2 endpoint luôn đồng nhất.
    first_file_by_num: dict[int, str] = {}
    for f in sorted(filtered):
        n = get_chapter_num(f)
        if n not in first_file_by_num:
            first_file_by_num[n] = f

    sorted_files = sorted(first_file_by_num.values(), key=get_chapter_num)
    result = []
    for f in sorted_files:
        filepath = os.path.join(translated_dir, f)
        title = f.replace('_VI.md', '').replace('.txt', '')
        try:
            with open(filepath, 'r', encoding='utf-8') as file:
                lines = file.readlines()
                for line in lines[:10]:
                    line = line.strip()
                    if line.startswith('# '):
                        title = line[2:]
                        break
                    elif line.lower().startswith('chương '):
                        title = line
                        break
        except Exception:
            pass
        result.append({"filename": f, "title": title})
    return result


@router.get("/api/novels/{slug}/chapters/{identifier}")
def get_chapter_content(slug: str, identifier: str):
    """Lấy nội dung Markdown của chương.
    identifier: filename đầy đủ HOẶC số chương (ví dụ: '1497')
    """
    translated_dir = safe_novel_dir(slug, "translated")
    if not os.path.exists(translated_dir):
        raise HTTPException(status_code=404, detail="Novel not found")

    # Thử trực tiếp theo filename trước (safe_join chặn ../ và đường dẫn tuyệt đối)
    filepath = safe_join(translated_dir, identifier)
    if identifier.endswith(".md") and os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            return {"content": f.read()}

    # Nếu identifier là số → tìm file có chapter number khớp
    if identifier.isdigit():
        chap_num = int(identifier)
        all_files = [f for f in os.listdir(translated_dir) if f.endswith(".md")]
        for fname in sorted(all_files):
            if extract_chapter_number_from_text(fname) == chap_num:
                fpath = os.path.join(translated_dir, fname)
                with open(fpath, "r", encoding="utf-8") as f:
                    return {"content": f.read()}

    raise HTTPException(status_code=404, detail=f"Chapter not found: {identifier}")


def _find_merged_vi(stem: str, all_trans: set) -> str | None:
    """
    Tìm file merged _VI.md cho một stem (có thể là gốc hoặc phần).
    Chiến lược tìm kiếm theo thứ tự ưu tiên:
    1. Exact: stem_VI.md
    2. Prefix match bằng chapter number: 第N章... (xử lý safe_filename diff)
    3. Prefix match trực tiếp: stem bắt đầu bằng orig_stem
    """
    import re as _re2

    # Lấy orig_stem nếu là file phần (xxx-N → xxx)
    pm = _re2.match(r'^(.+)-(\d+)$', stem)
    orig_stem = pm.group(1) if pm else stem

    # 1. Exact match
    exact = f"{orig_stem}_VI.md"
    if exact in all_trans:
        return exact

    # 2. Chapter number prefix: tìm 第N章 ở đầu
    chap_m = _re2.match(r'^(第\d+章)', orig_stem)
    if chap_m:
        chap_prefix = chap_m.group(1)
        _cpat = _re2.compile(rf'^{_re2.escape(chap_prefix)}.*_VI\.md$')
        # Loại bỏ file phần (-N_VI.md)
        _no_part = _re2.compile(r'-\d+_VI\.md$')
        for f in all_trans:
            if _cpat.match(f) and not _no_part.search(f):
                return f

    # 3. Prefix match trực tiếp (tên không có 第N章)
    _ppat = _re2.compile(rf'^{_re2.escape(orig_stem)}(?:[^-].*)?_VI\.md$')
    for f in all_trans:
        if _ppat.match(f):
            return f

    return None


def _is_split_part_merged(stem: str, trans_dir: str, all_trans: set) -> bool:
    """Kiểm tra file phần split đã có file gốc merge chưa."""
    return _find_merged_vi(stem, all_trans) is not None


@router.get("/api/novels/{slug}/health")
def health_check(slug: str):
    """
    So sánh text_raw/ và translated/ để tìm:
    - Chương trong raw nhưng chưa có bản dịch (missing)
    - Chương đã dịch nhưng chứa '[Translation failed' (failed)
    - Chương đã dịch quá ngắn bất thường so với raw (suspicious)

    Nhận biết split chapters:
    - File gốc đã split (xxx.txt khi có xxx-1.txt) → kiểm tra merged file
    - File phần (xxx-N.txt) → bỏ qua nếu gốc đã merge OK (không count vào total_raw)
    - Phần chưa merge → hiển thị riêng với type "split_pending"
    """
    import re as _re

    raw_dir   = safe_novel_dir(slug, "text_raw")
    trans_dir = safe_novel_dir(slug, "translated")

    if not os.path.exists(raw_dir):
        raise HTTPException(status_code=404, detail="text_raw directory not found")

    # Chỉ os.listdir MỖI thư mục 1 lần cho cả request — các kiểm tra tồn tại
    # bên dưới tái sử dụng set này thay vì gọi os.path.exists/listdir lại.
    all_raw_files = sorted(f for f in os.listdir(raw_dir) if f.endswith(".txt"))
    all_raw_set   = set(all_raw_files)
    all_trans     = set(os.listdir(trans_dir)) if os.path.exists(trans_dir) else set()

    _part_re = _re.compile(r'^(.+)-(\d+)$')

    issues = []
    total_translated = 0
    total_raw_effective = 0   # chỉ đếm file gốc (không đếm file phần đã merge)
    split_parts_ok    = 0     # file phần đã có gốc merge → ẩn khỏi count

    for raw_name in all_raw_files:
        stem     = os.path.splitext(raw_name)[0]
        raw_path = os.path.join(raw_dir, raw_name)

        # ── File gốc đã split (có xxx-1.txt đi kèm) ────────────────────
        has_part1 = f"{stem}-1.txt" in all_raw_set
        if has_part1:
            total_raw_effective += 1
            # Tìm merged file bằng _find_merged_vi (hỗ trợ safe_filename diff)
            merged_name = _find_merged_vi(stem, all_trans)
            if merged_name:
                merged_path = os.path.join(trans_dir, merged_name)
                try:
                    head = open(merged_path, encoding='utf-8').read(300)
                    if "[Translation failed" in head:
                        issues.append({"filename": raw_name, "type": "failed",
                                        "detail": "Merged file có lỗi dịch"})
                    else:
                        total_translated += 1
                except Exception:
                    issues.append({"filename": raw_name, "type": "failed",
                                    "detail": "Không đọc được merged file"})
            else:
                # Kiểm tra các phần đã dịch chưa
                part_count = sum(1 for i in range(1, 20)
                                 if f"{stem}-{i}.txt" in all_raw_set)
                parts_done = sum(1 for i in range(1, part_count + 1)
                                 if any(f.startswith(f"{stem}-{i}") and f.endswith("_VI.md")
                                        for f in all_trans))
                if parts_done == part_count and part_count > 0:
                    issues.append({"filename": raw_name, "type": "split_pending",
                                    "detail": f"Đã dịch {parts_done} phần nhưng chưa merge thành 1 file"})
                else:
                    issues.append({"filename": raw_name, "type": "missing",
                                    "detail": f"Chưa có bản dịch ({parts_done}/{part_count} phần xong)"})
            continue

        # ── File phần split (xxx-N.txt) ──────────────────────────────────
        pm = _part_re.match(stem)
        if pm:
            # Kiểm tra gốc đã merge chưa
            if _is_split_part_merged(stem, trans_dir, all_trans):
                split_parts_ok += 1
                # Không count vào total_raw_effective
            else:
                # Phần chưa merge gốc → count như chương thường
                total_raw_effective += 1
                out_name = f"{stem}_VI.md"
                out_path = os.path.join(trans_dir, out_name)
                # Kiểm tra membership trong all_trans trước (đã listdir sẵn ở trên)
                # → tránh stat syscall cho đa số trường hợp missing
                if out_name not in all_trans or not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
                    issues.append({"filename": raw_name, "type": "missing",
                                    "detail": "Phần split chưa có bản dịch"})
                else:
                    total_translated += 1
            continue

        # ── File thường ───────────────────────────────────────────────────
        total_raw_effective += 1
        # Dùng _find_merged_vi để fuzzy-match tên file dịch
        # (xử lý trường hợp tên có ký tự đặc biệt bị strip khi lưu)
        matched_name = _find_merged_vi(stem, all_trans)
        if matched_name:
            out_path = os.path.join(trans_dir, matched_name)
        else:
            out_path = os.path.join(trans_dir, f"{stem}_VI.md")

        # matched_name đến từ all_trans (listdir 1 lần) — exists() chỉ là guard phụ
        if not matched_name or not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
            issues.append({"filename": raw_name, "type": "missing",
                            "detail": "Chưa có bản dịch"})
            continue

        total_translated += 1

        try:
            with open(out_path, "r", encoding="utf-8") as f:
                head = f.read(300)
                f.seek(0)
                full_trans = f.read()
        except Exception:
            issues.append({"filename": raw_name, "type": "failed",
                            "detail": "Không đọc được file dịch"})
            continue

        if "[Translation failed" in head:
            err_line = next(
                (l.strip() for l in head.splitlines() if "[Translation failed" in l),
                "Translation failed"
            )
            issues.append({"filename": raw_name, "type": "failed", "detail": err_line[:120]})
            continue

        try:
            raw_chars   = os.path.getsize(raw_path)
            trans_chars = len(full_trans.strip())
            if raw_chars > 100:
                ratio = trans_chars / raw_chars
                if ratio < 0.8:
                    issues.append({
                        "filename": raw_name, "type": "suspicious",
                        "detail": f"Bản dịch quá ngắn (tỷ lệ: {ratio:.2f}×, kỳ vọng ≥ 1.3×)",
                    })
        except Exception:
            pass

    missing_count  = sum(1 for i in issues if i["type"] == "missing")
    failed_count   = sum(1 for i in issues if i["type"] == "failed")
    suspect_count  = sum(1 for i in issues if i["type"] == "suspicious")
    pending_count  = sum(1 for i in issues if i["type"] == "split_pending")

    return {
        "summary": {
            "total_raw":        total_raw_effective,
            "total_raw_all":    len(all_raw_files),     # bao gồm cả file phần
            "split_parts_ok":   split_parts_ok,          # file phần đã có merge
            "total_translated": total_translated,
            "missing":          missing_count,
            "failed":           failed_count,
            "suspicious":       suspect_count,
            "split_pending":    pending_count,
        },
        "issues": issues,
    }
