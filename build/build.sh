#!/usr/bin/env bash
# DETAIL PAGE AI Windows 설치 EXE 빌드 (Linux/macOS 에서 크로스 빌드). 필요: makensis, curl, unzip, python3(Pillow), pandoc
set -euo pipefail
# makensis 는 한글 파일명을 다루려면 UTF-8 로케일이 필요하다(C 로케일에서는 비정상 종료).
export LC_ALL=C.UTF-8 LANG=C.UTF-8
cd "$(dirname "$0")/.."
ROOT="$PWD"
VERSION="$(node -p "require('./package.json').version")"
VERSION4="${VERSION}.0"
NODE_VER="${NODE_VER:-22.22.0}"
CACHE="build/cache"; STAGE="build/stage"; DIST="dist"
mkdir -p "$CACHE" "$DIST"
rm -rf "$STAGE"; mkdir -p "$STAGE/app" "$STAGE/runtime"

echo "▶ 1/6 Node.js ${NODE_VER} (win-x64) 확인"
ZIP="node-v${NODE_VER}-win-x64.zip"
if [ ! -f "$CACHE/$ZIP" ]; then curl -fsSL -o "$CACHE/$ZIP" "https://nodejs.org/dist/v${NODE_VER}/$ZIP"; fi
curl -fsSL -o "$CACHE/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VER}/SHASUMS256.txt"
EXPECT="$(grep " $ZIP\$" "$CACHE/SHASUMS256.txt" | cut -d' ' -f1)"
ACTUAL="$(sha256sum "$CACHE/$ZIP" | cut -d' ' -f1)"
[ -n "$EXPECT" ] && [ "$EXPECT" = "$ACTUAL" ] || { echo "Node.js 체크섬 불일치"; exit 1; }
echo "  sha256 OK $ACTUAL"
unzip -p "$CACHE/$ZIP" "node-v${NODE_VER}-win-x64/node.exe" > "$STAGE/runtime/node.exe"
unzip -p "$CACHE/$ZIP" "node-v${NODE_VER}-win-x64/LICENSE" > "$STAGE/runtime/LICENSE-node.txt"

echo "▶ 2/6 앱 파일 복사(사용자 자료·키·테스트 사진·개발 파일 제외)"
cp package.json "$STAGE/app/"
cp -r src public "$STAGE/app/"
cp LICENSES.md "$STAGE/LICENSES.md"
cp build/app.ico "$STAGE/app.ico"
# 배포물에 들어가면 안 되는 것 점검
if find "$STAGE" \( -name "*.test.js" -o -name "mock-gemini.js" -o -name "project.json" -o -name "instance.json" -o -name ".env*" -o -name "*.log" \) | grep -q .; then echo "배포 금지 파일이 섞였습니다"; exit 1; fi

echo "▶ 3/6 사용 설명서 HTML"
python3 build/make-icon.py build >/dev/null
pandoc docs/사용설명서.md -s --metadata title="DETAIL PAGE AI 사용 설명서" -c build/manual.css --embed-resources -o "$STAGE/사용설명서.html" 2>/dev/null || pandoc docs/사용설명서.md -s --self-contained -c build/manual.css -o "$STAGE/사용설명서.html"

echo "▶ 4/6 실행기 (콘솔 없이 시작)"
makensis -V1 -DOUTFILE="$ROOT/$STAGE/DETAIL PAGE AI.exe" -DVERSION="$VERSION" -DVERSION4="$VERSION4" build/launcher.nsi

echo "▶ 5/6 설치 프로그램"
OUT="DETAIL_PAGE_AI_Setup_v${VERSION}.exe"
( cd build && python3 gen-files.py stage files.nsh && makensis -V1 -DOUTFILE="$ROOT/$DIST/$OUT" -DVERSION="$VERSION" -DVERSION4="$VERSION4" installer.nsi )

echo "▶ 6/6 결과"
sha256sum "$DIST/$OUT" | tee "$DIST/$OUT.sha256"
ls -la "$DIST/$OUT"
