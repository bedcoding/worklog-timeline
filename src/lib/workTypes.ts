import type { WorkType } from './types.ts';

interface WorkTypeStyle {
  label: string;
  /** 타임라인 점과 범례 색 */
  color: string;
  /** 목록 칩 배경 */
  tint: string;
  /** 목록 칩 글자 */
  ink: string;
  /** 상세 화면 태그 글자 */
  tagInk: string;
}

// 색은 디자인 시안에서 그대로 가져왔고, 기타만 새로 정했습니다.
export const WORK_TYPES: Record<WorkType, WorkTypeStyle> = {
  dev: { label: '개발', color: '#86a46c', tint: '#eff4e8', ink: '#688050', tagInk: '#5b7042' },
  doc: { label: '문서', color: '#a49bd4', tint: '#f0ecf6', ink: '#8a7da5', tagInk: '#7c70a9' },
  design: { label: '디자인', color: '#d9a57b', tint: '#f9efe3', ink: '#ae8761', tagInk: '#9f754e' },
  etc: { label: '기타', color: '#9ca59a', tint: '#f0f2ee', ink: '#6c756a', tagInk: '#5f685d' },
};

export const WORK_TYPE_ORDER: WorkType[] = ['dev', 'doc', 'design', 'etc'];

export function isWorkType(value: unknown): value is WorkType {
  return typeof value === 'string' && value in WORK_TYPES;
}
