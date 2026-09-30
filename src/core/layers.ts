import { uid } from './id';
import type { Fill, ImageLayer, Page, ShapeLayer, TextLayer } from './types';

type Partial2<T> = Partial<Omit<T, 'id' | 'type'>>;

export function textLayer(p: Partial2<TextLayer> & { text: string }): TextLayer {
  return {
    id: uid('t'),
    type: 'text',
    name: p.text.split('\n')[0].slice(0, 16) || '텍스트',
    x: 80,
    y: 80,
    w: 600,
    h: 100,
    rotation: 0,
    opacity: 1,
    fontFamily: 'Noto Sans KR',
    fontSize: 64,
    fontWeight: 700,
    color: '#111111',
    align: 'left',
    lineHeight: 1.3,
    letterSpacing: 0,
    ...p,
  };
}

export function imageLayer(p: Partial2<ImageLayer>): ImageLayer {
  return {
    id: uid('i'),
    type: 'image',
    name: '사진',
    x: 0,
    y: 0,
    w: 400,
    h: 400,
    rotation: 0,
    opacity: 1,
    src: '',
    fit: 'cover',
    radius: 0,
    brightness: 100,
    contrast: 100,
    saturate: 100,
    blur: 0,
    grayscale: 0,
    ...p,
  };
}

export function shapeLayer(p: Partial2<ShapeLayer>): ShapeLayer {
  return {
    id: uid('s'),
    type: 'shape',
    name: p.shape === 'ellipse' ? '원' : '도형',
    x: 0,
    y: 0,
    w: 300,
    h: 300,
    rotation: 0,
    opacity: 1,
    shape: 'rect',
    fill: { kind: 'solid', color: '#4f46e5' },
    radius: 0,
    ...p,
  };
}

export const solid = (color: string): Fill => ({ kind: 'solid', color });
export const linear = (from: string, to: string, angle = 135): Fill => ({ kind: 'linear', from, to, angle });

export function page(p: Partial<Omit<Page, 'id'>> = {}): Page {
  return {
    id: uid('p'),
    background: solid('#ffffff'),
    layers: [],
    duration: 3,
    transition: 'fade',
    motion: 'zoom-in',
    ...p,
  };
}

/** 페이지를 새 id로 깊은 복제 */
export function clonePage(src: Page): Page {
  const copy: Page = JSON.parse(JSON.stringify(src));
  copy.id = uid('p');
  copy.layers = copy.layers.map((l) => ({ ...l, id: uid(l.type[0]) }));
  return copy;
}
