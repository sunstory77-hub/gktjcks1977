#!/usr/bin/env bash
# 설치 EXE 내용 점검: 사용자 자료·인증키·테스트 사진·개발 파일이 들어 있지 않은지 확인한다.
set -euo pipefail
export LC_ALL=C.UTF-8 LANG=C.UTF-8
EXE="${1:-dist/DETAIL_PAGE_AI_Setup_v1.0.0.exe}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
file "$EXE" | grep -q "PE32+ executable.*x86-64" && echo "✔ 64비트 Windows 실행 파일"
7z x -y -o"$TMP" "$EXE" >/dev/null
echo "── 포함된 파일(상위 구조)"; (cd "$TMP" && find . -type f | grep -v '^./\$' | sort | sed 's|^\./||' | head -60)
fail=0
chk() { if eval "$2"; then echo "✘ $1"; fail=1; else echo "✔ $1"; fi; }
# 공식 node.exe(체크섬 검증 완료)는 바이너리 안의 무관한 base64 조각이 키 패턴과 우연히 겹쳐 제외한다.
chk "API 키 문자열(AIza…, *_KEY_AAAA) 없음(node.exe 제외)" "grep -rEal --exclude=node.exe 'AIza[0-9A-Za-z_-]{20,}|_KEY_AAAAAAAA' '$TMP' >/dev/null 2>&1"
chk "프로젝트·인스턴스·로그 파일 없음" "find '$TMP' \\( -name 'project.json' -o -name 'instance.json' -o -name 'state.json' -o -name '*.log' -o -name 'app.log' \\) | grep -q ."
chk "테스트 코드·모의 서버·테스트 사진 없음" "find '$TMP' \\( -name '*.test.js' -o -name 'mock-gemini.js' -o -name 'photo*.png' -o -path '*tests*' \\) | grep -q ."
chk ".env·개인 키 파일 없음" "find '$TMP' \\( -name '.env*' -o -name '*.pem' -o -name 'id_rsa*' \\) | grep -q ."
chk "소스 맵·.git 없음" "find '$TMP' \\( -name '*.map' -o -name '.git' \\) | grep -q ."
test -f "$TMP/runtime/node.exe" && echo "✔ 번들 Node.js 런타임 포함(별도 설치 불필요)"
test -f "$TMP/runtime/LICENSE-node.txt" && echo "✔ Node.js 라이선스 포함"
find "$TMP" -name 'Pretendard-LICENSE-OFL.txt' | grep -q . && echo "✔ Pretendard OFL 라이선스 포함"
find "$TMP" -name 'LICENSES.md' | grep -q . && echo "✔ LICENSES.md 포함"
grep -rq 'server.listen(port, .127.0.0.1.)' "$TMP/app/src/server.js" && echo "✔ 127.0.0.1 전용 바인딩 코드 포함"
exit $fail
