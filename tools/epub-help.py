#!/usr/bin/env python3
"""
epub-help.py — Quick Command Helper for EPUB Downloader & Drive Uploader
=======================================================================
Chạy lệnh này bất kỳ lúc nào để lấy nhanh câu lệnh thực tế cho Mac & Windows.
"""
import os, sys

if sys.platform == "win32":
    os.system("")

R="\033[0m"; BOLD="\033[1m"; DIM="\033[2m"
GRN="\033[92m"; YLW="\033[93m"; BLU="\033[94m"; CYN="\033[96m"; MGT="\033[95m"; WHT="\033[97m"

def print_help():
    print(f"\n{BOLD}{'═'*72}{R}")
    print(f"{BOLD}  📚  EPUB PIPELINE — BỘ CÂU LỆNH CHẨN THỰC TẾ{R}")
    print(f"{'═'*72}\n")

    print(f"{BOLD}{CYN}🍏 1. CÂU LỆNH CHO MAC OS (Terminal){R}")
    print(f"{'─'*72}")
    print(f"  {GRN}# Bước A: Tải EPUB 4 luồng + Tor Proxy + Auto-Sync Google Drive{R}")
    print(f"  cd /Users/sangpls/Documents/AI00/HacDaoTruyen")
    print(f"  {WHT}python3 tools/download_epubs.py --dir ~/Downloads/epub_library --workers 4 --use-tor --resume --item-timeout 40 --delay 0.2{R}\n")
    print(f"  {GRN}# Bước B: Upload lên Google Drive (Mở Cửa Sổ Terminal Thứ 2){R}")
    print(f"  {WHT}python3 tools/gdrive_upload.py --epub-dir ~/Downloads/epub_library --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV{R}\n")

    print(f"\n{BOLD}{YLW}🪟 2. CÂU LỆNH CHO WINDOWS (CMD / PowerShell){R}")
    print(f"{'─'*72}")
    print(f"  {GRN}# Bước A: Tải EPUB 4 luồng + Tor Proxy + Auto-Sync Google Drive{R}")
    print(f"  cd D:\\Hac-Dao-Truyen")
    print(f"  {WHT}python tools\\download_epubs.py --dir D:\\epub_library --workers 4 --use-tor --resume --item-timeout 40 --delay 0.2{R}\n")
    print(f"  {GRN}# Bước B: Upload lên Google Drive (Mở Cửa Sổ CMD Thứ 2){R}")
    print(f"  {WHT}python tools\\gdrive_upload.py --epub-dir D:\\epub_library --folder-id 1RKfWakoQOidHnxLXnZNgWoF_YokNt9lV{R}\n")

    print(f"{'═'*72}\n")

if __name__ == "__main__":
    print_help()
