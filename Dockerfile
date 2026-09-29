# 홍보공장 앱 배포 이미지 (렌더 엔진 poc + 웹 앱 app)
# 빌드: docker build -t promo-factory .
# 실행: docker compose up -d  (docker-compose.yml 참고)
FROM node:22-bookworm-slim

# 릴스 렌더(HyperFrames)가 쓰는 Chromium과 한국어 글꼴·필수 라이브러리
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-noto-cjk ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5180 \
    DATA_DIR=/data

WORKDIR /srv
# 저장소에 package-lock.json이 없어 npm install을 쓴다(잠금 파일을 추가하면 npm ci로 바꿀 것)
COPY poc/package.json ./poc/
RUN cd poc && npm install --omit=dev --no-audit --no-fund
COPY app/package.json ./app/
RUN cd app && npm install --omit=dev --no-audit --no-fund
COPY poc ./poc
COPY app ./app

# 데이터(DB·회사 파일)는 볼륨에. 마스터 키는 APP_MASTER_KEY 환경 변수로(운영 필수)
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:5180/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /srv/app
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
