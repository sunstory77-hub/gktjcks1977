@echo off
setlocal
title Rod AI Agent
cd /d "%~dp0"

set PORT=8000
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORT" set PORT=%%b

rem --- Already running? Just open the browser. ---
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo [INFO] Agent is already running. Opening browser...
  start "" http://127.0.0.1:%PORT%
  exit /b 0
)

rem --- Find Python ---
set PY=
py -3 --version >nul 2>&1 && set PY=py -3
if not defined PY ( python --version >nul 2>&1 && set PY=python )
if not defined PY (
  echo [ERROR] Python 3.10+ not found. Install from https://www.python.org/downloads/
  echo         Check "Add python.exe to PATH" during install.
  pause
  exit /b 1
)

rem --- Create virtual environment on first run ---
if not exist ".venv\Scripts\python.exe" (
  echo [SETUP] Creating virtual environment. First run takes 1-3 minutes...
  %PY% -m venv .venv
  if errorlevel 1 ( echo [ERROR] venv creation failed. & pause & exit /b 1 )
)
set VPY=.venv\Scripts\python.exe

rem --- Install packages only when requirements.txt changed ---
fc /b requirements.txt .req_installed >nul 2>&1
if errorlevel 1 (
  echo [SETUP] Installing packages...
  "%VPY%" -m pip install --upgrade pip -q
  "%VPY%" -m pip install -r requirements.txt -q
  if errorlevel 1 ( echo [ERROR] Package install failed. Check internet connection. & pause & exit /b 1 )
  copy /y requirements.txt .req_installed >nul
)

echo [START] http://127.0.0.1:%PORT%  (close this window to stop)
"%VPY%" server.py
if errorlevel 1 pause
