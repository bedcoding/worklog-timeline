import { useEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes } from 'react';
import { splitDescription } from '../lib/cases';
import { fromDay, mondayOf, shortDate, toDay, weekdayKo } from '../lib/dates';
import { READ_ONLY } from '../lib/mode';
import { matchesSearch, searchTerms } from '../lib/search';
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
  /** 체크를 모두 풉니다(다른 기간과 검색 밖에서 체크한 것까지) */
  onClearChecked: () => void;
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
  const { records: periodRecords, periodKey, selectedId, checked, checkedTotal, images, reveal } = props;
  const listRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 검색어가 있으면 지금 보는 기간에서 제목, 내용, 효과에 맞는 기록만 보여 줍니다
  const [query, setQuery] = useState('');
  const terms = useMemo(() => searchTerms(query), [query]);
  const searching = terms.length > 0;
  const records = useMemo(() => periodRecords.filter((r) => matchesSearch(r, terms)), [periodRecords, terms]);

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

  // 기간이 바뀌면 최근 두 주만 펼친 상태로 시작합니다.
  // 검색하는 동안에는 결과가 있는 주를 모두 펼친 상태로 시작합니다.
  const openKey = searching ? `${periodKey}|${terms.join(' ')}` : periodKey;
  const [openState, setOpenState] = useState<{ key: string; weeks: Set<number> } | null>(null);
  const opened =
    openState && openState.key === openKey ? openState.weeks : new Set((searching ? weeks : weeks.slice(0, 2)).map((w) => w.monday));
  const setWeekOpen = (monday: number, value: boolean) => {
    const next = new Set(opened);
    if (value) next.add(monday);
    else next.delete(monday);
    setOpenState({ key: openKey, weeks: next });
  };
  const allOpen = weeks.length > 0 && weeks.every((w) => opened.has(w.monday));
  const setAllOpen = (value: boolean) => setOpenState({ key: openKey, weeks: new Set(value ? weeks.map((w) => w.monday) : []) });

  // 체크한 기록 중 이 기간에 든 것과 그중 지금 보이는 것(검색 결과)
  const inPeriod = periodRecords.filter((r) => checked.has(r.id)).length;
  const inView = records.filter((r) => checked.has(r.id)).length;
  const hidden = [
    checkedTotal > inPeriod ? `다른 기간 ${checkedTotal - inPeriod}개` : '',
    inPeriod > inView ? `검색 밖 ${inPeriod - inView}개` : '',
  ]
    .filter(Boolean)
    .join(', ');

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
    // reveal이 바뀔 때만 한 번 처리합니다.
    // opened, records가 바뀔 때 다시 돌지 않도록 의존성에서 뺐습니다.
  }, [reveal]);

  // 해제 단추는 누르면 사라져서 포커스를 바로 왼쪽의 모두 선택 체크로 옮깁니다.
  // 검색 결과가 없어 체크를 누를 수 없으면 검색창으로 옮깁니다.
  const clearChecked = () => {
    props.onClearChecked();
    const box = toolbarRef.current?.querySelector<HTMLInputElement>('.bulk-check input:not(:disabled)');
    (box ?? searchRef.current)?.focus();
  };

  return (
    <section className="log-section" aria-labelledby="weekly-heading">
      <div className="log-heading">
        <div>
          <h2 id="weekly-heading">주간 기록</h2>
          <p>최근 기록부터 둘러보세요. 결과물을 누르면 상세 화면이 열립니다.</p>
        </div>
        <div className="log-tools">
          <input
            ref={searchRef}
            type="search"
            className="log-search"
            value={query}
            placeholder="이 기간에서 검색"
            aria-label="이 기간 기록 검색"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
          />
        </div>
      </div>
      <div className="bulk-toolbar" ref={toolbarRef}>
        <label className="bulk-check">
          <TriCheckbox
            indeterminate={inView > 0 && inView < records.length}
            disabled={!records.length}
            checked={records.length > 0 && inView === records.length}
            onChange={(e) => props.onToggleMany(records.map((r) => r.id), e.target.checked)}
          />
          <span aria-live="polite">{searching ? `검색 결과 ${records.length}개 모두 선택` : '이 기간 모두 선택'}</span>
        </label>
        {/* 목록에 안 보이는 체크(다른 기간, 검색 밖)는 여기서만 풀 수 있어서 선택 수 바로 옆에 둡니다 */}
        <span className="selection-summary">
          <span id="selection-count" aria-live="polite">
            선택 {checkedTotal}개{hidden ? ` (${hidden} 포함)` : ''}
          </span>
          {checkedTotal > 0 && (
            <button type="button" className="text-button inline selection-clear" aria-label="체크한 기록 모두 해제" onClick={clearChecked}>
              해제
            </button>
          )}
        </span>
        {weeks.length > 1 && (
          <button type="button" className="text-button log-toggle" onClick={() => setAllOpen(!allOpen)}>
            {allOpen ? '모두 접기' : '모두 펼치기'}
          </button>
        )}
        <div className="bulk-actions">
          {!READ_ONLY && (
            <button type="button" className="btn danger" disabled={!checkedTotal} onClick={props.onDeleteChecked}>
              선택 삭제
            </button>
          )}
          <button type="button" className="btn" disabled={!checkedTotal} onClick={props.onExportChecked}>
            선택 내보내기
          </button>
        </div>
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
                    {index === 0 && !searching && <span className="week-last">최근 기록</span>}
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
        ) : searching ? (
          <div className="log-empty">
            이 기간에는 &ldquo;{query.trim()}&rdquo;에 맞는 기록이 없어요.{' '}
            <button type="button" className="text-button inline" onClick={() => setQuery('')}>
              검색 지우기
            </button>
          </div>
        ) : (
          <div className="log-empty">
            이 기간에는 기록이 없어요.
            {!READ_ONLY && (
              <>
                {' '}
                <button type="button" className="text-button inline" onClick={props.onAdd}>
                  새 기록 추가하기
                </button>
              </>
            )}
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
  const summary = splitDescription(r.description).body;
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
        {/* 목록에서는 한 줄만 보이므로 사례 줄은 빼고 앞의 설명만 보여 줍니다 */}
        {summary && <span className="row-description">{summary}</span>}
      </button>
      <div className="row-tail">
        <button type="button" className="row-open" aria-label={`${r.title} 상세 보기`} onClick={onOpen}>
          ↗
        </button>
      </div>
    </article>
  );
}
