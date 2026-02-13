# 🪟 Windows에서 실행하는 방법

## 📋 필수 요구사항

1. **Python 3.11 이상**
   - 다운로드: https://www.python.org/downloads/
   - ⚠️ 설치 시 "Add Python to PATH" 체크 필수!

2. **Git** (선택사항, GitHub에서 다운로드하려면 필요)
   - 다운로드: https://git-scm.com/download/win

---

## 🚀 방법 1: 자동 실행 (추천)

### 1단계: 코드 다운로드

**옵션 A: Git 사용**
```cmd
# 명령 프롬프트(CMD) 또는 PowerShell 열기
# 원하는 폴더로 이동 (예: 문서 폴더)
cd %USERPROFILE%\Documents

# GitHub에서 클론
git clone https://github.com/sunstory77-hub/gktjcks1977.git
cd gktjcks1977
```

**옵션 B: ZIP 다운로드**
1. GitHub 페이지에서 "Code" → "Download ZIP" 클릭
2. 다운로드한 ZIP 파일 압축 해제
3. 압축 해제한 폴더로 이동

### 2단계: 실행

**방법 1: 더블 클릭**
```
📁 폴더에서 run.bat 파일을 더블 클릭!
```

**방법 2: 명령 프롬프트**
```cmd
run.bat
```

### 3단계: 브라우저 접속

```
http://localhost:8000
```

---

## 🔧 방법 2: 수동 실행

```cmd
# 1. 가상환경 생성
python -m venv venv

# 2. 가상환경 활성화
venv\Scripts\activate

# 3. 패키지 설치
pip install -r requirements.txt

# 4. 서버 실행
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 🌐 사용 방법

1. 웹 브라우저 열기 (크롬, 엣지 등)
2. 주소창에 `http://localhost:8000` 입력
3. 포스터 제목 입력
4. 테마와 스타일 선택
5. "포스터 생성" 버튼 클릭!
6. 생성된 포스터 다운로드

---

## ❓ 문제 해결

### Python을 찾을 수 없다는 오류
```
'python'은(는) 내부 또는 외부 명령, 실행할 수 있는 프로그램, 또는 배치 파일이 아닙니다.
```

**해결:**
1. Python 재설치 시 "Add Python to PATH" 체크
2. 또는 환경 변수에 Python 경로 추가

### 포트가 이미 사용 중
```
ERROR: [Errno 10048] error while attempting to bind on address
```

**해결:**
`.env` 파일에서 포트 변경:
```env
PORT=8080
```

그리고 브라우저에서 `http://localhost:8080` 접속

### 패키지 설치 오류

**해결:**
```cmd
# pip 업그레이드
python -m pip install --upgrade pip

# 패키지 재설치
pip install -r requirements.txt
```

---

## 📂 폴더 구조

```
gktjcks1977/
├── run.bat              ⭐ 이 파일을 실행하세요!
├── backend/             (서버 코드)
├── frontend/            (웹 페이지)
├── static/generated/    (생성된 포스터 저장)
└── README.md
```

---

## 🎨 생성 예시

- **봄맞이 세일** (Vibrant + Colorful)
- **Winter Sale** (Elegant + Minimalist)
- **80s Party** (Retro + Gradient)
- **카페 오픈** (Casual + Colorful)

---

## 💡 팁

1. **서버 종료**: `Ctrl + C` 누르기
2. **자동 새로고침**: 코드 수정하면 자동으로 서버 재시작
3. **포스터 저장 위치**: `static/generated/` 폴더

---

## 📞 도움이 필요하신가요?

이슈 등록: https://github.com/sunstory77-hub/gktjcks1977/issues

---

**즐거운 포스터 제작 되세요!** 🎨✨
