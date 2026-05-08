import os
import re
import json
import asyncio
import threading
from datetime import datetime
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict

# Import existing logic
from novel_manager import load_novel
from main import cmd_translate_async

app = FastAPI(title="Novel Translation System")

# Enable CORS for Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

NOVELS_DIR = "novels"

# Global state for translation progress
translation_tasks = {}
# Cancel flags — set True để yêu cầu dừng gracefully
cancel_flags: dict[str, bool] = {}

# Thời điểm server khởi động — dùng để gộp session trong UI
SERVER_START_TIME = datetime.now().isoformat()


# ── Models ────────────────────────────────────────────────────────────────────
class TranslateRequest(BaseModel):
    chapters: int = 3
    force: bool = False

class GlossaryUpdateRequest(BaseModel):
    glossary: Dict[str, str]

class DummyArgs:
    def __init__(self, novel, chapters, force=False, url=None):
        self.novel = novel
        self.chapters = chapters
        self.force = force
        self.url = url

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/api/novels")
def list_novels():
    """Lấy danh sách các truyện hiện có."""
    if not os.path.exists(NOVELS_DIR):
        return []
    
    novels = []
    for slug in os.listdir(NOVELS_DIR):
        if os.path.isdir(os.path.join(NOVELS_DIR, slug)):
            json_path = os.path.join(NOVELS_DIR, slug, "novel.json")
            if os.path.exists(json_path):
                with open(json_path, "r", encoding="utf-8") as f:
                    try:
                        data = json.load(f)
                        novels.append(data)
                    except json.JSONDecodeError:
                        pass
    return novels

@app.get("/api/novels/{slug}")
def get_novel(slug: str):
    """Lấy chi tiết truyện (gồm cả glossary)."""
    try:
        profile = load_novel(slug)
        # Read the raw dict because load_novel returns NovelProfile object
        json_path = os.path.join(NOVELS_DIR, slug, "novel.json")
        with open(json_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Novel not found")

@app.post("/api/novels/{slug}/glossary")
def update_glossary(slug: str, req: GlossaryUpdateRequest):
    """Cập nhật từ điển."""
    try:
        profile = load_novel(slug)
        profile.glossary = req.glossary
        profile.save()
        return {"status": "success", "message": "Glossary updated"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Novel not found")

@app.post("/api/novels/{slug}/translate")
def start_translation(slug: str, req: TranslateRequest, background_tasks: BackgroundTasks):
    """Bắt đầu dịch N chương (chạy background)."""
    try:
        profile = load_novel(slug)
        args = DummyArgs(novel=slug, chapters=req.chapters, force=req.force)
        
        # Initialize state
        translation_tasks[slug] = {
            "status": "running",
            "current": 0,
            "total": req.chapters,
            "logs": [],
            "active_batches": 0,   # số batch đang dịch song song hiện tại
            "scraped_count": 0,    # số chương đã cào xong (chờ dịch hoặc đang dịch)
        }
        cancel_flags[slug] = False

        def progress_callback(current, total, status, log_msg="", active_batches=None, scraped_count=None):
            task = translation_tasks.get(slug)
            if task:
                task["current"] = current
                task["total"] = total
                task["status"] = status
                if active_batches is not None:
                    task["active_batches"] = active_batches
                if scraped_count is not None:
                    task["scraped_count"] = scraped_count
                if log_msg:
                    task["logs"].append(log_msg)
                    if len(task["logs"]) > 100:
                        task["logs"] = task["logs"][-100:]
            # Nếu bị cancel → đổi status ngay
            if cancel_flags.get(slug):
                if task: task["status"] = "cancelled"

        # Chạy logic dịch trong background task
        def run_translation():
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(cmd_translate_async(args, progress_callback=progress_callback))
            except Exception as e:
                print(f"[!] Background translation error: {e}")
                if slug in translation_tasks:
                    # Nếu bị cancel thì hiện cancelled, không phải error
                    final_status = "cancelled" if cancel_flags.get(slug) else "error"
                    translation_tasks[slug]["status"] = final_status
                    if not cancel_flags.get(slug):
                        translation_tasks[slug]["logs"].append(f"Lỗi hệ thống: {e}")
            finally:
                cancel_flags.pop(slug, None)
                
        background_tasks.add_task(run_translation)
        return {"status": "success", "message": f"Started translating {req.chapters} chapters in background"}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Novel not found")

@app.get("/api/novels/{slug}/translate/status")
def get_translation_status(slug: str):
    """Lấy trạng thái tiến độ dịch."""
    task = translation_tasks.get(slug)
    if not task:
        return {"status": "idle", "current": 0, "total": 0, "logs": []}
    return task

@app.post("/api/novels/{slug}/translate/stop")
def stop_translation(slug: str):
    """Dừng quá trình dịch đang chạy (graceful stop sau batch hiện tại)."""
    task = translation_tasks.get(slug)
    if not task or task["status"] != "running":
        return {"status": "not_running", "message": "Không có task đang chạy"}
    cancel_flags[slug] = True
    translation_tasks[slug]["status"] = "cancelling"
    translation_tasks[slug]["logs"].append("⏹ Đang dừng sau batch hiện tại...")
    return {"status": "ok", "message": "Đã gửi yêu cầu dừng"}


@app.get("/api/novels/{slug}/chapters")
def list_chapters(slug: str):
    """Lấy danh sách các chương đã dịch."""
    translated_dir = os.path.join(NOVELS_DIR, slug, "translated")
    if not os.path.exists(translated_dir):
        return []
    
    files = [f for f in os.listdir(translated_dir) if f.endswith(".md")]
    import re
    def get_chapter_num(filename):
        match = re.search(r'\d+', filename)
        return int(match.group()) if match else 999999

    sorted_files = sorted(files, key=get_chapter_num)
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

@app.get("/api/novels/{slug}/chapters/{filename}")
def get_chapter_content(slug: str, filename: str):
    """Lấy nội dung Markdown của chương."""
    filepath = os.path.join(NOVELS_DIR, slug, "translated", filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Chapter not found")
    with open(filepath, "r", encoding="utf-8") as f:
        return {"content": f.read()}


@app.get("/api/novels/{slug}/health")
def health_check(slug: str):
    """
    So sánh text_raw/ và translated/ để tìm:
    - Chương trong raw nhưng chưa có bản dịch (missing)
    - Chương đã dịch nhưng chứa '[Translation failed' (failed)
    - Chương đã dịch quá ngắn bất thường so với raw (suspicious)
    """
    import re as _re

    raw_dir   = os.path.join(NOVELS_DIR, slug, "text_raw")
    trans_dir = os.path.join(NOVELS_DIR, slug, "translated")

    if not os.path.exists(raw_dir):
        raise HTTPException(status_code=404, detail="text_raw directory not found")

    raw_files = sorted(
        f for f in os.listdir(raw_dir) if f.endswith(".txt")
    )

    issues = []
    total_translated = 0

    for raw_name in raw_files:
        stem     = os.path.splitext(raw_name)[0]
        out_name = f"{stem}_VI.md"
        raw_path = os.path.join(raw_dir, raw_name)
        out_path = os.path.join(trans_dir, out_name)

        # 1. Missing — chưa có file dịch
        if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
            issues.append({
                "filename": raw_name,
                "type": "missing",
                "detail": "Chưa có bản dịch",
            })
            continue

        total_translated += 1

        # Đọc 300 bytes đầu để kiểm tra failed message
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                head = f.read(300)
                f.seek(0)
                full_trans = f.read()
        except Exception:
            issues.append({
                "filename": raw_name,
                "type": "failed",
                "detail": "Không đọc được file dịch",
            })
            continue

        # 2. Failed — chứa error marker
        if "[Translation failed" in head:
            # Trích lấy dòng error để hiển thị
            err_line = next(
                (l.strip() for l in head.splitlines() if "[Translation failed" in l),
                "Translation failed"
            )
            issues.append({
                "filename": raw_name,
                "type": "failed",
                "detail": err_line[:120],
            })
            continue

        # 3. Suspicious ratio — bản dịch quá ngắn so với raw
        try:
            raw_chars = os.path.getsize(raw_path)
            trans_chars = len(full_trans.strip())
            if raw_chars > 100:
                ratio = trans_chars / raw_chars
                # Vietnamese is typically 1.3–2.5× longer than Chinese source
                if ratio < 0.8:
                    issues.append({
                        "filename": raw_name,
                        "type": "suspicious",
                        "detail": f"Bản dịch quá ngắn (tỷ lệ ký tự: {ratio:.2f}×, kỳ vọng ≥ 1.3×)",
                    })
        except Exception:
            pass

    missing_count  = sum(1 for i in issues if i["type"] == "missing")
    failed_count   = sum(1 for i in issues if i["type"] == "failed")
    suspect_count  = sum(1 for i in issues if i["type"] == "suspicious")

    return {
        "summary": {
            "total_raw":        len(raw_files),
            "total_translated": total_translated,
            "missing":          missing_count,
            "failed":           failed_count,
            "suspicious":       suspect_count,
        },
        "issues": issues,
    }


@app.get("/api/server-info")
def get_server_info():
    """Trả về thời điểm server khởi động để UI biết gộp session theo server run."""
    return {"server_start": SERVER_START_TIME}

@app.get("/api/logs")
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


@app.get("/api/novels/{slug}/tools/{tool}")
async def run_tool(slug: str, tool: str, chapter_title: str = ""):
    allowed_tools = {
        "fix_chapters":   ["python3", "fix_chapters.py",   "--novel", slug],
        "fix_truncated":  ["python3", "fix_truncated.py",  "--novel", slug],
        "fix_one":        ["python3", "fix_one_chapter.py","--novel", slug],
        "check_keys":     ["python3", "check_keys.py",     "--show"],
        "fix_titles_v2":  ["python3", "fix_titles_v2.py"],
    }
    
    if tool not in allowed_tools:
        raise HTTPException(status_code=400, detail="Tool not allowed")
    
    cmd = allowed_tools[tool]
    if tool == "fix_one":
        if not chapter_title:
            raise HTTPException(status_code=400, detail="chapter_title is required for fix_one tool")
        cmd.extend(["--chapter", chapter_title])
        
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=4444, reload=True)
