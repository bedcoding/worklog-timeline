import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityCard } from './components/ActivityCard';
import { DetailDialog } from './components/DetailDialog';
import { ExportDialog } from './components/ExportDialog';
import { Heading } from './components/Heading';
import { ImageDialog } from './components/ImageDialog';
import { RecordFormDialog } from './components/RecordFormDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { TopBar } from './components/TopBar';
import { WeeklyLog } from './components/WeeklyLog';
import { useToast } from './hooks/useToast';
import { useWorklog } from './hooks/useWorklog';
import { READ_ONLY, SAMPLE_VIEW } from './lib/mode';
import {
  listUnitFor,
  monthOf,
  periodFor,
  periodLabel,
  periodRange,
  quarterOfMonth,
  rangeCaption,
  shiftPeriod,
  toDay,
  todayISO,
  yearOf,
  type Period,
} from './lib/dates';
import { downloadBlob, fileStamp } from './lib/download';
import { imagesFromClipboard } from './lib/images';
import { defaultView } from './lib/samples';
import type { RecordDraft, ViewKind } from './lib/types';

type DetailOrigin = 'timeline' | 'list';

/**
 * 마지막에 누른 보기 탭(최근 30일, 월별, 분기별, 연도별)은 이 브라우저에만 기억합니다.
 * 날짜를 골라 월별로 넘어간 것처럼 탭을 누르지 않고 바뀐 보기는 기억하지 않습니다.
 */
const VIEW_KEY = 'worklog-view';
const VIEWS: readonly ViewKind[] = ['recent', 'month', 'quarter', 'year'];

/** 기억해 둔 보기. 탭을 누른 적이 없으면 null */
function savedView(): ViewKind | null {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return VIEWS.find((view) => view === value) ?? null;
  } catch {
    return null;
  }
}

function saveView(view: ViewKind): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // 저장소를 쓸 수 없는 브라우저에서는 기억하지 않습니다
  }
}

interface FormState {
  mode: 'add' | 'edit';
  recordId?: string;
  files?: File[];
}

export default function App() {
  const store = useWorklog();
  const { toast, show } = useToast();
  const [today] = useState(todayISO);
  const [period, setPeriod] = useState<Period>(() => periodFor(savedView() ?? 'quarter', today));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [detail, setDetail] = useState<{ open: boolean; origin: DetailOrigin }>({ open: false, origin: 'timeline' });
  const [form, setForm] = useState<FormState | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | null>(null);

  const { records, images, settings } = store;

  // 기록을 다 불러오면, 기억해 둔 보기(없으면 처음 여는 보기)로 가장 최근 기록이 든 기간을 보여 줍니다.
  // 탭을 눌렀을 때와 같은 기간이고, 기록이 없는 오늘의 분기가 먼저 열리지 않게 합니다.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || store.status !== 'ready') return;
    restored.current = true;
    const view = savedView() ?? defaultView(records);
    const last = records[records.length - 1];
    setPeriod(view === 'recent' || !last ? periodFor(view, today) : periodFor(view, last.date));
  }, [store.status, records, today]);

  const range = useMemo(() => periodRange(period, today), [period, today]);
  const visible = useMemo(
    () => records.filter((r) => {
      const d = toDay(r.date);
      return d >= range.start && d <= range.end;
    }),
    [records, range],
  );
  // 고른 기록이 지금 기간 밖이면 가장 최근 기록을 고른 것으로 봅니다(시안과 같은 동작)
  const selected = visible.find((r) => r.id === selectedId) ?? visible[visible.length - 1];
  const detailRecord = records.find((r) => r.id === selectedId);
  const label = periodLabel(period, range);
  const caption = rangeCaption(range);
  const periodKey = `${period.view}-${range.start}-${range.end}`;
  const checkedRecords = useMemo(() => records.filter((r) => checked.has(r.id)), [records, checked]);
  const toolUsage = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) for (const id of r.toolIds) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  }, [records]);

  // 기록이 지워지면 체크 목록에서도 뺍니다
  useEffect(() => {
    setChecked((set) => {
      const ids = new Set(records.map((r) => r.id));
      const next = new Set([...set].filter((id) => ids.has(id)));
      return next.size === set.size ? set : next;
    });
  }, [records]);

  // 열려 있던 상세 화면의 기록이 사라지면 닫습니다
  useEffect(() => {
    if (detail.open && !detailRecord) setDetail((d) => ({ ...d, open: false }));
  }, [detail.open, detailRecord]);

  // 처음 열 때 예전 브라우저 저장소의 기록을 옮겼으면 한 번 알립니다
  const { notice, clearNotice } = store;
  useEffect(() => {
    if (!notice) return;
    show(notice);
    clearNotice();
  }, [notice, clearNotice, show]);

  // 대화상자가 없을 때 캡처 이미지를 붙여넣으면 바로 기록 추가 창을 엽니다
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // 읽기 전용 빌드에서는 기록을 추가하지 않습니다
      if (READ_ONLY || document.querySelector('dialog[open]')) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const files = imagesFromClipboard(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      setForm({ mode: 'add', files });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const report = useCallback((errors: string[], done: string) => {
    show(errors.length ? `${done} 다만 넣지 못한 이미지가 있어요. ${errors[0]}` : done);
  }, [show]);

  /** 기록의 날짜가 지금 기간 밖이면 그 달 보기로 옮깁니다 */
  const revealDate = (date: string) => {
    const d = toDay(date);
    if (d < range.start || d > range.end) setPeriod(periodFor('month', date));
  };

  const openDetail = (id: string, origin: DetailOrigin) => {
    setSelectedId(id);
    setImageIndex(0);
    setDetail({ open: true, origin });
  };

  const closeDetail = () => {
    const id = selectedId;
    const origin = detail.origin;
    setDetail((d) => ({ ...d, open: false }));
    if (!id) return;
    if (origin === 'list') setReveal({ id, nonce: Date.now() });
    else if (origin === 'timeline') {
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`.point[data-id="${id}"]`)?.focus({ preventScroll: true }));
    }
  };

  const step = (delta: number) => {
    const i = visible.findIndex((r) => r.id === selectedId);
    const next = visible[i + delta];
    if (!next) return;
    setSelectedId(next.id);
    setImageIndex(0);
  };

  const setView = (view: ViewKind) => {
    const anchor = selected?.date ?? today;
    setPeriod({ view, year: yearOf(anchor), month: monthOf(anchor), quarter: quarterOfMonth(monthOf(anchor)) });
    saveView(view);
  };

  const pickDate = (date: string) => {
    setPeriod(periodFor('month', date));
    const found = records.find((r) => r.date === date);
    if (found) setSelectedId(found.id);
    else show('이 날짜에는 기록이 없어요. 해당 월의 기록을 표시했어요.');
  };

  const toggleCheck = (id: string, value: boolean) =>
    setChecked((set) => {
      const next = new Set(set);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleMany = (ids: string[], value: boolean) =>
    setChecked((set) => {
      const next = new Set(set);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const clearChecked = () => setChecked(new Set());

  const deleteChecked = async () => {
    const ids = checkedRecords.map((r) => r.id);
    if (!ids.length) return;
    const outside = ids.length - visible.filter((r) => checked.has(r.id)).length;
    const note = outside ? ` 다른 기간에서 체크한 ${outside}개도 함께 지워져요.` : '';
    if (!window.confirm(`체크한 기록 ${ids.length}개를 지울까요?${note} 기록 폴더는 이미지와 함께 데이터 폴더의 trash로 옮겨져요.`)) return;
    try {
      const n = await store.deleteRecords(ids);
      show(`기록 ${n}개를 지웠어요. 데이터 폴더의 trash에 옮겨 뒀어요.`);
    } catch (err) {
      show(err instanceof Error ? err.message : '지우지 못했어요.');
    }
  };

  const submitForm = async (draft: RecordDraft, files: File[], removedImageIds: string[]) => {
    if (!form) return;
    if (form.mode === 'add') {
      const { record, errors } = await store.addRecord(draft, files);
      setForm(null);
      setSelectedId(record.id);
      revealDate(record.date);
      report(errors, '기록을 남겼어요.');
    } else if (form.recordId) {
      const { record, errors } = await store.updateRecord(form.recordId, draft, files, removedImageIds);
      setForm(null);
      setImageIndex((i) => Math.min(i, Math.max(0, record.images.length - 1)));
      revealDate(record.date);
      report(errors, '수정한 내용을 저장했어요.');
    }
  };

  const deleteSelected = async () => {
    if (!detailRecord) return;
    if (!window.confirm(`"${detailRecord.title}" 기록을 지울까요? 기록 폴더는 이미지와 함께 데이터 폴더의 trash로 옮겨져요.`)) return;
    try {
      await store.deleteRecord(detailRecord.id);
      setDetail((d) => ({ ...d, open: false }));
      show('기록을 지웠어요. 데이터 폴더의 trash에 옮겨 뒀어요.');
    } catch (err) {
      show(err instanceof Error ? err.message : '지우지 못했어요.');
    }
  };

  const addImagesToSelected = async (files: File[]) => {
    if (!detailRecord) return;
    const before = detailRecord.images.length;
    try {
      const { added, errors } = await store.addImages(detailRecord.id, files);
      if (added) setImageIndex(before);
      if (added) report(errors, `증빙 ${added}장을 추가했어요.`);
      else show(errors[0] ?? '넣을 수 있는 이미지가 없어요.');
    } catch (err) {
      show(err instanceof Error ? err.message : '이미지를 넣지 못했어요.');
    }
  };

  const removeImageFromSelected = async (imageId: string) => {
    if (!detailRecord) return;
    if (!window.confirm('이 증빙 이미지를 지울까요? 이미지 파일은 데이터 폴더의 trash로 옮겨져요.')) return;
    try {
      await store.removeImage(detailRecord.id, imageId);
      setImageIndex((i) => Math.max(0, Math.min(i, detailRecord.images.length - 2)));
      show('이미지를 지웠어요.');
    } catch (err) {
      show(err instanceof Error ? err.message : '지우지 못했어요.');
    }
  };

  const detailIndex = visible.findIndex((r) => r.id === selectedId);

  if (store.status !== 'ready') {
    return (
      <>
        <TopBar onSettings={() => {}} onAdd={() => {}} />
        <main>
          <div className="app-state">
            {store.status === 'loading' ? (
              <p>기록을 불러오는 중이에요.</p>
            ) : (
              <>
                <strong>기록을 불러오지 못했어요.</strong>
                <p>저장 서버가 꺼졌거나 데이터 폴더를 읽을 수 없어요. 프로젝트 폴더에서 npm run dev 로 서버를 켠 뒤 다시 시도해 주세요.</p>
                <code>{store.error}</code>
                <div className="app-state-actions">
                  <button type="button" className="btn" onClick={() => window.location.reload()}>
                    다시 시도
                  </button>
                </div>
              </>
            )}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar onSettings={() => setSettingsOpen(true)} onAdd={() => setForm({ mode: 'add' })} />
      <main>
        {store.legacyPending > 0 && (
          <div className="notice-bar">
            <div className="notice-copy">
              <strong>이 브라우저에 예전 방식으로 저장된 기록이 {store.legacyPending}개 있어요.</strong>
              <p>데이터 폴더로 옮기면 파일로 남고 다른 브라우저에서도 보입니다. 브라우저에 있던 기록은 지우지 않아요.</p>
            </div>
            <div className="notice-actions">
              <button type="button" className="btn" onClick={store.dismissLegacy}>
                나중에
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  try {
                    const n = await store.migrateLegacy();
                    show(`기록 ${n}개를 데이터 폴더로 옮겼어요.`);
                  } catch (err) {
                    show(err instanceof Error ? err.message : '옮기지 못했어요.');
                  }
                }}
              >
                데이터 폴더로 옮기기
              </button>
            </div>
          </div>
        )}
        {store.problems.length > 0 && (
          <div className="notice-bar warn">
            <div className="notice-copy">
              <strong>데이터 폴더에서 제대로 읽지 못한 것이 {store.problems.length}개 있어요.</strong>
              <ul className="notice-list">
                {store.problems.slice(0, 3).map((p, i) => (
                  <li key={i}>
                    <code>{p.folder}</code> {p.message}
                  </li>
                ))}
              </ul>
              {store.problems.length > 3 && <p>그 밖에 {store.problems.length - 3}개가 더 있어요.</p>}
            </div>
            <div className="notice-actions">
              <button
                type="button"
                className="btn"
                onClick={() => store.openFolder().catch((err: unknown) => show(err instanceof Error ? err.message : '폴더를 열지 못했어요.'))}
              >
                폴더 열기
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  store
                    .refresh()
                    .then(() => show('데이터 폴더를 다시 읽었어요.'))
                    .catch((err: unknown) => show(err instanceof Error ? err.message : '다시 읽지 못했어요.'))
                }
              >
                다시 읽기
              </button>
            </div>
          </div>
        )}
        <Heading records={visible} />
        <ActivityCard
          period={period}
          range={range}
          label={label}
          caption={caption}
          today={today}
          records={visible}
          allRecords={records}
          selectedId={selected?.id ?? null}
          images={images}
          onView={setView}
          onShift={(delta) => setPeriod((p) => shiftPeriod(p, delta))}
          onPickDate={pickDate}
          onPickPeriod={setPeriod}
          onToday={() => {
            setPeriod((p) => periodFor(p.view, today));
            const found = records.find((r) => r.date === today);
            if (found) setSelectedId(found.id);
          }}
          onSelect={setSelectedId}
          onOpen={(id) => openDetail(id, 'timeline')}
        />
        <WeeklyLog
          records={visible}
          unit={listUnitFor(period.view)}
          periodKey={periodKey}
          selectedId={selected?.id ?? null}
          checked={checked}
          checkedTotal={checkedRecords.length}
          images={images}
          reveal={reveal}
          onToggleCheck={toggleCheck}
          onToggleMany={toggleMany}
          onClearChecked={clearChecked}
          onDeleteChecked={deleteChecked}
          onExportChecked={() => setExportOpen(true)}
          onOpen={(id) => openDetail(id, 'list')}
          onAdd={() => setForm({ mode: 'add' })}
        />
        <footer className="footer">
          <span className="footer-storage">
            {READ_ONLY ? (
              SAMPLE_VIEW ? (
                '예시 기록을 보는 중입니다. 기록을 체크하고 선택 내보내기를 누르면 사례 표가 들어간 Word를 받아 볼 수 있어요.'
              ) : (
                '읽기 전용 화면입니다. 목록에서 기록을 체크하고 선택 내보내기를 누르면 Word나 PDF로 받을 수 있어요.'
              )
            ) : (
              <>
                기록과 이미지는 이 PC의 <code>{store.dataDir || '데이터'}</code> 폴더에 파일로 저장됩니다.
              </>
            )}
          </span>
          <span className="prototype-note">오늘 {today}</span>
        </footer>
      </main>

      <DetailDialog
        open={detail.open}
        record={detailRecord}
        settings={settings}
        images={images}
        imageIndex={imageIndex}
        counter={{ index: detailIndex + 1, total: visible.length }}
        checked={!!detailRecord && checked.has(detailRecord.id)}
        onImageIndex={setImageIndex}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onClose={closeDetail}
        onEdit={() => detailRecord && setForm({ mode: 'edit', recordId: detailRecord.id })}
        onDelete={deleteSelected}
        onToggleCheck={(v) => detailRecord && toggleCheck(detailRecord.id, v)}
        onAddImages={addImagesToSelected}
        onRemoveImage={removeImageFromSelected}
        onExpand={(url, title) => setViewer({ url, title })}
      />
      <RecordFormDialog
        open={!!form}
        mode={form?.mode ?? 'add'}
        record={form?.recordId ? records.find((r) => r.id === form.recordId) : undefined}
        initialFiles={form?.files}
        defaultDate={today}
        settings={settings}
        images={images}
        onClose={() => setForm(null)}
        onSubmit={submitForm}
        onManageTools={() => setSettingsOpen(true)}
      />
      <ExportDialog
        open={exportOpen}
        records={checkedRecords}
        settings={settings}
        images={images}
        today={today}
        onClose={() => setExportOpen(false)}
        onSaveSettings={store.saveSettings}
        onOpenSettings={() => setSettingsOpen(true)}
        onCheckRecords={toggleMany}
      />
      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        dataDir={store.dataDir}
        recordCount={records.length}
        imageCount={images.size}
        sampleCount={records.filter((r) => r.sample).length}
        toolUsage={toolUsage}
        onClose={() => setSettingsOpen(false)}
        onSave={store.saveSettings}
        onExportBackup={async () => {
          const blob = await store.exportBackup();
          downloadBlob(blob, `worklog-backup-${fileStamp(today)}.json`);
        }}
        onImportBackup={async (file, mode) => {
          const { added, skipped } = await store.importBackup(file, mode);
          show(mode === 'replace' ? `백업으로 바꿨어요. 기록 ${added}개.` : `기록 ${added}개를 더했어요.${skipped ? ` 이미 있는 ${skipped}개는 건너뛰었어요.` : ''}`);
        }}
        onOpenFolder={store.openFolder}
        onInsertSamples={store.insertSamples}
        onClearSamples={async () => {
          await store.clearSamples();
        }}
        onClearAll={store.clearAll}
      />
      <ImageDialog image={viewer} onClose={() => setViewer(null)} />
      <div className={`toast${toast.visible ? ' show' : ''}`} role="status" aria-live="polite">
        {toast.message}
      </div>
    </>
  );
}
