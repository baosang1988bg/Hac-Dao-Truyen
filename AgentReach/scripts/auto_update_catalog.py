#!/usr/bin/env python3
import subprocess
import os
import sys

def auto_update():
    # 1. Update AgentReach catalogs
    print("🔄 Running daily update check for AgentReach...")
    try:
        # Novel 543 update Lĩnh Chủ Hợp Thành
        print("Checking Lĩnh Chủ Hợp Thành...")
        subprocess.run([
            "python3", "scripts/novel_catalog.py", "fetch",
            "--name", "领主求生之天赋合成",
            "--url", "https://www.novel543.com/0606657941/dir"
        ], check=True, cwd="/Users/sangpls/Documents/AI00/AgentReach")
        
        # Qidian or other update Huyền Giám Tiên Tộc
        print("Checking Huyền Giám Tiên Tộc...")
        subprocess.run([
            "python3", "scripts/novel_catalog.py", "fetch",
            "--name", "Huyền Giám Tiên Tộc",
            "--url", "https://ixdzs8.com/read/508570/"
        ], check=True, cwd="/Users/sangpls/Documents/AI00/AgentReach")
        
        # Toàn Cầu Cầu Sinh wooden raft
        print("Checking Toàn Cầu Cầu Sinh...")
        subprocess.run([
            "python3", "scripts/novel_catalog.py", "fetch",
            "--name", "Toàn Cầu Cầu Sinh: Khai Cục Một Chiếc Bè Gỗ",
            "--url", "https://www.novel543.com/0315291074/"
        ], check=True, cwd="/Users/sangpls/Documents/AI00/AgentReach")
        
    except Exception as e:
        print(f"❌ Error updating catalog: {e}")
        
    # 2. Sync to HacDaoTruyen novel profiles if any changes are made
    print("Sync check finished.")

if __name__ == "__main__":
    auto_update()
