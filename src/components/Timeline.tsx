import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { fromDay, shortDate, toDay, weekdayOfDay, type DayRange } from '../lib/dates';
import type { ImageEntry, ViewKind, WorkRecord } from '../lib/types';
import { clamp } from '../lib/util';
import { WORK_TYPES } from '../lib/workTypes';

/** 같은 날 기록을 아래로 쌓을 때 한 칸 간격(px) */
const LANE_GAP = 40;
/** 포인터와 점 중심이 이 거리(px) 안이면 그 점을 가리킨 것으로 봅니다 */
const HIT_MOUSE = 18;
const HIT_TOUCH = 26;

interface TimelineProps {
  /** 지금 기간에 보이는 기록(날짜순) */
  records: WorkRecord[];
  range: DayRange;
  view: ViewKind;
  today: string;
  selectedId: string | null;
  images: Map<string, ImageEntry>;
  /** 기록이 적은 기간에도 비워 둘 아래 칸 수. 기간을 바꿀 때 높이가 바뀌지 않게 합니다. */
  reservedLanes: number;
  /** 키보드 화살표로 다른 기록을 고를 때 */
  onSelect: (id: string) => void;
  /** 클릭, Enter 로 상세 화면을 열 때 */
  onOpen: (id: string) => void;
}

/*
 * 설계 메모
 * - 모양은 디자인 시안 그대로입니다. 다른 점은 두 가지입니다.
 *   1) 같은 날 기록만 아래로 쌓습니다. 시안은 가까운 날짜끼리도 아래로 내려서, 매일 기록하면 점 대부분이 계단처럼 매달렸습니다.
 *   2) 점 버튼은 키보드와 화면 낭독기 전용이고, 마우스와 터치는 타임라인 전체가 받아 가장 가까운 점 하나를 고릅니다.
 *      점이 촘촘해도 히트 영역이 겹쳐 엉뚱한 점이 잡히지 않습니다.
 */
export function Timeline({ records, range, view, today, selectedId, images, reservedLanes, onSelect, onOpen }: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pointRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const lastPointer = useRef('mouse');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusTipId, setFocusTipId] = useState<string | null>(null);

  const count = range.end - range.start + 1;
  // 연도별은 1년이 카드 폭에 들어오도록 하루 폭을 좁게 잡습니다
  const minWidth = Math.max(740, count * (view === 'year' ? 3 : view === 'quarter' ? 11 : 22));
  const pct = (day: number) => ((day - range.start + 0.5) / count) * 100;

  const layout = useMemo(() => {
    const perDay = new Map<number, number>();
    return records.map((record) => {
      const day = toDay(record.date);
      const lane = perDay.get(day) ?? 0;
      perDay.set(day, lane + 1);
      return { record, day, lane };
    });
  }, [records]);
  const maxLane = layout.reduce((m, p) => Math.max(m, p.lane), 0);
  const extra = Math.max(reservedLanes, maxLane) * LANE_GAP;

  const decorations = useMemo(() => {
    const bands: React.ReactNode[] = [];
    const bounds: React.ReactNode[] = [];
    const ticks: React.ReactNode[] = [];
    const total = range.end - range.start + 1;
    for (let n = range.start; n <= range.end; n++) {
      const i = n - range.start;
      const weekday = weekdayOfDay(n);
      const iso = fromDay(n);
      // 연도별 보기에서는 주말 띠가 촘촘한 줄무늬가 되어 그리지 않습니다
      if (view !== 'year' && (weekday === 0 || weekday === 6)) {
        bands.push(<div key={`b${n}`} className="weekend-band" style={{ left: `${(i / total) * 100}%`, width: `${100 / total}%` }} />);
      }
      if (i > 0 && iso.endsWith('-01')) {
        bounds.push(
          <div key={`m${n}`} className="month-boundary" style={{ left: `${(i / total) * 100}%` }}>
            <span>{Number(iso.slice(5, 7))}월</span>
          </div>,
        );
      }
      // 처음과 끝 날짜, 그리고 월요일마다(연도별은 매달 1일마다) 눈금. 처음이나 끝과 이틀 안으로 붙는 눈금은 글자가 겹쳐서 뺍니다.
      const isEdge = i === 0 || i === total - 1;
      const tooClose = i <= 2 || i >= total - 3;
      const isStep = view === 'year' ? iso.endsWith('-01') : weekday === 1;
      if (isEdge || (isStep && !tooClose)) {
        ticks.push(
          <span key={`t${n}`} className={`tick${i === 0 ? ' major' : ''}`} style={{ left: `${((i + 0.5) / total) * 100}%` }}>
            {shortDate(iso)}
          </span>,
        );
      }
    }
    return { bands, bounds, ticks };
  }, [range.start, range.end, view]);

  const progress = clamp(((toDay(today) - range.start + 0.5) / count) * 100, 0, 100);
  const tabStopId = selectedId && records.some((r) => r.id === selectedId) ? selectedId : (records[0]?.id ?? null);

  const nearest = (x: number, y: number, radius: number) => {
    let best: string | null = null;
    let bestDistance = radius;
    for (const [id, el] of pointRefs.current) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
      if (d <= bestDistance) {
        bestDistance = d;
        best = id;
      }
    }
    return best;
  };

  const ensureVisible = (el: HTMLElement) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const r = el.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    if (r.left < s.left + 30 || r.right > s.right - 30) scroll.scrollLeft += r.left + r.width / 2 - (s.left + s.width / 2);
  };

  // 키보드로 고른 점에 렌더 후 포커스를 옮깁니다
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = pointRefs.current.get(id);
    if (!el) return;
    ensureVisible(el);
    el.focus({ preventScroll: true });
  });

  // 기간이 바뀌면 고른 점이 가운데 오도록 가로 스크롤을 맞춥니다
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const el = selectedId ? pointRefs.current.get(selectedId) : undefined;
    if (el) scroll.scrollLeft = Math.max(0, el.offsetLeft - scroll.clientWidth / 2);
    else scroll.scrollLeft = view === 'recent' ? scroll.scrollWidth : 0;
    setHoverId(null);
    // selectedId 는 일부러 의존성에서 뺐습니다. 고른 기록이 바뀔 때마다 스크롤이 튀지 않게 기간이 바뀔 때만 맞춥니다.
  }, [range.start, range.end, view]);

  const handleKey = (e: React.KeyboardEvent, id: string) => {
    const i = records.findIndex((r) => r.id === id);
    let next: WorkRecord | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = records[Math.min(i + 1, records.length - 1)];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = records[Math.max(i - 1, 0)];
    else if (e.key === 'Home') next = records[0];
    else if (e.key === 'End') next = records[records.length - 1];
    else if (e.key === 'Escape') {
      setFocusTipId(null);
      return;
    }
    if (!next) return;
    e.preventDefault();
    if (next.id === id) return;
    pendingFocus.current = next.id;
    onSelect(next.id);
  };

  const tipId = hoverId ?? focusTipId;
  const tipRecord = tipId ? records.find((r) => r.id === tipId) : undefined;
  const tipAnchor = tipRecord ? pointRefs.current.get(tipRecord.id) : undefined;
  const tipImage = tipRecord?.images[0] ? images.get(tipRecord.images[0].id)?.url : undefined;

  return (
    <div className="timeline-frame">
      <div className="timeline-scroll" ref={scrollRef}>
        <div
          className={`timeline is-${view}${hoverId ? ' has-hover' : ''}`}
          role="group"
          aria-label="날짜별 작업 선택. 좌우 화살표로 이동, Enter로 상세 보기"
          style={{ minWidth, height: 154 + extra }}
          onPointerDown={(e) => {
            lastPointer.current = e.pointerType;
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'touch') return;
            const id = nearest(e.clientX, e.clientY, HIT_MOUSE);
            if (id !== hoverId) setHoverId(id);
          }}
          onPointerLeave={() => setHoverId(null)}
          onClick={(e) => {
            if (e.target instanceof Element && e.target.closest('.point')) return;
            const id = nearest(e.clientX, e.clientY, lastPointer.current === 'touch' ? HIT_TOUCH : HIT_MOUSE);
            if (id) {
              setHoverId(null);
              onOpen(id);
            }
          }}
        >
          {decorations.bands}
          {decorations.bounds}
          <div className="track">
            <div className="track-progress" style={{ width: `${progress}%` }} />
          </div>
          <div className="ticks" style={{ transform: `translateY(${extra}px)` }}>
            {decorations.ticks}
          </div>
          {layout.map(({ record, day, lane }) => {
            const selected = record.id === selectedId;
            const style = {
              left: `${pct(day)}%`,
              marginTop: lane * LANE_GAP,
              // 위 칸의 점일수록 위에 그려서, 아래 점에서 올라오는 연결선이 위 점을 가로지르지 않고 그 밑에서 끝나게 합니다
              zIndex: 3 + maxLane - lane,
              '--dot': WORK_TYPES[record.type].color,
              '--stem': `${lane * LANE_GAP}px`,
            } as CSSProperties;
            return (
              <button
                key={record.id}
                ref={(el) => {
                  if (el) pointRefs.current.set(record.id, el);
                  else pointRefs.current.delete(record.id);
                }}
                type="button"
                className={`point${selected ? ' selected' : ''}${hoverId === record.id ? ' is-hover' : ''}`}
                data-id={record.id}
                style={style}
                aria-label={`${record.date}, ${record.title}`}
                aria-pressed={selected}
                tabIndex={record.id === tabStopId ? 0 : -1}
                onFocus={(e) => {
                  if (e.currentTarget.matches(':focus-visible')) setFocusTipId(record.id);
                }}
                onBlur={() => setFocusTipId((cur) => (cur === record.id ? null : cur))}
                onKeyDown={(e) => handleKey(e, record.id)}
                onClick={() => onOpen(record.id)}
              >
                {lane > 0 && <span className="stem" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>
      {/* 가로로 길게 스크롤되는 보기에서도 보이는 영역 가운데에 오도록 스크롤 밖에 둡니다 */}
      {!records.length && <p className="timeline-empty">이 기간에는 기록이 없어요.</p>}
      {tipRecord && tipAnchor && createPortal(<TimelineTooltip record={tipRecord} anchor={tipAnchor} imageUrl={tipImage} />, document.body)}
    </div>
  );
}

function TimelineTooltip({ record, anchor, imageUrl }: { record: WorkRecord; anchor: HTMLElement; imageUrl?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = tip.offsetWidth;
      const height = tip.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      tip.style.left = `${clamp(rect.left + rect.width / 2 - width / 2, 8, Math.max(8, vw - width - 8))}px`;
      tip.style.top = `${rect.top - height - 9 >= 8 ? rect.top - height - 9 : Math.min(vh - height - 8, rect.bottom + 9)}px`;
      // 점이 가로 스크롤 밖으로 밀려나면 툴팁도 숨깁니다
      const scroller = anchor.closest('.timeline-scroll');
      if (scroller) {
        const s = scroller.getBoundingClientRect();
        tip.style.visibility = rect.right < s.left || rect.left > s.right ? 'hidden' : 'visible';
      }
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [anchor, record]);

  return (
    <div ref={ref} className="tooltip" role="tooltip" style={{ left: -9999, top: -9999 }}>
      {imageUrl && (
        <div className="tip-image">
          <img src={imageUrl} alt="" />
        </div>
      )}
      <small>
        {shortDate(record.date)} {WORK_TYPES[record.type].label}
      </small>
      <strong>{record.title}</strong>
      <div className="tip-instruction">클릭하면 증빙을 크게 볼 수 있어요.</div>
    </div>
  );
}
