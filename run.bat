@echo off
REM Poster Auto-Creation App - Windows Runner
REM ==========================================

echo ========================================
echo 홍보포스터 자동제작 앱
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python이 설치되어 있지 않습니다!
    echo Python 3.11 이상을 설치해주세요: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/5] Python 확인 완료!
echo.

REM Check if virtual environment exists
if not exist "venv" (
    echo [2/5] 가상환경 생성 중...
    python -m venv venv
    echo 가상환경 생성 완료!
) else (
    echo [2/5] 가상환경이 이미 존재합니다.
)
echo.

REM Activate virtual environment
echo [3/5] 가상환경 활성화 중...
call venv\Scripts\activate.bat
if errorlevel 1 (
    echo [ERROR] 가상환경 활성화 실패!
    pause
    exit /b 1
)
echo 가상환경 활성화 완료!
echo.

REM Install dependencies
echo [4/5] 필요한 패키지 설치 중...
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo [WARNING] 일부 패키지 설치에 문제가 있을 수 있습니다.
)
echo 패키지 설치 완료!
echo.

REM Create static directories
if not exist "static\generated" (
    echo 정적 파일 디렉토리 생성 중...
    mkdir static\generated
)

REM Start the server
echo [5/5] FastAPI 서버 시작 중...
echo.
echo ========================================
echo 서버 실행 중!
echo 브라우저에서 접속하세요:
echo.
echo    http://localhost:8000
echo.
echo 서버를 종료하려면 Ctrl+C 를 누르세요.
echo ========================================
echo.

python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

pause
