import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { monthOf, monthOptions, pad2, quarterOfMonth, WEEKDAY_LABELS, yearOf, yearOptions } from '../lib/dates';
import type { WorkRecord } from '../lib/types';
import { IconChevronLeft, IconChevronRight } from './Icons';

/*
 * 기간 제목을 누르면 열리는 선택 창. 보기에 따라 고르는 단위가 다릅니다.
 * - 최근 30일, 월별: 달력에서 날짜나 달
 * - 분기별: 연도를 넘기며 1~4분기
 * - 연도별: 연도 목록
 */

interface PickerPopoverProps {
  anchor: HTMLElement;
  label: string;
  onClose: () => void;
  /** 내용이 바뀌어 크기가 달라질 때 위치를 다시 잡기 위한 값 */
  layoutKey: string | number;
  children: ReactNode;
}

/** 기간 제목 아래에 붙는 팝업. 바깥을 누르거나 Esc, 스크롤, 창 크기 변경에 닫힙니다. */
function PickerPopover({ anchor, label, onClose, layoutKey, children }: PickerPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  // 기간 제목 아래에 붙이고, 아래 공간이 모자라면 위로 올립니다
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const a = anchor.getBoundingClientRect();
    const vh = document.documentElement.clientHeight;
    const vw = document.documentElement.clientWidth;
    box.style.maxHeight = 'none';
    const natural = box.offsetHeight;
    const below = vh - a.bottom - 12;
    const above = a.top - 12;
    const down = below >= natural || below >= above;
    box.style.maxHeight = `${Math.max(120, down ? below : above)}px`;
    box.style.left = `${Math.max(8, Math.min(vw - box.offsetWidth - 8, a.left))}px`;
    box.style.top = `${down ? a.bottom + 7 : Math.max(8, a.top - box.offsetHeight - 7)}px`;
  }, [anchor, layoutKey]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
      anchor.focus({ preventScroll: true });
    };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return (
    <div ref={ref} className="date-picker" role="dialog" aria-label={label}>
      {children}
    </div>
  );
}

interface DatePickerProps {
  anchor: HTMLElement;
  today: string;
  records: WorkRecord[];
  initial: { year: number; month: number };
  activeDate: string | null;
  onPickDate: (date: string) => void;
  onPickMonth: (year: number, month: number) => void;
  onClose: () => void;
}

/** 달력. 기록이 있는 날짜에 색이 칠해집니다. */
export function DatePicker({ anchor, today, records, initial, activeDate, onPickDate, onPickMonth, onClose }: DatePickerProps) {
  const [cursor, setCursor] = useState(initial);

  const dates = useMemo(() => records.map((r) => r.date), [records]);
  const options = useMemo(() => monthOptions(today, dates), [today, dates]);
  const years = useMemo(() => [...new Set(options.map((o) => o.year))], [options]);
  const countByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of dates) map.set(d, (map.get(d) ?? 0) + 1);
    return map;
  }, [dates]);

  const first = new Date(Date.UTC(cursor.year, cursor.month - 1, 1));
  const offset = first.getUTCDay();
  const total = new Date(Date.UTC(cursor.year, cursor.month, 0)).getUTCDate();

  return (
    <PickerPopover anchor={anchor} label="날짜 선택" onClose={onClose} layoutKey={`${cursor.year}-${cursor.month}`}>
      <div className="picker-header">
        <span className="picker-year">{cursor.year}년</span>
        <select
          data-autofocus
          aria-label="달력의 월 선택"
          value={`${cursor.year}-${cursor.month}`}
          onChange={(e) => {
            const [y, m] = e.target.value.split('-').map(Number);
            setCursor({ year: y, month: m });
          }}
        >
          {years.map((y) => (
            <optgroup key={y} label={`${y}년`}>
              {options
                .filter((o) => o.year === y)
                .map((o) => (
                  <option key={`${o.year}-${o.month}`} value={`${o.year}-${o.month}`}>
                    {o.month}월
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="picker-week" aria-hidden="true">
        {WEEKDAY_LABELS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="picker-days">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`blank${i}`} className="picker-blank" aria-hidden="true" />
        ))}
        {Array.from({ length: total }, (_, i) => {
          const day = i + 1;
          const date = `${cursor.year}-${pad2(cursor.month)}-${pad2(day)}`;
          const n = countByDate.get(date) ?? 0;
          const selected = activeDate === date;
          return (
            <button
              key={date}
              type="button"
              className={`picker-day${n ? ' has-record' : ''}${selected ? ' selected' : ''}`}
              aria-label={`${cursor.month}월 ${day}일, 기록 ${n}개`}
              aria-pressed={selected}
              onClick={() => onPickDate(date)}
            >
              {day}
            </button>
          );
        })}
      </div>
      <div className="picker-foot">
        <button type="button" className="picker-apply" onClick={() => onPickMonth(cursor.year, cursor.month)}>
          {cursor.month}월 전체 보기
        </button>
      </div>
    </PickerPopover>
  );
}

interface QuarterPickerProps {
  anchor: HTMLElement;
  records: WorkRecord[];
  current: { year: number; quarter: number };
  onPick: (year: number, quarter: number) => void;
  onClose: () => void;
}

/** 분기 고르기. 연도를 넘기며 네 분기 가운데 하나를 고릅니다. */
export function QuarterPicker({ anchor, records, current, onPick, onClose }: QuarterPickerProps) {
  const [year, setYear] = useState(current.year);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      const key = `${yearOf(r.date)}-${quarterOfMonth(monthOf(r.date))}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [records]);

  return (
    <PickerPopover anchor={anchor} label="분기 선택" onClose={onClose} layoutKey={year}>
      <div className="picker-nav">
        <button type="button" className="icon-button" aria-label="이전 해" onClick={() => setYear((y) => y - 1)}>
          <IconChevronLeft />
        </button>
        <strong aria-live="polite">{year}년</strong>
        <button type="button" className="icon-button" aria-label="다음 해" onClick={() => setYear((y) => y + 1)}>
          <IconChevronRight />
        </button>
      </div>
      <div className="picker-grid">
        {[1, 2, 3, 4].map((q) => {
          const n = counts.get(`${year}-${q}`) ?? 0;
          const selected = current.year === year && current.quarter === q;
          return (
            <button
              key={q}
              type="button"
              className={`picker-cell${n ? ' has-record' : ''}${selected ? ' selected' : ''}`}
              aria-label={`${year}년 ${q}분기, 기록 ${n}개`}
              aria-pressed={selected}
              data-autofocus={selected || undefined}
              onClick={() => onPick(year, q)}
            >
              <strong>{q}분기</strong>
              <span>
                {(q - 1) * 3 + 1}~{q * 3}월
              </span>
              <small>{n ? `기록 ${n}개` : '기록 없음'}</small>
            </button>
          );
        })}
      </div>
    </PickerPopover>
  );
}

interface YearPickerProps {
  anchor: HTMLElement;
  today: string;
  records: WorkRecord[];
  current: number;
  onPick: (year: number) => void;
  onClose: () => void;
}

/** 연도 고르기. 작년, 올해, 내년과 기록이 있는 해를 최근 해부터 보여 줍니다. */
export function YearPicker({ anchor, today, records, current, onPick, onClose }: YearPickerProps) {
  const counts = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of records) map.set(yearOf(r.date), (map.get(yearOf(r.date)) ?? 0) + 1);
    return map;
  }, [records]);
  const years = useMemo(() => {
    const list = yearOptions(today, records.map((r) => r.date));
    // 화살표로 목록 밖의 해까지 넘겨 왔으면 그 해도 넣습니다
    return list.includes(current) ? list : [...list, current].sort((a, b) => b - a);
  }, [today, records, current]);

  return (
    <PickerPopover anchor={anchor} label="연도 선택" onClose={onClose} layoutKey={years.length}>
      <div className="picker-list">
        {years.map((y) => {
          const n = counts.get(y) ?? 0;
          const selected = y === current;
          return (
            <button
              key={y}
              type="button"
              className={`picker-cell${n ? ' has-record' : ''}${selected ? ' selected' : ''}`}
              aria-label={`${y}년, 기록 ${n}개`}
              aria-pressed={selected}
              data-autofocus={selected || undefined}
              onClick={() => onPick(y)}
            >
              <strong>{y}년</strong>
              <small>{n ? `기록 ${n}개` : '기록 없음'}</small>
            </button>
          );
        })}
      </div>
    </PickerPopover>
  );
}
