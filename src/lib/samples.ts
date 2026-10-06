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
