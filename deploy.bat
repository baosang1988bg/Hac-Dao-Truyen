@echo off
chcp 65001 > nul
echo ==========================================================
echo  🚀 ĐANG ĐỒNG BỘ DỮ LIỆU TRUYỆN LÊN CLOUDFLARE (D1 + R2)
echo ==========================================================
set PYTHONIOENCODING=utf-8
C:\Users\ADMIN\AppData\Local\Python\bin\python.exe migrate_to_cloudflare.py --smart-sync

echo.
echo ==========================================================
echo  🛠️ ĐANG BUILD FRONTEND VÀ DEPLOY WEBSITE LÊN CLOUDFLARE
echo ==========================================================
call npm run deploy

echo.
echo ==========================================================
echo  🎉 QUÁ TRÌNH DEPLOY HOÀN TẤT THÀNH CÔNG!
echo ==========================================================
pause
