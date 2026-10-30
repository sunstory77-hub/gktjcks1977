'use strict';
/* 이미 실행 중인 앱(예: wine 에 설치한 번들 Windows node.exe)에 대해 번역 검수 패키지 API 를 점검한다.
   사용: E2E_EXTERNAL_URL=http://127.0.0.1:47831/ node tests/wine-i18n-api.js  (AI 호출 없음) */
const { getToken, apiClient } = require('./harness.js');
const X = require('../src/xlsx.js');
const { makeProject } = require('./fixtures/sample-project.js');
const url = new URL(process.env.E2E_EXTERNAL_URL || 'http://127.0.0.1:47831/');
let fail = 0;
const t = (name, ok, detail) => { console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fail++; };
(async () => {
  const port = Number(url.port);
  const api = apiClient(port, await getToken(port));
  const proj = (await api.post('/api/projects', {})).json.project;
  const put = await api.put(`/api/projects/${proj.id}`, { project: { ...makeProject(), id: proj.id }, baseRev: proj.rev });
  t('번역·용어집이 든 프로젝트 저장', put.status === 200);
  const cur = (await api.get(`/api/projects/${proj.id}`)).json.project;
  t('서버가 i18n 을 보존', cur.i18n.langs.join() === 'en,ja' && cur.i18n.glossary.length === 1 && Object.keys(cur.i18n.data.en.blocks).length >= 5);
  const ex = await api.post(`/api/projects/${proj.id}/review/export`, { langs: ['en', 'ja'], format: 'xlsx' });
  t('검수 패키지(XLSX) 생성', ex.status === 200 && /spreadsheetml/.test(ex.headers['content-type']), `${ex.buf.length}B`);
  let book; try { book = X.parseXlsx(ex.buf); } catch (e) { t('XLSX 읽기', false, e.message); }
  t('시트 구성(안내·EN·JA·용어집·시장정보)', book && Object.keys(book).join() === '안내,EN,JA,용어집,시장정보');
  const imp = await api.call('POST', `/api/projects/${proj.id}/review/import`, ex.buf, { 'content-type': 'application/octet-stream', 'x-dpa-filename': encodeURIComponent('검수.xlsx') });
  t('검수 결과 가져오기(변경 0건)', imp.status === 200 && imp.json.summary.changed === 0 && imp.json.langs.join() === 'en,ja', imp.text.slice(0, 80));
  const x = await api.post(`/api/projects/${proj.id}/review/export`, { langs: ['en', 'ja'], format: 'xliff' });
  t('XLIFF ZIP 생성', x.status === 200 && /zip/.test(x.headers['content-type']));
  const bk = await api.get(`/api/projects/${proj.id}/backup`);
  const back = await api.call('POST', '/api/projects/import', Buffer.from(bk.text), { 'content-type': 'application/json' });
  t('백업·복원에 번역 포함', back.status === 200 && back.json.project.i18n.langs.join() === 'en,ja');
  const font = await fetch(`http://127.0.0.1:${port}/fonts/noto-sans-jp/index.css`);
  const css = await font.text();
  t('일본어 글꼴 CSS 제공', font.status === 200 && /Noto Sans JP Variable/.test(css));
  const slice = css.match(/url\(\.\/files\/([^)]+)\)/);
  const sf = await fetch(`http://127.0.0.1:${port}/fonts/noto-sans-jp/files/${slice[1]}`);
  t('글꼴 파일(woff2) 제공', sf.status === 200 && (await sf.arrayBuffer()).byteLength > 1000, slice[1]);
  console.log(fail ? `=== 실패 ${fail} ===` : '=== 모두 통과 ===');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('오류', e.message); process.exit(2); });
