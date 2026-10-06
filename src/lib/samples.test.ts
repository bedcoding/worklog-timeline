import { describe, expect, it } from 'vitest';
import { shiftSampleDates } from './samples';
import type { WorkRecord } from './types';

const rec = (id: string, date: string): WorkRecord => ({
  id,
  date,
  type: 'doc',
  toolIds: [],
  title: id,
  description: '',
  effect: '',
  limitHit: false,
  images: [],
  sample: true,
  createdAt: 1,
  updatedAt: 1,
});

describe('예시 기록 날짜 옮기기', () => {
  it('가장 최근 예시가 오늘이 되게 모든 날짜를 같은 만큼 옮긴다', () => {
    const moved = shiftSampleDates([rec('a', '2026-09-01'), rec('b', '2026-10-04')], '2026-10-06');
    expect(moved.map((r) => r.date)).toEqual(['2026-09-03', '2026-10-06']);
  });

  it('월과 해가 바뀌어도 간격을 그대로 유지한다', () => {
    const moved = shiftSampleDates([rec('a', '2026-12-30'), rec('b', '2026-12-31')], '2027-01-02');
    expect(moved.map((r) => r.date)).toEqual(['2027-01-01', '2027-01-02']);
  });

  it('기록이 없으면 빈 목록을 돌려준다', () => {
    expect(shiftSampleDates([], '2026-10-06')).toEqual([]);
  });
});
