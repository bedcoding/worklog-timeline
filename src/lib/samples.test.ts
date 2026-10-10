import { describe, expect, it } from 'vitest';
import { choosePortalView, defaultView, shiftSampleDates } from './samples';
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

describe('처음 여는 보기', () => {
  it('실제 기록이 하나라도 있거나 기록이 없으면 분기별로 연다', () => {
    expect(defaultView([rec('a', '2026-09-01'), { ...rec('b', '2026-09-02'), sample: false }])).toBe('quarter');
    expect(defaultView([])).toBe('quarter');
  });

  it('예시 기록만 있으면 최근 30일로 연다', () => {
    expect(defaultView([rec('a', '2026-09-01'), rec('b', '2026-10-04')])).toBe('recent');
  });
});

describe('읽기 전용 화면에서 예시와 실제 기록 고르기', () => {
  it('처음 온 사람(주소에도 기억에도 없음)에게는 예시를 보여 주고, 고른 적이 없으니 기억하지 않는다', () => {
    expect(choosePortalView('', null)).toEqual({ sample: true, remember: null });
  });

  it('주소의 ?mine 과 ?sample 이 기억보다 먼저이고, 고른 쪽을 기억한다', () => {
    expect(choosePortalView('?mine', 'sample')).toEqual({ sample: false, remember: 'mine' });
    expect(choosePortalView('?sample', 'mine')).toEqual({ sample: true, remember: 'sample' });
  });

  it('주소에 없으면 기억해 둔 쪽을 보여 주고, 알 수 없는 값이면 예시를 보여 준다', () => {
    expect(choosePortalView('', 'mine')).toEqual({ sample: false, remember: null });
    expect(choosePortalView('', 'sample')).toEqual({ sample: true, remember: null });
    expect(choosePortalView('', 'unknown')).toEqual({ sample: true, remember: null });
  });
});
