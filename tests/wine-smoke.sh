#!/usr/bin/env bash
# wine(Windows 호환 계층) 위에서 설치 EXE 를 실제로 실행해 보는 스모크 테스트.
# 한계: wine 9 에서는 Node 의 '외부로 나가는 TCP 연결'이 실패해(connect UNKNOWN) Gemini 호출·모의 서버 연결은 시험할 수 없다.
set -uo pipefail
export LC_ALL=C.UTF-8 LANG=C.UTF-8 WINEDEBUG=-all
EXE="$(realpath "${1:-dist/DETAIL_PAGE_AI_Setup_v1.0.0.exe}")"
export WINEPREFIX="${WINEPREFIX:-$(mktemp -d)/wine}" DISPLAY="${DISPLAY:-:99}"
pgrep -x Xvfb >/dev/null || { Xvfb "$DISPLAY" -screen 0 1280x800x24 >/dev/null 2>&1 & sleep 1; }
mkdir -p "$WINEPREFIX"
wineboot -u >/dev/null 2>&1
LOCAL="$WINEPREFIX/drive_c/users/root/AppData/Local"; INST="$LOCAL/Programs/DETAIL PAGE AI"; DATA="$LOCAL/DETAIL PAGE AI"
PORT=47831; pass=0; failn=0
t() { if [ "$2" = "ok" ]; then echo "✔ $1"; pass=$((pass+1)); else echo "✘ $1 — $3"; failn=$((failn+1)); fi; }
health() { curl -s -m 2 "http://127.0.0.1:$PORT/api/health"; }
jget() { python3 -c "import sys,json;print(json.load(sys.stdin)$1)"; }
waitup() { for i in $(seq 1 25); do sleep 1; [ -n "$(health)" ] && return 0; done; return 1; }
waitdown() { for i in $(seq 1 15); do sleep 1; [ -z "$(health)" ] && return 0; done; return 1; }

timeout 150 wine "$EXE" /S >/dev/null 2>&1
[ -f "$INST/runtime/node.exe" ] && [ -f "$INST/DETAIL PAGE AI.exe" ] && [ -f "$INST/app/src/server.js" ] && t "설치(관리자 권한 없이 사용자 폴더에 설치)" ok || t "설치" fail "파일 없음"
[ -f "$LOCAL/../../Desktop/DETAIL PAGE AI.lnk" ] && t "바탕화면 바로가기 생성" ok || t "바탕화면 바로가기" fail "없음"
[ -f "$WINEPREFIX/drive_c/users/root/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/DETAIL PAGE AI/DETAIL PAGE AI.lnk" ] && t "시작 메뉴 바로가기 생성" ok || t "시작 메뉴 바로가기" fail "없음"
wine reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DETAIL PAGE AI' 2>/dev/null | grep -q "BAPI" && t "앱 및 기능에 제거 항목 등록(게시자 BAPI)" ok || t "제거 항목" fail "없음"

(cd "$INST" && nohup wine "DETAIL PAGE AI.exe" --no-open >/dev/null 2>&1 &)
if waitup; then
  H="$(health)"; t "실행기 → 번들 Node → 서버 시작(콘솔 창 없는 실행기)" ok
  p1=$(echo "$H" | jget "['pid']")
  [ "$(echo "$H" | jget "['version']")" = "1.0.0" ] && t "버전 응답 1.0.0" ok || t "버전" fail "$H"
  curl -s "http://127.0.0.1:$PORT/" | grep -q "DETAIL PAGE AI" && t "화면(HTML) 제공" ok || t "화면" fail "없음"
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.test' http://127.0.0.1:$PORT/api/health)" = "403" ] && t "다른 Host 거부" ok || t "Host 검증" fail "거부 안 됨"
  [ -f "$DATA/instance.json" ] && [ -d "$DATA/projects" ] && t "작업 자료 폴더는 설치 폴더 밖(%LOCALAPPDATA%\\DETAIL PAGE AI)" ok || t "자료 폴더" fail "없음"
  case "$INST" in "$DATA"*) t "자료 폴더 분리" fail "설치 폴더 안";; *) t "자료·설치 폴더 분리 확인" ok;; esac
  TOKEN=$(curl -s http://127.0.0.1:$PORT/ | grep -o 'dpa-token" content="[a-f0-9]*' | cut -d'"' -f3)
  PID_PROJ=$(curl -s -H "x-dpa-token: $TOKEN" http://127.0.0.1:$PORT/api/projects/current | jget "['project']['id']")
  (cd "$INST" && timeout 30 wine "DETAIL PAGE AI.exe" --no-open >/dev/null 2>&1)
  p2=$(health | jget "['pid']")
  [ "$p1" = "$p2" ] && t "중복 실행: 기존 실행본 재사용(PID 동일)" ok || t "중복 실행" fail "$p1 → $p2"
  timeout 150 wine "$EXE" /S >/dev/null 2>&1; sleep 2
  [ -z "$(health)" ] && t "실행 중 업데이트: 이전 실행본 자동 종료 후 재설치" ok || t "업데이트 시 종료" fail "계속 실행 중"
  [ -d "$DATA/projects/$PID_PROJ" ] && t "업데이트 후 사용자 프로젝트 보존" ok || t "자료 보존" fail "사라짐"
  (cd "$INST" && nohup wine "DETAIL PAGE AI.exe" --no-open >/dev/null 2>&1 &); waitup && t "재설치 후 다시 실행" ok || t "재실행" fail "응답 없음"
  (cd "$INST" && timeout 30 wine "DETAIL PAGE AI.exe" --quit >/dev/null 2>&1); waitdown && t "종료 바로가기(--quit)로 정상 종료" ok || t "--quit" fail "계속 실행 중"
  [ ! -f "$DATA/instance.json" ] && t "종료 후 instance.json 정리" ok || t "instance.json" fail "남음"
else
  t "서버 시작" fail "25초 내 응답 없음"
fi
(cd "$INST" && timeout 100 wine ./Uninstall.exe /S >/dev/null 2>&1); for i in $(seq 1 30); do sleep 1; [ ! -d "$INST" ] && break; done
[ ! -d "$INST" ] && t "제거: 설치 폴더 삭제" ok || t "제거" fail "폴더 남음"
[ -z "$(find "$WINEPREFIX/drive_c/users" -name '*.lnk' 2>/dev/null)" ] && t "제거: 바로가기 삭제" ok || t "바로가기 삭제" fail "남음"
wine reg query 'HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DETAIL PAGE AI' >/dev/null 2>&1 && t "제거: 레지스트리 정리" fail "남음" || t "제거: 레지스트리 정리" ok
[ -d "$DATA/projects" ] && t "제거(무인): 사용자 자료는 기본 보존" ok || t "자료 보존" fail "삭제됨"
wineserver -k 2>/dev/null
echo "=== wine 스모크 ${pass}개 통과, 실패 ${failn} ==="; exit $failn
