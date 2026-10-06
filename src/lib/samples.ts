import { fromDay, toDay } from './dates';
import type { WorkRecord } from './types';

/**
 * 예시 기록의 날짜를 가장 최근 예시가 오늘이 되게 옮깁니다.
 * 로컬에서 예시 데이터를 넣을 때(server/storage.ts)와 같은 규칙이라, 언제 열어도 최근 30일 보기에 예시가 보입니다.
 */
export function shiftSampleDates(records: readonly WorkRecord[], today: string): WorkRecord[] {
  if (!records.length) return [];
  const shift = toDay(today) - Math.max(...records.map((r) => toDay(r.date)));
  return records.map((r) => ({ ...r, date: fromDay(toDay(r.date) + shift) }));
}

export type PortalView = 'sample' | 'mine';

/**
 * 읽기 전용 화면에서 예시와 실제 기록 중 무엇을 보여 줄지 정합니다.
 * 주소의 ?sample 이나 ?mine 이 먼저이고, 없으면 기억해 둔 쪽, 그것도 없으면 처음 온 사람이라 예시입니다.
 * remember 는 이 브라우저에 새로 기억할 값이고, 주소로 고른 때만 채웁니다.
 */
export function choosePortalView(search: string, stored: string | null): { sample: boolean; remember: PortalView | null } {
  const params = new URLSearchParams(search);
  const asked: PortalView | null = params.has('sample') ? 'sample' : params.has('mine') ? 'mine' : null;
  const view = asked ?? (stored === 'mine' ? 'mine' : 'sample');
  return { sample: view === 'sample', remember: asked };
}
