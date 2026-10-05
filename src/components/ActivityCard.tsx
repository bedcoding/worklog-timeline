import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { monthOf, quarterOfMonth, toDay, yearOf, type DayRange, type Period } from '../lib/dates';
import type { ImageEntry, ViewKind, WorkRecord } from '../lib/types';
import { WORK_TYPES } from '../lib/workTypes';
import { DatePicker, QuarterPicker, YearPicker } from './DatePicker';
import { IconChevronLeft, IconChevronRight, STAR_PATH } from './Icons';
import { Timeline } from './Timeline';

const VIEWS: { key: ViewKind; label: string }[] = [
  { key: 'recent', label: '최근 30일' },
  { key: 'month', label: '월별' },
  { key: 'quarter', label: '분기별' },
  { key: 'year', label: '연도별' },
];

interface ActivityCardProps {
  period: Period;
  range: DayRange;
  label: string;
  caption: string;
  today: string;
  records: WorkRecord[];
  allRecords: WorkRecord[];
  selectedId: string | null;
  images: Map<string, ImageEntry>;
  onView: (view: ViewKind) => void;
  onShift: (delta: number) => void;
  onPickDate: (date: string) => void;
  onPickPeriod: (period: Period) => void;
  /** 지금 보기 그대로 오늘이 들어 있는 기간으로 돌아갑니다 */
  onToday: () => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

export function ActivityCard(props: ActivityCardProps) {
  const { period, range, label, caption, today, records, allRecords, selectedId, images } = props;
  const titleRef = useRef<HTMLButtonElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const shiftable = period.view !== 'recent';
  // 이미 오늘이 들어 있는 기간을 보고 있으면 오늘 단추는 할 일이 없어서 끕니다
  const t = toDay(today);
  const showsToday = range.start <= t && t <= range.end;
  const pick = (next: Period) => {
    setPickerOpen(false);
    props.onPickPeriod(next);
    titleRef.current?.focus({ preventScroll: true });
  };
  const selected = selectedId ? allRecords.find((r) => r.id === selectedId) : undefined;
  const pickerStart = selected ? { year: yearOf(selected.date), month: monthOf(selected.date) } : { year: period.year, month: period.month };
  const showEtc = records.some((r) => r.type === 'etc');
  // 같은 날 기록은 아래 칸으로 쌓입니다. 기간을 바꿀 때마다 타임라인 높이가 바뀌지 않도록
  // 전체 기록에서 가장 많이 쌓인 만큼(최대 두 칸) 늘 비워 둡니다.
  const reservedLanes = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const r of allRecords) perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1);
    let most = 0;
    for (const n of perDay.values()) most = Math.max(most, n);
    return Math.min(2, Math.max(0, most - 1));
  }, [allRecords]);

  return (
    <section className="activity-card" aria-label="기간별 작업 타임라인">
      <div className="period-toolbar">
        <div className="range-tabs" role="group" aria-label="보기 기간">
          {VIEWS.map((v) => (
            <button key={v.key} type="button" className="range-tab" aria-pressed={period.view === v.key} onClick={() => props.onView(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="month-navigation">
          <button type="button" className="today-button" disabled={showsToday} onClick={props.onToday}>
            오늘
          </button>
          <button type="button" className="icon-button" aria-label="이전 기간" disabled={!shiftable} onClick={() => props.onShift(-1)}>
            <IconChevronLeft />
          </button>
          <button
            ref={titleRef}
            type="button"
            className="month-title"
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((o) => !o)}
          >
            <span>{label}</span>
          </button>
          <button type="button" className="icon-button" aria-label="다음 기간" disabled={!shiftable} onClick={() => props.onShift(1)}>
            <IconChevronRight />
          </button>
        </div>
      </div>
      <div className="timeline-section">
        <div className="timeline-heading">
          <div>
            <h2>
              활동 타임라인 <span className="count">{records.length}개 기록</span>
            </h2>
            <p className="helper">점에 올리면 증빙 미리보기, 클릭하면 자세히.</p>
          </div>
          <div className="legend">
            {(['dev', 'doc', 'design'] as const).map((t) => (
              <span key={t} style={{ '--dot': WORK_TYPES[t].color } as CSSProperties}>
                <i />
                {WORK_TYPES[t].label}
              </span>
            ))}
            {showEtc && (
              <span style={{ '--dot': WORK_TYPES.etc.color } as CSSProperties}>
                <i />
                {WORK_TYPES.etc.label}
              </span>
            )}
            <span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={STAR_PATH} />
              </svg>
              대표 결과물
            </span>
            {period.view !== 'year' && (
              <span>
                <i className="weekend-key" />
                주말
              </span>
            )}
          </div>
        </div>
        <Timeline
          records={records}
          range={range}
          view={period.view}
          today={today}
          selectedId={selectedId}
          images={images}
          reservedLanes={reservedLanes}
          onSelect={props.onSelect}
          onOpen={props.onOpen}
        />
        <div className="timeline-foot">
          <span>{caption}</span>
          <span className="key-hint">
            <kbd>←</kbd>
            <kbd>→</kbd> 기록 이동 <span style={{ marginLeft: 7 }}>Enter로 상세 보기</span>
          </span>
          <span className="swipe-hint">← 좌우로 밀어보세요 →</span>
        </div>
      </div>
      {pickerOpen && titleRef.current && period.view === 'quarter' && (
        <QuarterPicker
          anchor={titleRef.current}
          records={allRecords}
          current={{ year: period.year, quarter: period.quarter }}
          onClose={closePicker}
          onPick={(year, quarter) => pick({ view: 'quarter', year, quarter, month: (quarter - 1) * 3 + 1 })}
        />
      )}
      {pickerOpen && titleRef.current && period.view === 'year' && (
        <YearPicker
          anchor={titleRef.current}
          today={today}
          records={allRecords}
          current={period.year}
          onClose={closePicker}
          onPick={(year) => pick({ ...period, view: 'year', year })}
        />
      )}
      {pickerOpen && titleRef.current && (period.view === 'recent' || period.view === 'month') && (
        <DatePicker
          anchor={titleRef.current}
          today={today}
          records={allRecords}
          initial={pickerStart}
          activeDate={selected?.date ?? null}
          onClose={closePicker}
          onPickDate={(date) => {
            setPickerOpen(false);
            props.onPickDate(date);
            titleRef.current?.focus({ preventScroll: true });
          }}
          onPickMonth={(year, month) => pick({ view: 'month', year, month, quarter: quarterOfMonth(month) })}
        />
      )}
    </section>
  );
}
