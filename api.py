"""
api.py
------
FastAPI app entry point — `uvicorn api:app` hoặc `python api.py`.

File này giờ chỉ tạo app + CORS và include các router (tách trong routers/).
Toàn bộ endpoint paths giữ nguyên như cũ (/api/...).
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ── Shared state (re-export để code cũ `from api import cancel_flags`... vẫn chạy) ──
from state import TASKS_LOCK, translation_tasks, cancel_flags, SERVER_START_TIME

# ── Helpers (re-export tương thích ngược: from api import extract_chapter_number_from_text) ──
from chapter_utils import chinese_to_arabic, extract_chapter_number_from_text

from routers import auth_routes, novels, chapters, translate, tools, logs

app = FastAPI(title="Novel Translation System")

# CORS — chỉ cho các origin tin cậy (cấu hình thêm qua ALLOWED_ORIGINS trong .env)
_default_origins = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:4444", "http://127.0.0.1:4444",
]
_extra_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

NOVELS_DIR = "novels"

# ── Routers — thứ tự include giữ tương tự thứ tự khai báo endpoint cũ.
# Lưu ý: trong routers/tools.py, /tools/merge_split_parts được khai báo TRƯỚC
# /tools/{tool} để route cụ thể match trước route generic (như api.py cũ).
app.include_router(auth_routes.router)
app.include_router(novels.router)
app.include_router(translate.router)
app.include_router(chapters.router)
app.include_router(tools.router)
app.include_router(logs.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="127.0.0.1", port=4444, reload=True)
