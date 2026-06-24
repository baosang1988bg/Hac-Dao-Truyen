@echo off
echo [NovelAI] Starting services...

:: Fix utf-8 print issues in Python on Windows
set PYTHONIOENCODING=utf-8

:: Detect the real Python executable (excluding the WindowsApps execution alias)
set PYTHON_CMD=python
for /f "tokens=*" %%i in ('where python 2^>nul') do (
    echo %%i | findstr /i "WindowsApps" >nul
    if errorlevel 1 (
        set PYTHON_CMD="%%i"
        goto :found_python
    )
)
:found_python

echo [NovelAI] Using Python: %PYTHON_CMD%

echo [NovelAI] Starting Backend (FastAPI)...
start "NovelAI Backend" cmd /c "%PYTHON_CMD% -m uvicorn api:app --host 127.0.0.1 --port 4444 --reload"

echo [NovelAI] Starting Frontend (Vite React)...
start "NovelAI Frontend" cmd /c "cd frontend && npm run dev"

echo.
echo =======================================================
echo Both services have been started in separate windows!
echo Backend API: http://127.0.0.1:4444
echo Web UI:      http://localhost:5173
echo =======================================================
echo.
pause
