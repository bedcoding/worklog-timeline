import { describe, expect, it } from 'vitest';
import {
  fromDay,
  isValidISO,
  mondayOf,
  monthOptions,
  periodFor,
  periodLabel,
  periodRange,
  quarterRange,
  shiftPeriod,
  toDay,
  yearOptions,
} from './dates';

describe('dates', () => {
  it('날짜와 정수를 오가도 같은 날짜가 나온다', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2028-02-29', '2026-12-31']) expect(fromDay(toDay(iso))).toBe(iso);
  });

  it('없는 날짜는 걸러낸다', () => {
    expect(isValidISO('2026-02-30')).toBe(false);
    expect(isValidISO('2026/10/07')).toBe(false);
    expect(isValidISO('2026-10-07')).toBe(true);
  });

  it('최근 30일은 오늘 포함 30일', () => {
    const r = periodRange(periodFor('recent', '2026-10-04'), '2026-10-04');
    expect(fromDay(r.start)).toBe('2026-09-05');
    expect(fromDay(r.end)).toBe('2026-10-04');
  });

  it('3분기는 7월 1일부터 9월 30일까지 92일', () => {
    const r = quarterRange(2026, 3);
    expect(fromDay(r.start)).toBe('2026-07-01');
    expect(fromDay(r.end)).toBe('2026-09-30');
    expect(r.end - r.start + 1).toBe(92);
  });

  it('월과 분기를 해가 바뀌도록 넘길 수 있다', () => {
    const dec = { view: 'month' as const, year: 2026, month: 12, quarter: 4 };
    expect(shiftPeriod(dec, 1)).toMatchObject({ year: 2027, month: 1, quarter: 1 });
    const q1 = { view: 'quarter' as const, year: 2027, month: 1, quarter: 1 };
    expect(shiftPeriod(q1, -1)).toMatchObject({ year: 2026, quarter: 4, month: 10 });
  });

  it('주는 월요일에 시작한다', () => {
    expect(fromDay(mondayOf(toDay('2026-10-04')))).toBe('2026-09-28');
    expect(fromDay(mondayOf(toDay('2026-09-28')))).toBe('2026-09-28');
  });

  it('연도별 보기는 1월 1일부터 12월 31일까지이고 해 단위로 넘긴다', () => {
    const period = periodFor('year', '2026-10-04');
    const r = periodRange(period, '2026-10-04');
    expect(fromDay(r.start)).toBe('2026-01-01');
    expect(fromDay(r.end)).toBe('2026-12-31');
    expect(periodLabel(period, r)).toBe('2026년');
    expect(shiftPeriod(period, 1)).toMatchObject({ view: 'year', year: 2027 });
  });

  it('연도 목록은 작년, 올해, 내년과 기록이 있는 해를 최근 해부터 보여 준다', () => {
    expect(yearOptions('2026-10-04', [])).toEqual([2027, 2026, 2025]);
    expect(yearOptions('2026-10-04', ['2023-05-01'])).toEqual([2027, 2026, 2025, 2024, 2023]);
  });

  it('달력 월 목록은 기록이 있는 달과 최근 12개월을 포함한다', () => {
    const list = monthOptions('2026-10-04', ['2025-03-02']);
    expect(list[0]).toEqual({ year: 2025, month: 3 });
    expect(list[list.length - 1]).toEqual({ year: 2026, month: 10 });
  });
});
