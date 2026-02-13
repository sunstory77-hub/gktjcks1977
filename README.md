# 홍보포스터 자동제작 앱

텍스트 입력만으로 AI를 활용하여 전문적인 홍보 포스터를 자동으로 생성하는 웹 애플리케이션입니다.

## 기능

- 📝 간단한 텍스트 입력으로 포스터 생성
- 🎨 다양한 테마와 스타일 선택 (6가지 테마 × 6가지 스타일)
- 🤖 OpenAI DALL-E API 기반 AI 이미지 생성 (프로덕션)
- 🎯 PIL/Pillow 기반 데모 포스터 생성 (개발/테스트)
- 💾 포스터 PNG 파일 다운로드
- 📱 반응형 디자인 (모바일/태블릿/데스크톱 지원)
- ⚡ 빠른 생성 속도 (0.03~0.16초, 데모 모드)

## 기술 스택

- **Backend**: Python 3.11+, FastAPI, Pydantic
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **AI (Production)**: OpenAI DALL-E 3
- **AI (Demo)**: PIL/Pillow
- **Server**: Uvicorn

## 설치 방법

### 1. 저장소 클론

```bash
git clone <repository-url>
cd gktjcks1977
```

### 2. 가상환경 생성 및 활성화

```bash
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# 또는
venv\Scripts\activate  # Windows
```

### 3. 의존성 설치

```bash
pip install -r requirements.txt
```

### 4. 환경 변수 설정

`.env` 파일을 생성하고 다음 내용을 추가:

```env
# OpenAI API Key (프로덕션 환경용)
# Get your API key from: https://platform.openai.com/api-keys
OPENAI_API_KEY=your_openai_api_key_here

# Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=False

# Image Generation Settings
IMAGE_WIDTH=1024
IMAGE_HEIGHT=1024
MAX_RETRIES=3
TIMEOUT_SECONDS=30

# Storage Settings
STATIC_DIR=static/generated
MAX_STORED_IMAGES=100
```

> **OpenAI API 키 발급 방법:**
> 1. [OpenAI Platform](https://platform.openai.com/api-keys) 방문
> 2. "Create new secret key" 클릭
> 3. 생성된 API 키를 복사하여 `.env` 파일에 붙여넣기

### 5. 실행

#### 방법 1: 자동 실행 스크립트 사용 (권장)

```bash
chmod +x run.sh
./run.sh
```

#### 방법 2: 직접 실행

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 6. 브라우저에서 접속

웹 브라우저를 열고 다음 주소로 접속:

```
http://localhost:8000
```

## 사용 방법

1. **제목 입력** (필수): 포스터의 메인 제목을 입력합니다
2. **설명/태그라인** (선택): 부가 설명이나 태그라인을 추가합니다
3. **테마 선택** (선택):
   - Professional (프로페셔널)
   - Casual (캐주얼)
   - Vibrant (활기찬)
   - Elegant (우아한)
   - Modern (모던)
   - Retro (레트로)
4. **스타일 선택** (선택):
   - Minimalist (미니멀)
   - Bold (대담한)
   - Elegant (우아한)
   - Colorful (컬러풀)
   - Monochrome (단색)
   - Gradient (그라데이션)
5. **추가 지시사항** (선택): 특별한 요구사항을 입력합니다
6. **포스터 생성 버튼 클릭**: 즉시 포스터가 생성됩니다 (데모 모드)
7. **다운로드**: 생성된 포스터를 PNG 파일로 다운로드합니다

## 모드 설명

### 데모 모드 (현재)
- PIL/Pillow를 사용한 로컬 이미지 생성
- 인터넷 연결 불필요
- 즉시 결과 확인 가능 (0.03~0.16초)
- 테마별 색상 조합 적용
- "DEMO POSTER" 워터마크 표시

### 프로덕션 모드
- OpenAI DALL-E 3 사용
- `.env`에 유효한 `OPENAI_API_KEY` 설정 필요
- 고품질 AI 생성 포스터
- 생성 시간: 5~15초

## API 엔드포인트

### `GET /api/health`
서버 상태 확인

**응답:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-13T10:56:31.698777Z"
}
```

### `POST /api/generate-poster`
포스터 생성 요청

**요청 본문:**
```json
{
  "title": "봄맞이 특가 세일",
  "description": "신선한 시작을 위한 특별 할인",
  "theme": "vibrant",
  "style": "bold",
  "additional_instructions": "밝고 화려한 색상 사용"
}
```

**응답 (데모 모드):**
```json
{
  "success": true,
  "image_url": "/static/generated/4abd854d-9f16-437b-af36-b21f32091183.png",
  "generation_time": 0.16,
  "prompt_used": "Create a professional promotional poster..."
}
```

## 프로젝트 구조

```
gktjcks1977/
├── backend/                    # 백엔드 소스 코드
│   ├── __init__.py
│   ├── main.py                # FastAPI 애플리케이션
│   ├── config.py              # 환경 설정
│   ├── models.py              # Pydantic 모델
│   └── services/
│       ├── __init__.py
│       └── image_generator.py # 이미지 생성 서비스 (PIL/DALL-E)
├── frontend/                   # 프론트엔드 소스 코드
│   ├── index.html             # 메인 HTML
│   ├── css/
│   │   └── styles.css         # 스타일시트
│   └── js/
│       └── app.js             # JavaScript 로직
├── static/                     # 정적 파일
│   └── generated/             # 생성된 이미지 저장소
├── .env                       # 환경 변수 (gitignored)
├── .gitignore                 # Git 제외 파일 목록
├── requirements.txt           # Python 의존성
├── run.sh                     # 실행 스크립트
└── README.md                  # 프로젝트 문서
```

## 개발 모드

개발 모드로 실행하려면 `.env` 파일에서 `DEBUG=True`로 설정:

```env
DEBUG=True
```

이렇게 하면 코드 변경 시 자동으로 서버가 재시작됩니다.

## 프로덕션 배포

### OpenAI DALL-E 모드 활성화

현재는 데모 모드로 실행되고 있습니다. OpenAI DALL-E를 사용하려면:

1. `.env` 파일에 유효한 OpenAI API 키 설정
2. `backend/services/image_generator.py`를 DALL-E 버전으로 교체
3. 네트워크 프록시/방화벽 설정 확인

### Gunicorn으로 프로덕션 서버 실행

```bash
gunicorn backend.main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000
```

## 문제 해결

### API 키 오류
- `.env` 파일이 존재하고 `OPENAI_API_KEY`가 올바르게 설정되어 있는지 확인
- OpenAI Platform에서 API 키가 활성화되어 있는지 확인

### 포트 충돌
- 이미  8000 포트가 사용 중이라면 `.env`에서 다른 포트로 변경:
```env
PORT=8080
```

### 이미지 생성 실패
- 데모 모드: 서버 로그 확인, PIL/Pillow 설치 확인
- 프로덕션 모드: 인터넷 연결 상태, OpenAI API 사용량 할당량 확인

## 테스트 결과

### 데모 모드 성능
- ✅ 평균 생성 시간: 0.03~0.16초
- ✅ 6가지 테마 × 6가지 스타일 지원
- ✅ 1024x1024 PNG 이미지 생성
- ✅ 자동 이미지 정리 (최대 100개 보관)

### 생성 예시
```
1. 봄맞이 특가 세일 (vibrant + bold) - 11KB, 0.16초
2. 겨울 대축제 (elegant + minimalist) - 13KB, 0.03초
3. Summer Festival (modern + colorful) - 26KB, 0.03초
```

## 라이선스

MIT License

## 참고 자료

- [OpenAI DALL-E API 문서](https://platform.openai.com/docs/guides/images)
- [FastAPI 공식 문서](https://fastapi.tiangolo.com/)
- [PIL/Pillow 문서](https://pillow.readthedocs.io/)

## 기여

이슈나 풀 리퀘스트를 환영합니다!

---

Built with ❤️ using FastAPI and OpenAI DALL-E (Demo: PIL/Pillow)
