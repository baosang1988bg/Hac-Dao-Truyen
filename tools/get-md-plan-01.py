#!/usr/bin/env python3
"""
get-md-plan-01.py — Hiển thị nhanh kế hoạch "EPUB Quick Overview + Chapter Splitter".

Dùng:
    python tools/get-md-plan-01.py          # In nội dung ra terminal
    python tools/get-md-plan-01.py --path   # Chỉ in đường dẫn file
    python tools/get-md-plan-01.py --open   # Mở bằng trình soạn thảo mặc định
"""

import sys
import os
from pathlib import Path

PLAN_FILE = Path(__file__).resolve().parent.parent / "docs" / "plans" / "epub-quick-overview-plan-01.md"


def print_plan():
    if not PLAN_FILE.exists():
        print(f"[ERROR] Không tìm thấy file plan: {PLAN_FILE}", file=sys.stderr)
        sys.exit(1)
    content = PLAN_FILE.read_text(encoding="utf-8")
    print(content)


def print_path():
    print(str(PLAN_FILE))


def open_plan():
    if not PLAN_FILE.exists():
        print(f"[ERROR] Không tìm thấy file: {PLAN_FILE}", file=sys.stderr)
        sys.exit(1)
    if sys.platform == "win32":
        os.startfile(str(PLAN_FILE))
    elif sys.platform == "darwin":
        os.system(f'open "{PLAN_FILE}"')
    else:
        os.system(f'xdg-open "{PLAN_FILE}"')
    print(f"[OK] Đã mở: {PLAN_FILE}")


def main():
    args = sys.argv[1:]

    if "--path" in args:
        print_path()
    elif "--open" in args:
        open_plan()
    else:
        # Mặc định: in nội dung với separator đẹp
        sep = "─" * 60
        print(f"\n{sep}")
        print(f"  📋  Plan 01: EPUB Quick Overview + Chapter Splitter")
        print(f"  📄  {PLAN_FILE}")
        print(f"{sep}\n")
        print_plan()
        print(f"\n{sep}")
        print(f"  Dùng --path để lấy đường dẫn | --open để mở file")
        print(f"{sep}\n")


if __name__ == "__main__":
    main()
