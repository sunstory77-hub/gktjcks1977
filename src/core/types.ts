export type FormatId =
  | 'insta-square'
  | 'insta-portrait'
  | 'story'
  | 'youtube-thumb'
  | 'detail';

export interface Format {
  id: FormatId;
  name: string;
  width: number;
  height: number;
  description: string;
  /** 여러 페이지를 세로로 이어붙여 한 장으로 내보낼 수 있는지 (상세페이지) */
  stackable?: boolean;
}

export type Fill =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; from: string; to: string; angle: number };

interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  opacity: number;
  hidden?: boolean;
  locked?: boolean;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  strokeColor?: string;
  strokeWidth?: number;
  shadow?: boolean;
  /** 글자 뒤 박스 배경 */
  boxColor?: string;
  boxPadding?: number;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  src: string;
  fit: 'cover' | 'contain';
  radius: number;
  brightness: number;
  contrast: number;
  saturate: number;
  blur: number;
  grayscale: number;
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  fill: Fill;
  radius: number;
  strokeColor?: string;
  strokeWidth?: number;
}

export type Layer = TextLayer | ImageLayer | ShapeLayer;

export type Transition = 'none' | 'fade' | 'slide';
export type Motion = 'none' | 'zoom-in' | 'zoom-out' | 'pan';

export interface Page {
  id: string;
  /** 상세페이지 섹션처럼 페이지별 높이를 바꿀 때 사용. 없으면 포맷 높이 */
  height?: number;
  background: Fill;
  layers: Layer[];
  /** 영상 내보내기용 */
  duration: number;
  transition: Transition;
  motion: Motion;
}

export interface Project {
  id: string;
  name: string;
  formatId: FormatId;
  pages: Page[];
  updatedAt: number;
}
