import type { Format, FormatId } from './types';

export const FORMATS: Format[] = [
  { id: 'insta-square', name: '인스타 피드 1:1', width: 1080, height: 1080, description: '정사각 피드·캐러셀' },
  { id: 'insta-portrait', name: '인스타 피드 4:5', width: 1080, height: 1350, description: '세로형 피드·카드뉴스' },
  { id: 'story', name: '릴스·쇼츠·스토리 9:16', width: 1080, height: 1920, description: '세로 영상·스토리 커버' },
  { id: 'youtube-thumb', name: '유튜브 썸네일 16:9', width: 1280, height: 720, description: '유튜브·강의 썸네일' },
  { id: 'detail', name: '상세페이지', width: 860, height: 1200, description: '섹션을 이어붙인 세로 상세페이지', stackable: true },
];

export function getFormat(id: FormatId): Format {
  const f = FORMATS.find((x) => x.id === id);
  if (!f) throw new Error(`알 수 없는 포맷: ${id}`);
  return f;
}
