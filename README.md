# 홍보포스터 자동제작 앱

텍스트 입력만으로 AI를 활용하여 전문적인 홍보 포스터를 자동으로 생성하는 웹 애플리케이션입니다.

## 기능

- 📝 간단한 텍스트 입력으로 포스터 생성
- 🎨 다양한 테마와 스타일 선택
- 🤖 Google Gemini (NanoBanana) API 기반 AI 이미지 생성
- 💾 포스터 PNG 파일 다운로드
- 📱 반응형 디자인 (모바일/태블릿/데스크톱 지원)

## 기술 스택

- **Backend**: Python 3.11+, FastAPI
- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **AI**: Google Gemini API (gemini-2.5-flash-image)
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

`.env.example` 파일을 `.env`로 복사하고 Google API 키를 설정합니다:

```bash
cp .env.example .env
```

`.env` 파일을 편집하여 API 키를 입력:

```env
GOOGLE_API_KEY=your_api_key_here
```

> **Google API 키 발급 방법:**
> 1. [Google AI Studio](https://aistudio.google.com/app/apikey) 방문
> 2. "Create API Key" 클릭
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
3. **테마 선택** (선택): 프로페셔널, 캐주얼, 활기찬 등의 테마를 선택합니다
4. **스타일 선택** (선택): 미니멀, 대담한, 우아한 등의 시각 스타일을 선택합니다
5. **추가 지시사항** (선택): 특별한 요구사항을 입력합니다
6. **포스터 생성 버튼 클릭**: 5-15초 정도 기다리면 포스터가 생성됩니다
7. **다운로드**: 생성된 포스터를 PNG 파일로 다운로드합니다

## API 엔드포인트

### `GET /api/health`
서버 상태 확인

**응답:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-12T10:30:00Z"
}
```

### `POST /api/generate-poster`
포스터 생성 요청

**요청 본문:**
```json
{
  "title": "여름 세일",
  "description": "최대 50% 할인",
  "theme": "vibrant",
  "style": "bold",
  "additional_instructions": "밝고 화려한 색상 사용"
}
```

**응답:**
```json
{
  "success": true,
  "image_url": "/static/generated/xxx.png",
  "generation_time": 8.42,
  "prompt_used": "Create a professional promotional poster..."
}
```

## 프로젝트 구조

```
/home/user/gktjcks1977/
├── backend/                    # 백엔드 소스 코드
│   ├── main.py                # FastAPI 애플리케이션
│   ├── config.py              # 환경 설정
│   ├── models.py              # Pydantic 모델
│   ├── services/
│   │   └── image_generator.py # Gemini API 통합
│   └── utils/
│       └── validators.py      # 입력 검증
├── frontend/                   # 프론트엔드 소스 코드
│   ├── index.html             # 메인 HTML
│   ├── css/
│   │   └── styles.css         # 스타일시트
│   └── js/
│       └── app.js             # JavaScript 로직
├── static/                     # 정적 파일
│   └── generated/             # 생성된 이미지 저장소
├── .env                       # 환경 변수 (gitignored)
├── .env.example               # 환경 변수 예제
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

## 문제 해결

### API 키 오류
- `.env` 파일이 존재하고 `GOOGLE_API_KEY`가 올바르게 설정되어 있는지 확인
- Google AI Studio에서 API 키가 활성화되어 있는지 확인

### 포트 충돌
- 이미 8000 포트가 사용 중이라면 `.env`에서 다른 포트로 변경:
```env
PORT=8080
```

### 이미지 생성 실패
- 인터넷 연결 상태 확인
- Google API 사용량 할당량 확인
- 입력한 텍스트가 적절한지 확인 (부적절한 내용 필터링)

## 라이선스

MIT License

## 참고 자료

- [Google Gemini API 문서](https://ai.google.dev/gemini-api/docs/image-generation)
- [FastAPI 공식 문서](https://fastapi.tiangolo.com/)
- [NanoBanana 가이드](https://carat.im/blog/nano-banana-ai-guide)

## 기여

이슈나 풀 리퀘스트를 환영합니다!
