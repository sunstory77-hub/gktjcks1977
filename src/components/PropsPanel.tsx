import type { RefObject } from 'react';
import type { FormatId, ImageLayer, Layer, Page, ShapeLayer, TextLayer } from '../core/types';
import { Check, Color, FillEditor, Num, Select } from './Controls';

export const FONTS: [string, string][] = [
  ['Noto Sans KR', '본고딕 (Noto Sans KR)'],
  ['Black Han Sans', '검은고딕 (Black Han Sans)'],
  ['Jua', '주아 (Jua)'],
  ['Nanum Myeongjo', '나눔명조'],
  ['Gowun Dodum', '고운돋움'],
];

interface Props {
  formatId: FormatId;
  page: Page;
  layer: Layer | null;
  onPage: (patch: Partial<Page>) => void;
  onLayer: (patch: Partial<Layer>) => void;
  onReplaceImage: () => void;
  textRef: RefObject<HTMLTextAreaElement | null>;
}

export default function PropsPanel({ formatId, page, layer, onPage, onLayer, onReplaceImage, textRef }: Props) {
  if (!layer) {
    return (
      <div className="props" data-testid="page-props">
        <h3>페이지 설정</h3>
        <FillEditor label="배경" fill={page.background} onChange={(background) => onPage({ background })} />
        {formatId === 'detail' && (
          <Num label="섹션 높이" value={page.height ?? 1200} min={200} max={6000} step={10} onChange={(height) => onPage({ height })} />
        )}
        <h4>영상 내보내기 설정</h4>
        <Num label="길이(초)" value={page.duration} min={0.5} max={30} step={0.5} onChange={(duration) => onPage({ duration })} />
        <Select
          label="전환"
          value={page.transition}
          options={[
            ['none', '없음'],
            ['fade', '페이드'],
            ['slide', '슬라이드'],
          ]}
          onChange={(transition) => onPage({ transition })}
        />
        <Select
          label="모션"
          value={page.motion}
          options={[
            ['none', '고정'],
            ['zoom-in', '줌 인'],
            ['zoom-out', '줌 아웃'],
            ['pan', '좌→우 이동'],
          ]}
          onChange={(motion) => onPage({ motion })}
        />
        <p className="muted small">캔버스에서 요소를 클릭하면 요소 설정이 열립니다.</p>
      </div>
    );
  }

  return (
    <div className="props" data-testid="layer-props">
      <h3>{layer.type === 'text' ? '텍스트' : layer.type === 'image' ? '사진' : '도형'}</h3>
      {layer.type === 'text' && <TextProps l={layer} on={onLayer} textRef={textRef} />}
      {layer.type === 'image' && <ImageProps l={layer} on={onLayer} onReplace={onReplaceImage} />}
      {layer.type === 'shape' && <ShapeProps l={layer} on={onLayer} />}
      <h4>배치</h4>
      <div className="grid2">
        <Num label="X" value={layer.x} onChange={(x) => onLayer({ x })} />
        <Num label="Y" value={layer.y} onChange={(y) => onLayer({ y })} />
        <Num label="너비" value={layer.w} min={10} onChange={(w) => onLayer({ w })} />
        {layer.type !== 'text' && <Num label="높이" value={layer.h} min={10} onChange={(h) => onLayer({ h })} />}
      </div>
      <Num label="회전" value={layer.rotation} min={-180} max={180} slider onChange={(rotation) => onLayer({ rotation })} />
      <Num label="투명도" value={layer.opacity} min={0} max={1} step={0.05} slider onChange={(opacity) => onLayer({ opacity })} />
    </div>
  );
}

function TextProps({ l, on, textRef }: { l: TextLayer; on: (p: Partial<TextLayer>) => void; textRef: RefObject<HTMLTextAreaElement | null> }) {
  return (
    <>
      <textarea ref={textRef} data-testid="text-input" rows={4} value={l.text} onChange={(e) => on({ text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 16) || '텍스트' })} />
      <Select label="글꼴" value={l.fontFamily} options={FONTS} onChange={(fontFamily) => on({ fontFamily })} />
      <div className="grid2">
        <Num label="크기" value={l.fontSize} min={8} max={400} onChange={(fontSize) => on({ fontSize })} />
        <Select
          label="굵기"
          value={String(l.fontWeight)}
          options={[
            ['400', '보통'],
            ['700', '굵게'],
            ['900', '아주 굵게'],
          ]}
          onChange={(v) => on({ fontWeight: Number(v) })}
        />
      </div>
      <Color label="글자색" value={l.color} onChange={(color) => on({ color })} />
      <Select
        label="정렬"
        value={l.align}
        options={[
          ['left', '왼쪽'],
          ['center', '가운데'],
          ['right', '오른쪽'],
        ]}
        onChange={(align) => on({ align })}
      />
      <div className="grid2">
        <Num label="줄간격" value={l.lineHeight} min={0.8} max={3} step={0.05} onChange={(lineHeight) => on({ lineHeight })} />
        <Num label="자간" value={l.letterSpacing} min={-10} max={50} onChange={(letterSpacing) => on({ letterSpacing })} />
      </div>
      <h4>효과</h4>
      <Check label="그림자" value={!!l.shadow} onChange={(shadow) => on({ shadow })} />
      <Check label="외곽선" value={!!l.strokeWidth} onChange={(v) => on({ strokeWidth: v ? 6 : 0, strokeColor: l.strokeColor ?? '#000000' })} />
      {!!l.strokeWidth && (
        <>
          <Color label="외곽선색" value={l.strokeColor ?? '#000000'} onChange={(strokeColor) => on({ strokeColor })} />
          <Num label="외곽선 두께" value={l.strokeWidth} min={1} max={30} onChange={(strokeWidth) => on({ strokeWidth })} />
        </>
      )}
      <Check label="글자 배경" value={!!l.boxColor} onChange={(v) => on({ boxColor: v ? '#facc15' : undefined, boxPadding: l.boxPadding ?? 16 })} />
      {l.boxColor && (
        <>
          <Color label="배경색" value={l.boxColor} onChange={(boxColor) => on({ boxColor })} />
          <Num label="여백" value={l.boxPadding ?? 16} min={0} max={80} onChange={(boxPadding) => on({ boxPadding })} />
        </>
      )}
    </>
  );
}

function ImageProps({ l, on, onReplace }: { l: ImageLayer; on: (p: Partial<ImageLayer>) => void; onReplace: () => void }) {
  return (
    <>
      <button className="primary block" onClick={onReplace} data-testid="replace-image">
        {l.src ? '사진 교체' : '사진 넣기'}
      </button>
      <Select
        label="맞춤"
        value={l.fit}
        options={[
          ['cover', '꽉 채우기'],
          ['contain', '전체 보이기'],
        ]}
        onChange={(fit) => on({ fit })}
      />
      <Num label="모서리" value={l.radius} min={0} max={1000} onChange={(radius) => on({ radius })} />
      <h4>보정</h4>
      <Num label="밝기" value={l.brightness} min={0} max={200} slider onChange={(brightness) => on({ brightness })} />
      <Num label="대비" value={l.contrast} min={0} max={200} slider onChange={(contrast) => on({ contrast })} />
      <Num label="채도" value={l.saturate} min={0} max={200} slider onChange={(saturate) => on({ saturate })} />
      <Num label="흑백" value={l.grayscale} min={0} max={100} slider onChange={(grayscale) => on({ grayscale })} />
      <Num label="흐림" value={l.blur} min={0} max={40} slider onChange={(blur) => on({ blur })} />
      <button className="ghost small" onClick={() => on({ brightness: 100, contrast: 100, saturate: 100, grayscale: 0, blur: 0 })}>
        보정 초기화
      </button>
    </>
  );
}

function ShapeProps({ l, on }: { l: ShapeLayer; on: (p: Partial<ShapeLayer>) => void }) {
  return (
    <>
      <Select
        label="모양"
        value={l.shape}
        options={[
          ['rect', '사각형'],
          ['ellipse', '원'],
        ]}
        onChange={(shape) => on({ shape })}
      />
      <FillEditor label="채우기" fill={l.fill} onChange={(fill) => on({ fill })} />
      {l.shape === 'rect' && <Num label="모서리" value={l.radius} min={0} max={1000} onChange={(radius) => on({ radius })} />}
      <Check label="테두리" value={!!l.strokeWidth} onChange={(v) => on({ strokeWidth: v ? 4 : 0, strokeColor: l.strokeColor ?? '#111111' })} />
      {!!l.strokeWidth && (
        <>
          <Color label="테두리색" value={l.strokeColor ?? '#111111'} onChange={(strokeColor) => on({ strokeColor })} />
          <Num label="두께" value={l.strokeWidth} min={1} max={40} onChange={(strokeWidth) => on({ strokeWidth })} />
        </>
      )}
    </>
  );
}
