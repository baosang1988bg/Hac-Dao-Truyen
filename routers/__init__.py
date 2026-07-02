"""
routers
-------
Package chứa các APIRouter tách từ api.py:
  - auth_routes.py : login/logout/verify
  - novels.py      : danh sách/chi tiết truyện, catalog, glossary
  - chapters.py    : danh sách chương, nội dung chương, health check
  - translate.py   : start/stop/status dịch, translate-quick
  - tools.py       : merge_split_parts, cleanup-split-parts, run_tool
  - logs.py        : danh sách session log, server-info

api.py chỉ tạo app + CORS và include các router này — endpoint paths giữ nguyên.
"""
