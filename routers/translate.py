"""
routers/translate.py
--------------------
Endpoint điều khiển dịch: start / status / stop + translate-quick (extension).
Phụ thuộc vào contract của progress_callback do main.cmd_translate_async cung cấp.
"""

import asyncio
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Depends
from pydantic import BaseModel

from novel_manager import load_novel
from main import cmd_translate_async
from auth import require_admin
from security_utils import validate_slug, validate_source_url
from state import TASKS_LOCK, translation_tasks, cancel_flags

router = APIRouter()


class TranslateRequest(BaseModel):
    chapters: int = 3
    force: bool = False
    url: Optional[str] = None


class QuickTranslateRequest(BaseModel):
    text: str
    model: str = ""


class DummyArgs:
    def __init__(self, novel, chapters, force=False, url=None):
        self.novel = novel
        self.chapters = chapters
        self.force = force
        self.url = url


@router.post("/api/novels/{slug}/translate", dependencies=[Depends(require_admin)])
def start_translation(slug: str, req: TranslateRequest, background_tasks: BackgroundTasks):
    """Bắt đầu dịch N chương (chạy background). (admin)"""
    validate_slug(slug)
    if req.url:
        validate_source_url(req.url)
    try:
        profile = load_novel(slug)
        args = DummyArgs(novel=slug, chapters=req.chapters, force=req.force, url=req.url)

        # Không cho chạy 2 phiên dịch song song trên cùng 1 truyện
        with TASKS_LOCK:
            existing = translation_tasks.get(slug)
            if existing and existing.get("status") in ("running", "cancelling"):
                raise HTTPException(status_code=409, detail="Truyện này đang có phiên dịch chạy")

        # Initialize state
        translation_tasks[slug] = {
            "status":        "running",
            "current":       0,
            "total":         req.chapters,
            "logs":          [],
            "active_batches": 0,
            "scraped_count": 0,
            # ── Realtime admin fields ──────────────────────────
            "current_chapter":  "",      # tên chương đang xử lý
            "crawling_chapter": "",      # tên chương đang crawl
            "current_model":    "",      # model AI đang dùng
            "tokens_used":      0,       # tổng tokens tích lũy
            "cost_so_far":      0.0,     # tổng cost tích lũy ($)
            "chapters_ok":      [],      # danh sách chương đã dịch thành công
            "chapters_fail":    [],      # danh sách chương thất bại
            "batch_details":    [],      # [{id, chapters, model, status, tokens}]
        }
        cancel_flags[slug] = False

        def progress_callback(current, total, status, log_msg="",
                              active_batches=None, scraped_count=None,
                              current_chapter=None, crawling_chapter=None,
                              current_model=None, tokens_delta=0, cost_delta=0.0,
                              chapter_ok=None, chapter_fail=None, batch_detail=None):
            with TASKS_LOCK:
                task = translation_tasks.get(slug)
            if task:
                task["current"] = current
                task["total"]   = total
                task["status"]  = status
                if active_batches    is not None: task["active_batches"]    = active_batches
                if scraped_count     is not None: task["scraped_count"]     = scraped_count
                if current_chapter   is not None: task["current_chapter"]   = current_chapter
                if crawling_chapter  is not None: task["crawling_chapter"]  = crawling_chapter
                if current_model     is not None: task["current_model"]     = current_model
                if tokens_delta:
                    task["tokens_used"] += tokens_delta
                if cost_delta:
                    task["cost_so_far"] += cost_delta
                if chapter_ok:
                    task["chapters_ok"].append(chapter_ok)
                    if len(task["chapters_ok"]) > 50:
                        task["chapters_ok"] = task["chapters_ok"][-50:]
                if chapter_fail:
                    task["chapters_fail"].append(chapter_fail)
                if batch_detail:
                    # Upsert batch_detail bằng id
                    existing = next((b for b in task["batch_details"] if b["id"] == batch_detail["id"]), None)
                    if existing:
                        existing.update(batch_detail)
                    else:
                        task["batch_details"].append(batch_detail)
                        if len(task["batch_details"]) > 20:
                            task["batch_details"] = task["batch_details"][-20:]
                if log_msg:
                    task["logs"].append(log_msg)
                    if len(task["logs"]) > 100:
                        task["logs"] = task["logs"][-100:]
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


@router.get("/api/novels/{slug}/translate/status")
def get_translation_status(slug: str):
    """Lấy trạng thái tiến độ dịch."""
    validate_slug(slug)
    with TASKS_LOCK:
        task = translation_tasks.get(slug)
    if not task:
        return {"status": "idle", "current": 0, "total": 0, "logs": []}
    return task


@router.get("/api/translate/active")
def get_active_translations():
    """
    Trạng thái gọn của TẤT CẢ phiên dịch đang chạy — cho admin dashboard
    poll 1 endpoint thay vì N endpoint theo từng slug.
    """
    result = {}
    with TASKS_LOCK:
        for slug, task in translation_tasks.items():
            if task.get("status") in ("running", "cancelling"):
                result[slug] = {
                    "status":          task.get("status"),
                    "current":         task.get("current", 0),
                    "total":           task.get("total", 0),
                    "current_chapter": task.get("current_chapter", ""),
                    "current_model":   task.get("current_model", ""),
                }
    return result


@router.post("/api/novels/{slug}/translate/stop", dependencies=[Depends(require_admin)])
def stop_translation(slug: str):
    """Dừng quá trình dịch đang chạy (graceful stop sau batch hiện tại). (admin)"""
    validate_slug(slug)
    with TASKS_LOCK:
        task = translation_tasks.get(slug)
        if not task or task["status"] != "running":
            return {"status": "not_running", "message": "Không có task đang chạy"}
        cancel_flags[slug] = True
        task["status"] = "cancelling"
        task["logs"].append("⏹ Đang dừng sau batch hiện tại...")
    return {"status": "ok", "message": "Đã gửi yêu cầu dừng"}


@router.post("/api/translate-quick", dependencies=[Depends(require_admin)])
async def translate_quick(req: QuickTranslateRequest):
    """
    Quick translate endpoint cho Chrome Extension. (admin — tránh bị lạm dụng quota)
    Key Gemini/DeepSeek nằm trong .env trên server — không bao giờ lộ ra client.
    """
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    if len(req.text) > 20000:
        raise HTTPException(status_code=400, detail="text quá dài (tối đa 20000 ký tự)")

    try:
        from translator import NovelTranslator
        translator = NovelTranslator()

        prompt = (
            "Dịch đoạn text tiếng Trung sau sang tiếng Việt tự nhiên, văn học.\n"
            "Nếu là tên nhân vật hoặc địa danh Trung Quốc, hãy phiên âm sang tiếng Việt (VD: 乔桑 → Kiều Tang).\n"
            "Chỉ trả về bản dịch, không giải thích gì thêm.\n\n"
            f"Text cần dịch:\n{req.text.strip()}"
        )

        # Dùng translate_chapter để tận dụng retry + fallback logic
        result, _, usage = await asyncio.to_thread(
            translator.translate_chapter,
            title="quick-translate",
            content=req.text.strip(),
            glossary={},
            translation_style="",
            max_retries=2,
        )

        # Strip translation failed marker
        if "[Translation failed" in result[:100]:
            raise HTTPException(status_code=500, detail="Translation failed — thử lại sau")

        return {
            "result": result.strip(),
            "model":  usage.get("model", "unknown"),
            "tokens": usage.get("total_tokens", 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
