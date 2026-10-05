import { useEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes } from 'react';
import { fromDay, mondayOf, shortDate, toDay, weekdayKo } from '../lib/dates';
import type { ImageEntry, WorkRecord } from '../lib/types';
import { WORK_TYPES } from '../lib/workTypes';
import { IconChevronRight, IconImage } from './Icons';

interface WeeklyLogProps {
  records: WorkRecord[];
  periodKey: string;
  selectedId: string | null;
  checked: Set<string>;
  checkedTotal: number;
  images: Map<string, ImageEntry>;
  /** 상세 화면을 닫은 뒤 목록에서 그 기록을 다시 보여 줄 때 바뀌는 값 */
  reveal: { id: string; nonce: number } | null;
  onToggleCheck: (id: string, value: boolean) => void;
  /** 여러 기록을 한꺼번에 체크하거나 풉니다(이 기간 모두, 주 단위) */
  onToggleMany: (ids: string[], value: boolean) => void;
  onDeleteChecked: () => void;
  onExportChecked: () => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
}

/** 일부만 고른 상태(가운데 줄)도 보여 주는 체크 상자 */
function TriCheckbox({ indeterminate, ...rest }: InputHTMLAttributes<HTMLInputElement> & { indeterminate: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" {...rest} />;
}

export function WeeklyLog(props: WeeklyLogProps) {
  const { records, periodKey, selectedId, checked, checkedTotal, images, reveal } = props;
  const listRef = useRef<HTMLDivElement>(null);

  // 월요일 기준 주 묶음, 최근 주가 위로
  const weeks = useMemo(() => {
    const groups = new Map<number, WorkRecord[]>();
    for (const r of records) {
      const monday = mondayOf(toDay(r.date));
      const list = groups.get(monday) ?? [];
      list.push(r);
      groups.set(monday, list);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([monday, list]) => ({ monday, list: [...list].reverse() }));
  }, [records]);

  // 기간이 바뀌면 최근 두 주만 펼친 상태로 시작합니다
  const [openState, setOpenState] = useState<{ key: string; weeks: Set<number> } | null>(null);
  const opened = openState && openState.key === periodKey ? openState.weeks : new Set(weeks.slice(0, 2).map((w) => w.monday));
  const setWeekOpen = (monday: number, value: boolean) => {
    const next = new Set(opened);
    if (value) next.add(monday);
    else next.delete(monday);
    setOpenState({ key: periodKey, weeks: next });
  };

  const inPeriod = records.filter((r) => checked.has(r.id)).length;

  // 상세 화면을 닫으면 그 기록이 들어 있는 주를 펼치고 행으로 포커스를 돌려줍니다
  useEffect(() => {
    if (!reveal) return;
    const record = records.find((r) => r.id === reveal.id);
    if (!record) return;
    const monday = mondayOf(toDay(record.date));
    if (!opened.has(monday)) setWeekOpen(monday, true);
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLButtonElement>(`.row-main[data-open="${reveal.id}"]`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: 'nearest' });
    });
    // reveal 이 바뀔 때만 한 번 처리합니다. opened, records 가 바뀔 때 다시 돌지 않도록 의존성에서 뺐습니다.
  }, [reveal]);

  return (
    <section className="log-section" aria-labelledby="weekly-heading">
      <div className="log-heading">
        <div>
          <h2 id="weekly-heading">주간 기록</h2>
          <p>최근 기록부터 둘러보세요. 결과물을 누르면 상세 화면이 열립니다.</p>
        </div>
        <span className="log-count">{weeks.length}주에 걸친 기록</span>
      </div>
      <div className="bulk-toolbar">
        <label className="bulk-check">
          <TriCheckbox
            indeterminate={inPeriod > 0 && inPeriod < records.length}
            disabled={!records.length}
            checked={records.length > 0 && inPeriod === records.length}
            onChange={(e) => props.onToggleMany(records.map((r) => r.id), e.target.checked)}
          />
          이 기간 모두 선택
        </label>
        <span id="selection-count" aria-live="polite">
          선택 {checkedTotal}개{checkedTotal > inPeriod ? ` (다른 기간 ${checkedTotal - inPeriod}개 포함)` : ''}
        </span>
        <button type="button" className="btn danger" disabled={!checkedTotal} onClick={props.onDeleteChecked}>
          선택 삭제
        </button>
        <button type="button" className="btn" disabled={!checkedTotal} onClick={props.onExportChecked}>
          선택 내보내기
        </button>
      </div>
      <div ref={listRef}>
        {weeks.length ? (
          weeks.map((week, index) => {
            const isOpen = opened.has(week.monday);
            const ids = week.list.map((r) => r.id);
            const picked = ids.filter((id) => checked.has(id)).length;
            const range = `${shortDate(fromDay(week.monday))} ~ ${shortDate(fromDay(week.monday + 6))}`;
            const rowsId = `week-rows-${week.monday}`;
            return (
              <div key={week.monday} className={`week${isOpen ? ' is-open' : ''}`}>
                {/* 왼쪽 체크는 그 주 기록을 한꺼번에 고르고, 나머지 머리 부분을 누르면 펼치고 접습니다 */}
                <div className="week-head">
                  <label className="week-check">
                    <TriCheckbox
                      aria-label={`${range} 기록 모두 선택`}
                      indeterminate={picked > 0 && picked < ids.length}
                      checked={picked === ids.length}
                      onChange={(e) => props.onToggleMany(ids, e.target.checked)}
                    />
                  </label>
                  <button
                    type="button"
                    className="week-summary"
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? rowsId : undefined}
                    onClick={() => setWeekOpen(week.monday, !isOpen)}
                  >
                    <span className="week-range">{range}</span>
                    <span className="week-meta">기록 {week.list.length}개</span>
                    {index === 0 && <span className="week-last">최근 기록</span>}
                    <span className="week-chevron" aria-hidden="true">
                      <IconChevronRight />
                    </span>
                  </button>
                </div>
                {isOpen && (
                  <div className="week-rows" id={rowsId}>
                    {week.list.map((r) => (
                      <WorkRow
                        key={r.id}
                        record={r}
                        active={r.id === selectedId}
                        checked={checked.has(r.id)}
                        thumb={r.images[0] ? images.get(r.images[0].id)?.url : undefined}
                        onCheck={(v) => props.onToggleCheck(r.id, v)}
                        onOpen={() => props.onOpen(r.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="log-empty">
            이 기간에는 기록이 없어요.{' '}
            <button type="button" className="text-button inline" onClick={props.onAdd}>
              새 기록 추가하기
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

interface WorkRowProps {
  record: WorkRecord;
  active: boolean;
  checked: boolean;
  thumb?: string;
  onCheck: (value: boolean) => void;
  onOpen: () => void;
}

function WorkRow({ record: r, active, checked, thumb, onCheck, onOpen }: WorkRowProps) {
  const type = WORK_TYPES[r.type];
  return (
    <article className={`work-row${active ? ' is-active' : ''}`} data-row={r.id}>
      <label className="row-check">
        <input type="checkbox" aria-label={`${r.title} 선택`} checked={checked} onChange={(e) => onCheck(e.target.checked)} />
      </label>
      <button type="button" className="row-preview" aria-label={`${r.title} 증빙 열기`} onClick={onOpen}>
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" />
        ) : (
          <span className="row-noimage" aria-hidden="true">
            <IconImage />
          </span>
        )}
      </button>
      <button type="button" className="row-main" data-open={r.id} onClick={onOpen}>
        <span className="row-meta">
          <span className="row-date">
            {shortDate(r.date)} {weekdayKo(r.date)}
          </span>
          <span className="row-category" style={{ '--tint': type.tint, '--category-color': type.ink } as CSSProperties}>
            {type.label}
          </span>
          {r.limitHit && <span className="row-flag">한도 도달</span>}
        </span>
        <span className="row-title">{r.title}</span>
        {r.description && <span className="row-description">{r.description}</span>}
      </button>
      <div className="row-tail">
        <button type="button" className="row-open" aria-label={`${r.title} 상세 보기`} onClick={onOpen}>
          ↗
        </button>
      </div>
    </article>
  );
}
