@echo off
title VigilanteVanguard - KSP Datathon 2026
color 1F
cls
echo.
echo  ============================================================
echo    VigilanteVanguard 4.1 - Karnataka State Police Datathon
echo    Zoho Catalyst + Qwen2.5 via Ollama (local AI)
echo  ============================================================
echo.
set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend
set VENV_PY=%ROOT%backend\venv\Scripts\python.exe
python --version >nul 2>&1
if errorlevel 1 ( echo [ERROR] Python not found & pause & exit /b 1 )
node --version >nul 2>&1
if errorlevel 1 ( echo [ERROR] Node not found & pause & exit /b 1 )
echo  Clearing port 8000...
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":8000 "') do taskkill /PID %%P /F >nul 2>&1
echo  Clearing port 3000...
for /f "tokens=5" %%P in ('netstat -ano 2^>nul ^| findstr ":3000 "') do taskkill /PID %%P /F >nul 2>&1
timeout /t 1 /nobreak >nul
if not exist "%VENV_PY%" (
    echo  [1/5] Creating Python venv...
    python -m venv "%ROOT%backend\venv"
) else (
    echo  [1/5] Venv ready.
)
echo  [2/5] Checking backend packages...
"%VENV_PY%" -c "import fastapi,uvicorn,pydantic" >nul 2>&1
if errorlevel 1 (
    echo  Installing backend packages - please wait ~2 mins...
    "%VENV_PY%" -m pip install -r "%BACKEND%\requirements.txt" --disable-pip-version-check
)
echo  [2/5] Backend packages ready.
if not exist "%FRONTEND%\node_modules" (
    echo  [3/5] Installing frontend packages - please wait...
    cd /d "%FRONTEND%"
    npm install
    cd /d "%ROOT%"
) else (
    echo  [3/5] Frontend packages ready.
)
echo  [4/5] Starting Ollama (Qwen2.5:1.5b)...
start "" /b ollama serve
timeout /t 3 /nobreak >nul
start "" /b ollama run qwen2.5:1.5b --keepalive 60m
timeout /t 2 /nobreak >nul
echo  [4/5] Ollama ready.
echo  [5/5] Starting backend and frontend...
start "VV-Backend" cmd /k "cd /d "%BACKEND%" & "%VENV_PY%" -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
timeout /t 3 /nobreak >nul
start "VV-Frontend" cmd /k "cd /d "%FRONTEND%" & npm run dev"
echo  Waiting for frontend on port 3000...
:WAIT
timeout /t 2 /nobreak >nul
netstat -ano 2>nul | findstr ":3000 " >nul 2>&1
if errorlevel 1 goto WAIT
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
echo.
echo  ============================================================
echo   LOCAL DEV RUNNING
echo   Frontend    -  http://localhost:3000
echo   API Docs    -  http://localhost:8000/api/docs
echo   AI Model    -  qwen2.5:1.5b via Ollama (local, no key needed)
echo.
echo   LIVE ON CATALYST (any browser, any device):
echo   https://vv-frontend-pjrowkzp.onslate.in
echo.
echo   Login       -  admin@ksp.gov.in / admin123
echo   To STOP     -  Close VV-Backend and VV-Frontend windows
echo  ============================================================
echo.
pause
