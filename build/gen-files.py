#!/usr/bin/env python3
"""stage/app 의 파일 목록을 NSIS 설치 명령(files.nsh)으로 만든다. (File /r 대신 명시적 목록 사용)"""
import os, sys
stage = sys.argv[1]; out = sys.argv[2]
lines = ['; 자동 생성 — 수정하지 마세요']
for root, dirs, files in sorted(os.walk(os.path.join(stage, 'app'))):
    dirs.sort()
    rel = os.path.relpath(root, stage).replace('/', '\\')
    lines.append('SetOutPath "$INSTDIR\\%s"' % rel)
    for f in sorted(files):
        p = os.path.join(root, f).replace('\\', '/')
        lines.append('File "%s"' % p)
open(out, 'w', encoding='utf-8-sig').write('\n'.join(lines) + '\n')
print('files.nsh:', sum(1 for l in lines if l.startswith('File ')), '개 파일')
