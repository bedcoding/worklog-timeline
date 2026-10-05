import type { ViewKind } from './types.ts';

/**
 * 날짜는 모두 'YYYY-MM-DD' 문자열로 다루고, 계산할 때만 "1970-01-01 이후 며칠째"인 정수(day number)로 바꿉니다.
 * UTC 기준 정수라 시간대나 서머타임 때문에 하루가 밀리지 않습니다.
 */
export const DAY_MS = 86_400_000;
const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAY_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 사용자 PC 시간대 기준 오늘 */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function toDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isValidISO(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromDay(toDay(value)) === value;
}

export const yearOf = (iso: string) => Number(iso.slice(0, 4));
export const monthOf = (iso: string) => Number(iso.slice(5, 7));
export const dateOf = (iso: string) => Number(iso.slice(8, 10));
export const quarterOfMonth = (month: number) => Math.ceil(month / 3);
export const weekdayOfDay = (day: number) => new Date(day * DAY_MS).getUTCDay();
export const weekdayKo = (iso: string) => WEEKDAY_KO[weekdayOfDay(toDay(iso))];
export const weekdayEn = (iso: string) => WEEKDAY_EN[weekdayOfDay(toDay(iso))];
export const WEEKDAY_LABELS = WEEKDAY_KO;

/** 9/22 */
export const shortDate = (iso: string) => `${monthOf(iso)}/${dateOf(iso)}`;
/** 9.22 */
export const dottedDate = (iso: string) => `${monthOf(iso)}.${pad2(dateOf(iso))}`;

/** 그 날이 속한 주의 월요일 */
export function mondayOf(day: number): number {
  return day - ((weekdayOfDay(day) + 6) % 7);
}

export function monthStartDay(year: number, month: number): number {
  return Math.round(Date.UTC(year, month - 1, 1) / DAY_MS);
}

export function monthEndDay(year: number, month: number): number {
  return Math.round(Date.UTC(year, month, 0) / DAY_MS);
}

export interface DayRange {
  start: number;
  end: number;
}

export function quarterRange(year: number, quarter: number): DayRange {
  const first = (quarter - 1) * 3 + 1;
  return { start: monthStartDay(year, first), end: monthEndDay(year, first + 2) };
}

/** 지금 보고 있는 기간. view 에 따라 year, month, quarter 중 필요한 값만 씁니다. */
export interface Period {
  view: ViewKind;
  year: number;
  month: number;
  quarter: number;
}

export function periodFor(view: ViewKind, iso: string): Period {
  const month = monthOf(iso);
  return { view, year: yearOf(iso), month, quarter: quarterOfMonth(month) };
}

export function periodRange(period: Period, today: string): DayRange {
  switch (period.view) {
    case 'recent': {
      const t = toDay(today);
      return { start: t - 29, end: t };
    }
    case 'month':
      return { start: monthStartDay(period.year, period.month), end: monthEndDay(period.year, period.month) };
    case 'quarter':
      return quarterRange(period.year, period.quarter);
    case 'year':
      return { start: monthStartDay(period.year, 1), end: monthEndDay(period.year, 12) };
  }
}

export function periodLabel(period: Period, range: DayRange): string {
  switch (period.view) {
    case 'recent':
      return `${shortDate(fromDay(range.start))} ~ ${shortDate(fromDay(range.end))}`;
    case 'month':
      return `${period.year}년 ${period.month}월`;
    case 'quarter':
      return `${period.year}년 ${period.quarter}분기`;
    case 'year':
      return `${period.year}년`;
  }
}

/** 월별, 분기별, 연도별 보기에서 앞뒤 기간으로 이동 */
export function shiftPeriod(period: Period, delta: number): Period {
  if (period.view === 'year') return { ...period, year: period.year + delta };
  if (period.view === 'month') {
    const index = period.year * 12 + (period.month - 1) + delta;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return { ...period, year, month, quarter: quarterOfMonth(month) };
  }
  if (period.view === 'quarter') {
    const index = period.year * 4 + (period.quarter - 1) + delta;
    const year = Math.floor(index / 4);
    const quarter = (index % 4) + 1;
    return { ...period, year, quarter, month: (quarter - 1) * 3 + 1 };
  }
  return period;
}

/** 2026.07.01 ~ 2026.09.30 */
export function rangeCaption(range: DayRange): string {
  return `${fromDay(range.start).replaceAll('-', '.')} ~ ${fromDay(range.end).replaceAll('-', '.')}`;
}

/** 달력 선택용 월 목록: 기록이 있는 달과 최근 12개월을 모두 포함 */
export function monthOptions(today: string, recordDates: readonly string[]): { year: number; month: number }[] {
  const toIndex = (iso: string) => yearOf(iso) * 12 + monthOf(iso) - 1;
  let min = toIndex(today) - 11;
  let max = toIndex(today);
  for (const iso of recordDates) {
    const i = toIndex(iso);
    if (i < min) min = i;
    if (i > max) max = i;
  }
  const list: { year: number; month: number }[] = [];
  for (let i = min; i <= max; i++) list.push({ year: Math.floor(i / 12), month: (i % 12) + 1 });
  return list;
}

/** 연도 선택 목록: 작년, 올해, 내년과 기록이 있는 해를 최근 해부터 */
export function yearOptions(today: string, recordDates: readonly string[]): number[] {
  const now = yearOf(today);
  let min = now - 1;
  let max = now + 1;
  for (const iso of recordDates) {
    const y = yearOf(iso);
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const list: number[] = [];
  for (let y = max; y >= min; y--) list.push(y);
  return list;
}
