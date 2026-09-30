import type { Motion, Page } from './types';

export const TRANSITION_SEC = 0.5;

export interface FrameState {
  index: number;
  /** 현재 페이지 내 경과 시간(초) */
  local: number;
  /** 0~1 현재 페이지 진행률 */
  progress: number;
  /** 전환 중이면 0~1, 아니면 null */
  transition: number | null;
}

export function totalDuration(pages: Pick<Page, 'duration'>[]): number {
  return pages.reduce((s, p) => s + Math.max(0.1, p.duration), 0);
}

/** 전체 시간 t(초)에서 어느 페이지를 어떤 상태로 그릴지 계산 */
export function frameAt(pages: Pick<Page, 'duration' | 'transition'>[], t: number): FrameState {
  let acc = 0;
  for (let i = 0; i < pages.length; i++) {
    const d = Math.max(0.1, pages[i].duration);
    if (t < acc + d || i === pages.length - 1) {
      const local = Math.min(Math.max(0, t - acc), d);
      const tr = pages[i].transition;
      const trLen = Math.min(TRANSITION_SEC, d / 2);
      const transition = i > 0 && tr !== 'none' && local < trLen ? local / trLen : null;
      return { index: i, local, progress: local / d, transition };
    }
    acc += d;
  }
  return { index: 0, local: 0, progress: 0, transition: null };
}

/** 켄번즈 모션: 배율과 이동량(캔버스 비율) */
export function motionTransform(motion: Motion, progress: number): { scale: number; dx: number; dy: number } {
  const p = Math.min(1, Math.max(0, progress));
  switch (motion) {
    case 'zoom-in':
      return { scale: 1 + 0.12 * p, dx: 0, dy: 0 };
    case 'zoom-out':
      return { scale: 1.12 - 0.12 * p, dx: 0, dy: 0 };
    case 'pan':
      return { scale: 1.1, dx: -0.03 + 0.06 * p, dy: 0 };
    default:
      return { scale: 1, dx: 0, dy: 0 };
  }
}
