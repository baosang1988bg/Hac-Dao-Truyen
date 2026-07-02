"""
state.py
--------
Trạng thái runtime dùng chung giữa api.py, các router và main.py.

Tách riêng module này để tránh circular import:
  - routers/* import từ state (không import từ api)
  - main.py import cancel_flags từ state (không import từ api)
"""

import threading
from datetime import datetime

# Lock bảo vệ translation_tasks / cancel_flags — API chạy multi-thread
TASKS_LOCK = threading.Lock()

# Trạng thái tiến độ dịch theo slug: slug → task dict
translation_tasks: dict = {}

# Cancel flags — set True để yêu cầu dừng gracefully
cancel_flags: dict[str, bool] = {}

# Thời điểm server khởi động — dùng để gộp session trong UI
SERVER_START_TIME = datetime.now().isoformat()
