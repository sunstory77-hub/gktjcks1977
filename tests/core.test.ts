import { describe, expect, it } from 'vitest';
import { wrapText } from '../src/core/text';
import { frameAt, motionTransform, totalDuration } from '../src/core/timeline';
import { TEMPLATES, templatesFor } from '../src/core/templates';
import { FORMATS } from '../src/core/formats';
import { hitTest, moveLayer, newProject, updateLayer } from '../src/core/project';
import { page, shapeLayer, clonePage } from '../src/core/layers';
import { dateStamp, safeName } from '../src/core/export';
import { projectFromJson, projectToJson } from '../src/core/storage';
import { fontString, snapWeight } from '../src/core/render';

const mono = (s: string) => [...s].length * 10; // 글자당 10px

describe('wrapText', () => {
  it('단어 단위로 줄바꿈', () => {
    expect(wrapText('aaa bbb ccc', 75, mono)).toEqual(['aaa bbb', 'ccc']);
  });
  it('사용자 줄바꿈 유지', () => {
    expect(wrapText('가나\n\n다라', 1000, mono)).toEqual(['가나', '', '다라']);
  });
  it('긴 한글 단어는 글자 단위로 분할', () => {
    expect(wrapText('가나다라마바사', 30, mono)).toEqual(['가나다', '라마바', '사']);
  });
  it('모든 줄이 최대 너비 이하', () => {
    const lines = wrapText('업무시간 절반 줄이는 ChatGPT 활용법 세 가지를 알려드립니다', 120, mono);
    for (const l of lines) expect(mono(l)).toBeLessThanOrEqual(120);
    expect(lines.join('').replace(/\s/g, '')).toBe('업무시간절반줄이는ChatGPT활용법세가지를알려드립니다');
  });
});

describe('timeline', () => {
  const pages = [
    { duration: 2, transition: 'fade' as const },
    { duration: 3, transition: 'fade' as const },
    { duration: 1, transition: 'none' as const },
  ];
  it('총 길이', () => expect(totalDuration(pages)).toBe(6));
  it('첫 페이지에는 전환 없음', () => expect(frameAt(pages, 0.1)).toMatchObject({ index: 0, transition: null }));
  it('두 번째 페이지 시작부는 전환 중', () => {
    const f = frameAt(pages, 2.25);
    expect(f.index).toBe(1);
    expect(f.transition).toBeCloseTo(0.5);
  });
  it('전환 none 이면 전환 없음', () => expect(frameAt(pages, 5.1)).toMatchObject({ index: 2, transition: null }));
  it('끝을 넘어서면 마지막 페이지', () => expect(frameAt(pages, 99)).toMatchObject({ index: 2, progress: 1 }));
  it('모션', () => {
    expect(motionTransform('zoom-in', 0).scale).toBe(1);
    expect(motionTransform('zoom-in', 1).scale).toBeCloseTo(1.12);
    expect(motionTransform('zoom-out', 1).scale).toBeCloseTo(1);
    expect(motionTransform('pan', 0.5).dx).toBeCloseTo(0);
  });
});

describe('templates', () => {
  it('모든 포맷에 템플릿이 1개 이상', () => {
    for (const f of FORMATS) expect(templatesFor(f.id).length).toBeGreaterThan(0);
  });
  it('템플릿은 매번 새 id로 생성되고 레이어가 캔버스 안에 위치', () => {
    for (const t of TEMPLATES) {
      const a = t.build();
      const b = t.build();
      expect(a[0].id).not.toBe(b[0].id);
      const fmt = FORMATS.find((f) => f.id === t.formatId)!;
      for (const p of a) {
        const H = p.height ?? fmt.height;
        for (const l of p.layers) {
          expect(l.x, `${t.id}/${l.name}`).toBeGreaterThanOrEqual(0);
          expect(l.x + l.w, `${t.id}/${l.name}`).toBeLessThanOrEqual(fmt.width);
          expect(l.y + l.h, `${t.id}/${l.name}`).toBeLessThanOrEqual(H);
        }
      }
    }
  });
});

describe('project ops', () => {
  it('hitTest 는 가장 위 레이어를 고르고 잠금/숨김은 제외', () => {
    const a = shapeLayer({ x: 0, y: 0, w: 100, h: 100 });
    const b = shapeLayer({ x: 50, y: 50, w: 100, h: 100 });
    const p = page({ layers: [a, b] });
    expect(hitTest(p, 60, 60)?.id).toBe(b.id);
    expect(hitTest({ ...p, layers: [a, { ...b, locked: true }] }, 60, 60)?.id).toBe(a.id);
    expect(hitTest(p, 500, 500)).toBeUndefined();
  });
  it('moveLayer / updateLayer', () => {
    const a = shapeLayer({});
    const b = shapeLayer({});
    const p = page({ layers: [a, b] });
    expect(moveLayer(p, a.id, 1).layers.map((l) => l.id)).toEqual([b.id, a.id]);
    expect(moveLayer(p, b.id, 1)).toBe(p);
    const prj = { ...newProject('insta-square'), pages: [p] };
    const next = updateLayer(prj, p.id, a.id, { x: 42 });
    expect(next.pages[0].layers[0].x).toBe(42);
    expect(prj.pages[0].layers[0].x).toBe(0);
  });
  it('clonePage 는 새 id', () => {
    const p = page({ layers: [shapeLayer({})] });
    const c = clonePage(p);
    expect(c.id).not.toBe(p.id);
    expect(c.layers[0].id).not.toBe(p.layers[0].id);
  });
  it('JSON 백업 왕복', () => {
    const prj = newProject('detail', 'dt-full');
    expect(projectFromJson(projectToJson(prj))).toEqual(prj);
    expect(() => projectFromJson('{"a":1}')).toThrow();
  });
});

describe('파일명', () => {
  it('dateStamp', () => expect(dateStamp(new Date(2026, 8, 30))).toBe('20260930'));
  it('safeName', () => expect(safeName(' 카드뉴스 / 3장? ')).toBe('카드뉴스_3장'));
});

describe('폰트 굵기', () => {
  it('포함되지 않은 굵기는 가까운 값으로', () => {
    expect(snapWeight('Black Han Sans', 900)).toBe(400);
    expect(snapWeight('Noto Sans KR', 800)).toBe(900);
    expect(snapWeight('Nanum Myeongjo', 900)).toBe(800);
    expect(fontString({ fontFamily: 'Jua', fontWeight: 700, fontSize: 40 })).toMatch(/^400 40px "Jua"/);
  });
});
