"""
routers/logs.py
---------------
Endpoint log/session: danh sách session dịch (parse logs/) + server-info.
"""

import os
import re
from datetime import datetime

from fastapi import APIRouter

from state import SERVER_START_TIME

router = APIRouter()

NOVELS_DIR = "novels"


@router.get("/api/server-info")
def get_server_info():
    """Trả về thời điểm server khởi động để UI biết gộp session theo server run."""
    return {"server_start": SERVER_START_TIME}


@router.get("/api/logs")
def list_sessions(limit: int = 200):
    """
    Parse tất cả log files trong thư mục logs/ và trả về danh sách session.
    Bao gồm cả các _stats.json không có file .log đi kèm (orphan stats).
    Mỗi session chứa: thời gian, truyện, số chương, thời lượng, tỷ lệ thành công,
    ước tính tokens, model đã dùng, loại session (translate/fix).
    """
    log_dir = "logs"
    if not os.path.exists(log_dir):
        return []

    all_files = os.listdir(log_dir)
    log_files  = set(f for f in all_files if f.endswith(".log"))
    stat_files = set(f for f in all_files if f.endswith("_stats.json"))

    sessions = []

    # 1. Parse các .log files bình thường (có thể kèm stats.json)
    for filename in sorted(log_files, reverse=True):
        filepath = os.path.join(log_dir, filename)
        try:
            session = _parse_log_file(filepath, filename)
            if session:
                sessions.append(session)
        except Exception:
            pass

    # 2. Parse các _stats.json KHÔNG có file .log tương ứng (orphan stats)
    for stat_filename in sorted(stat_files, reverse=True):
        # Tên log tương ứng: thay _stats.json → .log
        expected_log = stat_filename.replace("_stats.json", ".log")
        if expected_log in log_files:
            continue  # Đã được parse từ .log ở trên, bỏ qua

        # Orphan stats — tạo session từ stats JSON
        stat_path = os.path.join(log_dir, stat_filename)
        try:
            session = _parse_orphan_stats(stat_path, stat_filename)
            if session:
                sessions.append(session)
        except Exception:
            pass

    # Sắp xếp theo thời gian mới nhất trước, giới hạn kết quả
    sessions.sort(key=lambda s: s.get("started_at", ""), reverse=True)
    return sessions[:limit]


def _parse_log_file(filepath: str, filename: str) -> dict | None:
    """Parse 1 log file thành session dict."""
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()

    if not lines:
        return None

    # ── Loại session từ tên file ──
    session_type = "fix" if filename.startswith("fix_") else "translate"

    # ── Lấy timestamp từ dòng đầu ──
    ts_match = re.match(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', lines[0])
    started_at = ts_match.group(1) if ts_match else filename

    # ── Lấy timestamp dòng cuối (thời điểm kết thúc) ──
    last_ts_match = re.match(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', lines[-1])
    ended_at = last_ts_match.group(1) if last_ts_match else started_at

    # ── Tính duration ──
    duration_sec = 0
    try:
        fmt = "%Y-%m-%d %H:%M:%S"
        t0 = datetime.strptime(started_at, fmt)
        t1 = datetime.strptime(ended_at,   fmt)
        duration_sec = int((t1 - t0).total_seconds())
    except Exception:
        pass

    # ── Parse nội dung log ──
    novel_title  = ""
    novel_slug   = ""
    chapters_requested = 0
    chapters_saved     = []
    models_used        = set()
    errors             = []
    auto_learned       = 0
    batch_sizes        = []
    cost_logs          = []   # từ [💰] lines

    full_text = "".join(lines)

    # Novel info
    m = re.search(r'\[\*\] Novel: (.+?) \((.+?)\)', full_text)
    if m:
        novel_title = m.group(1).strip()
        novel_slug  = m.group(2).strip()

    # Chapters requested
    m = re.search(r'Chapters to translate: (\d+)', full_text)
    if m:
        chapters_requested = int(m.group(1))

    # Saved chapters
    chapters_saved = re.findall(r'\[+\] Saved: .+?/([^/]+)_VI\.md', full_text)

    # Batch sizes
    batch_sizes = [int(x) for x in re.findall(r'Translating batch of (\d+) chapters', full_text)]

    # Auto-learned terms
    learned = re.findall(r'Auto-learned (\d+) new glossary', full_text)
    auto_learned = sum(int(x) for x in learned)

    # Models used (từ [Gemini], [Fallback], [Local])
    models_used.update(re.findall(r'\[Gemini\] model=(\S+)', full_text))
    models_used.update(re.findall(r'\[✓\] (Gemini|DeepSeek|Groq|Ollama) success', full_text))
    # Cost tracking lines: [💰] model: ~X→Y tokens, $Z
    cost_lines = re.findall(r'💰[^\n]+', full_text)
    cost_logs  = [l.strip() for l in cost_lines]
    # Extract total tokens
    total_tokens = 0
    for cl in cost_lines:
        tok = re.findall(r'~(\d+)→(\d+)', cl)
        for inp, out in tok:
            total_tokens += int(inp) + int(out)

    # Errors
    error_lines = [l.strip() for l in lines if '[ERROR]' in l or '[!]' in l or 'Translation failed' in l]
    errors = error_lines[:10]  # giới hạn 10 lỗi đầu

    # Done line
    done_match = re.search(r'Translated (\d+) chapter\(s\)', full_text)
    chapters_done = int(done_match.group(1)) if done_match else len(chapters_saved)

    # Success rate
    failed_count = sum(1 for l in lines if 'Translation failed' in l or 'FAILED' in l)
    success_count = chapters_done
    total_attempted = success_count + failed_count
    success_rate = round(success_count / total_attempted * 100, 1) if total_attempted > 0 else 100.0

    # Speed: chương/phút
    speed_cpm = round(chapters_done / (duration_sec / 60), 2) if duration_sec > 60 and chapters_done > 0 else None
    # Thời gian trung bình mỗi chương
    sec_per_chap = round(duration_sec / chapters_done, 1) if chapters_done > 0 else None

    # ── Load companion stats JSON nếu có ──
    # File: logs/<slug>_<YYYYMMDD_HHMMSS>_stats.json (tên khớp với log file)
    stats_json = {}
    log_ts = re.search(r'_(\d{8}_\d{6})\.log$', filename)
    if log_ts:
        stats_file = os.path.join("logs", filename.replace(".log", "_stats.json"))
        if os.path.exists(stats_file):
            try:
                import json as _j
                with open(stats_file, "r", encoding="utf-8") as _f:
                    stats_json = _j.load(_f)
            except Exception:
                pass

    # Ưu tiên stats từ JSON (chính xác hơn) over stats từ log text (ước tính)
    real_total_tokens  = stats_json.get("total_tokens",  total_tokens)
    real_input_tokens  = stats_json.get("input_tokens",  0)
    real_output_tokens = stats_json.get("output_tokens", 0)
    real_cost_usd      = stats_json.get("cost_usd",      0.0)
    real_models        = stats_json.get("models",        sorted(models_used))

    # Per-model breakdown: tính từ cost_logs
    model_breakdown = {}
    for cl in cost_logs:
        # pattern: [💰] model_name: ~X→Y tokens, $Z hoặc free
        m = re.match(r'.*?\]\s*([^\:]+):\s*~(\d+)→(\d+)\s+tokens,\s*(.+)', cl)
        if m:
            model_name = m.group(1).strip()
            inp = int(m.group(2)); out = int(m.group(3))
            cost_str = m.group(4).strip()
            cost_val = float(cost_str.lstrip("~$")) if "$" in cost_str else 0.0
            if model_name not in model_breakdown:
                model_breakdown[model_name] = {"input_tokens":0,"output_tokens":0,"total_tokens":0,"cost_usd":0.0,"calls":0}
            model_breakdown[model_name]["input_tokens"]  += inp
            model_breakdown[model_name]["output_tokens"] += out
            model_breakdown[model_name]["total_tokens"]  += inp + out
            model_breakdown[model_name]["cost_usd"]      += cost_val
            model_breakdown[model_name]["calls"]         += 1

    return {
        "filename":           filename,
        "session_type":       session_type,
        "started_at":         started_at,
        "ended_at":           ended_at,
        "duration_sec":       duration_sec,
        "novel_title":        novel_title or filename.split("_")[0],
        "novel_slug":         novel_slug,
        "chapters_requested": chapters_requested,
        "chapters_done":      chapters_done,
        "chapters_saved":     chapters_saved,
        "success_rate":       success_rate,
        "failed_count":       failed_count,
        "speed_cpm":          speed_cpm,
        "sec_per_chap":       sec_per_chap,
        "models_used":        real_models,
        "auto_learned":       auto_learned,
        "batch_sizes":        batch_sizes,
        # Token stats — từ JSON nếu có, không thì từ log
        "total_tokens":       real_total_tokens,
        "input_tokens":       real_input_tokens,
        "output_tokens":      real_output_tokens,
        "cost_usd":           real_cost_usd,
        "has_stats_json":     bool(stats_json),
        # Per-model breakdown
        "model_breakdown":    model_breakdown,
        "cost_logs":          cost_logs[:20],
        "errors":             errors[:5],
        "status":             "done" if "Done! Translated" in full_text or "thành công" in full_text
                              else "error" if error_lines else "partial",
    }


def _parse_orphan_stats(stat_path: str, stat_filename: str) -> dict | None:
    """
    Tạo session entry từ _stats.json không có file .log đi kèm.
    Đọc đầy đủ các fields mới (started_at, ended_at, duration_sec,
    chapters_saved, errors) nếu có trong file (format mới).
    """
    try:
        import json as _j
        with open(stat_path, "r", encoding="utf-8") as f:
            stats = _j.load(f)
    except Exception:
        return None

    slug          = stats.get("slug", "")
    chapters_done = stats.get("chapters_done", 0)
    total_tokens  = stats.get("total_tokens", 0)
    input_tokens  = stats.get("input_tokens", 0)
    output_tokens = stats.get("output_tokens", 0)
    cost_usd      = stats.get("cost_usd", 0.0)
    models        = stats.get("models", [])

    # ── Timestamp: ưu tiên started_at (format mới) → timestamp → tên file ──
    if stats.get("started_at"):
        raw_ts     = stats["started_at"]
        started_at = raw_ts[:19].replace("T", " ")
    elif stats.get("timestamp"):
        raw_ts     = stats["timestamp"]
        started_at = raw_ts[:19].replace("T", " ")
    else:
        m = re.search(r'_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_stats', stat_filename)
        started_at = (f"{m.group(1)}-{m.group(2)}-{m.group(3)} {m.group(4)}:{m.group(5)}:{m.group(6)}"
                      if m else stat_filename)

    # ── ended_at & duration_sec: đọc từ file nếu có ──
    ended_at     = started_at  # fallback
    duration_sec = 0
    if stats.get("ended_at"):
        ended_at = stats["ended_at"][:19].replace("T", " ")
    if stats.get("duration_sec"):
        duration_sec = int(stats["duration_sec"])

    # ── chapters_saved & errors: đọc từ file nếu có ──
    chapters_saved = stats.get("chapters_saved", [])
    errors         = stats.get("errors", [])

    # ── sec_per_chap: tính từ duration nếu có ──
    sec_per_chap = round(duration_sec / chapters_done, 1) if duration_sec > 0 and chapters_done > 0 else None

    # ── failed_count: đếm từ errors ──
    failed_count = len(errors)
    success_rate = round(((chapters_done - failed_count) / chapters_done) * 100, 1) if chapters_done > 0 else 0.0

    # ── Novel title: ưu tiên đọc từ novel.json ──
    novel_title = slug.replace("-", " ").title() if slug else stat_filename.split("_")[0]
    if slug:
        novel_json_path = os.path.join(NOVELS_DIR, slug, "novel.json")
        if os.path.exists(novel_json_path):
            try:
                import json as _jj
                with open(novel_json_path, "r", encoding="utf-8") as _f:
                    nd = _jj.load(_f)
                    novel_title = nd.get("title") or novel_title
            except Exception:
                pass

    session_type = "fix" if stat_filename.startswith("fix_") else "translate"

    return {
        "filename":           stat_filename,
        "session_type":       session_type,
        "started_at":         started_at,
        "ended_at":           ended_at,
        "duration_sec":       duration_sec,
        "novel_title":        novel_title,
        "novel_slug":         slug,
        "chapters_requested": chapters_done,
        "chapters_done":      chapters_done,
        "chapters_saved":     chapters_saved,
        "success_rate":       success_rate,
        "failed_count":       failed_count,
        "speed_cpm":          None,
        "sec_per_chap":       sec_per_chap,
        "models_used":        models,
        "auto_learned":       0,
        "batch_sizes":        [],
        "total_tokens":       total_tokens,
        "input_tokens":       input_tokens,
        "output_tokens":      output_tokens,
        "cost_usd":           cost_usd,
        "has_stats_json":     True,
        "model_breakdown":    {},
        "cost_logs":          [],
        "errors":             errors,
        "status":             "error" if failed_count > 0 and chapters_done == 0
                              else "partial" if failed_count > 0
                              else "done" if chapters_done > 0
                              else "partial",
        "is_orphan_stats":    True,
    }
