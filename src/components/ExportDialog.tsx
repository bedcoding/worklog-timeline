import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { downloadBlob } from '../lib/download';
import type { Png } from '../lib/images';
import { READ_ONLY } from '../lib/mode';
import { normalizeSettings } from '../lib/normalize';
import { shortDate } from '../lib/dates';
import { buildReport, byDate, REPORT_FIELDS, reportFileName } from '../lib/report';
import type { ImageEntry, ReportField, Settings, WorkRecord } from '../lib/types';
import { isOffline } from '../lib/util';
import { IconCheck, IconClose } from './Icons';
import { Modal } from './Modal';

/** 페이지를 연 뒤 서버가 꺼지면 이 창에 필요한 코드와 이미지를 받지 못합니다. 서버를 켜고 새로고침해야 합니다. */
const OFFLINE = '저장 서버에 연결하지 못했어요. 서버가 켜져 있는지 확인한 뒤 새로고침해 주세요.';
/** 글자를 칠 때마다 문서를 다시 만들지 않도록, 손을 멈추고 이만큼 지나면 반영합니다(ms) */
const TYPING_PAUSE = 400;
/** 받기를 누른 뒤 단추가 "받았어요"로 바뀌어 있는 시간(ms) */
const DONE_TIME = 1800;
/** docx-preview 가 쪽과 스타일에 붙이는 클래스 이름 */
const PREFIX = 'docx-out';
/** 문서를 고쳐 다시 그릴 때, 이보다 오래 걸릴 때만 진행 알림을 띄웁니다(ms). 빨리 끝나면 조용히 바꿔 끼웁니다. */
const SLOW_UPDATE = 1000;
/** 진행 알림이 한번 뜨면 적어도 이만큼은 보여 줍니다(ms). 떴다가 바로 사라지며 깜빡이지 않게 합니다. */
const MIN_NOTICE = 600;

/** 받을 파일 종류 */
type FileKind = 'docx' | 'pdf';

interface ExportDialogProps {
  open: boolean;
  /** 주간 기록에서 체크한 기록 */
  records: WorkRecord[];
  settings: Settings;
  images: Map<string, ImageEntry>;
  today: string;
  onClose: () => void;
  /** 왼쪽 칸에서 고친 부서, 작성자, 보고 분기를 설정 파일에 저장합니다 */
  onSaveSettings: (settings: Settings) => Promise<void>;
  onOpenSettings: () => void;
  /** 창 안의 기록 목록에서 체크를 바꾸면 주간 기록의 체크도 같이 바꿉니다 */
  onCheckRecords: (ids: string[], checked: boolean) => void;
}

export function ExportDialog(props: ExportDialogProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} className="export-dialog" labelledBy="export-title">
      <ExportBody {...props} />
    </Modal>
  );
}

/** 왼쪽 칸에서 고치는 값. 양식 첫 칸(부서, 작성자, 보고 분기)과 나머지 다섯 칸입니다. */
interface ReportDraft {
  team: string;
  author: string;
  period: string;
  /** 손으로 고친 칸만 들어 있습니다. 없는 칸은 기록으로 채운 내용을 그대로 씁니다. */
  fields: Partial<Record<ReportField, string>>;
}

/**
 * 고친 값을 설정에 얹습니다. 보고 분기와 다섯 칸은 기록 날짜로 정한 기간 글(autoPeriod)을 열쇠로 저장하고,
 * 비우거나 기록으로 채운 내용(autoText)과 같게 쓰면 고친 값을 지웁니다.
 */
function applyDraft(settings: Settings, draft: ReportDraft, autoPeriod: string, autoText: Record<ReportField, string>): Settings {
  const periods = { ...settings.periods };
  const period = draft.period.trim();
  if (!period || period === autoPeriod) delete periods[autoPeriod];
  else periods[autoPeriod] = period;
  const fields: Partial<Record<ReportField, string>> = {};
  for (const { key } of REPORT_FIELDS) {
    const text = draft.fields[key]?.trim();
    if (text && text !== autoText[key].trim()) fields[key] = text;
  }
  const reportEdits = { ...settings.reportEdits };
  if (Object.keys(fields).length) reportEdits[autoPeriod] = fields;
  else delete reportEdits[autoPeriod];
  return normalizeSettings({
    ...settings,
    team: draft.team.trim(),
    author: draft.author.trim(),
    periods,
    reportEdits,
  });
}

const sameSettings = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 다 만든 문서가 지금 고른 값으로 만든 것인지 가리는 열쇠.
 * 설정 값(JSON)과 첫 쪽을 넣었는지, 이미지를 내용 아래에 넣었는지, 날짜를 뺐는지로 정합니다.
 */
const docKeyOf = (settingsKey: string, withForm: boolean, imagesBelow: boolean, hideDates: boolean) =>
  `${withForm ? 'report' : 'records'}${imagesBelow ? '+below' : ''}${hideDates ? '+nodate' : ''}:${settingsKey}`;

/** 받을 Word 파일을 만들어 그대로 보여 주고, Word 나 PDF 로 받게 합니다. PDF 도 보여 준 그 문서를 인쇄해 만듭니다. */
function ExportBody({ records, settings, images, today, onClose, onSaveSettings, onOpenSettings, onCheckRecords }: ExportDialogProps) {
  const id = useId();
  // preview 는 화면에 그린 마지막 문서, ready 는 다 만든 문서와 그때 쓴 값(key)입니다
  const [preview, setPreview] = useState<Blob | null>(null);
  const [ready, setReady] = useState<{ blob: Blob; key: string } | null>(null);
  // 새 문서를 만드는 중에 받기를 누르면, 다 만들어지는 대로 받습니다(단추를 껐다 켰다 하지 않습니다)
  const [pending, setPending] = useState<FileKind | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  // 방금 받은 파일 종류. 잠깐 그 단추를 "받았어요"로 바꿉니다.
  const [done, setDone] = useState<FileKind | null>(null);
  // PDF 는 저장 서버가 브라우저로 인쇄해 만들어서 몇 초 걸립니다
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMessage, setPdfMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  // 내용을 고쳐 다시 만들 때 이미지를 또 바꾸지 않도록 창이 열려 있는 동안 PNG 를 모아 둡니다
  const pngs = useRef(new Map<string, Promise<Png>>());
  // 첫 쪽 보고서 본문(팀장이 결재에 올리는 양식 칸)을 뺄지. 포트폴리오나 결과물만 낼 때 씁니다. 창을 열 때마다 넣는 쪽으로 시작합니다.
  const [skipForm, setSkipForm] = useState(false);
  // 이미지를 내용 아래에 크게 넣을지 정합니다.
  // 몇 건을 화면 위주로 자세히 보여 줄 때 쓰고, 창을 열 때마다 왼쪽 칸에 작게 넣는 쪽으로 시작합니다.
  const [imagesBelow, setImagesBelow] = useState(false);
  // 기록마다 맨 위의 날짜 줄을 뺄지 정합니다.
  // 결과물만 붙여 넣을 때 쓰고, 창을 열 때마다 날짜를 넣는 쪽으로 시작합니다.
  const [hideDates, setHideDates] = useState(false);
  // 창을 열 때 체크돼 있던 기록. 창 안에서 체크를 풀어도 목록에 남겨 두어 다시 넣을 수 있게 합니다.
  const [listed] = useState(() => [...records].sort(byDate));
  const included = useMemo(() => new Set(records.map((r) => r.id)), [records]);

  // 보고 분기는 기록 날짜로 정하고, 고쳐 쓴 값은 그 기간 글을 열쇠로 저장합니다
  const base = useMemo(() => buildReport(records, settings), [records, settings]);
  const auto = base.autoPeriodText;
  const autoText = base.autoText;
  // draft 는 칸에 보이는 값, committed 는 손을 멈춘 뒤 문서와 설정에 반영한 값입니다
  const [draft, setDraft] = useState<ReportDraft>(() => ({
    team: settings.team,
    author: settings.author,
    period: base.periodText,
    fields: { ...settings.reportEdits?.[base.autoPeriodText] },
  }));
  const [committed, setCommitted] = useState<ReportDraft>(draft);
  const effectiveKey = JSON.stringify(applyDraft(settings, committed, auto, autoText));
  const effective = useMemo(() => JSON.parse(effectiveKey) as Settings, [effectiveKey]);
  const docKey = docKeyOf(effectiveKey, !skipForm, imagesBelow, hideDates);
  const report = useMemo(() => buildReport(records, effective), [records, effective]);
  const fileName = reportFileName(report, effective, !skipForm);
  const pdfName = fileName.replace(/\.docx$/i, '.pdf');
  const imageCount = records.reduce((n, r) => n + r.images.length, 0);
  const periodEdited = !!draft.period.trim() && draft.period.trim() !== auto;

  useEffect(() => {
    if (draft === committed) return;
    const timer = window.setTimeout(() => setCommitted(draft), TYPING_PAUSE);
    return () => window.clearTimeout(timer);
  }, [draft, committed]);

  // 기록을 빼거나 다시 넣어 보고 기간이 바뀌면(여러 분기에 걸친 기록일 때), 그 기간에 고쳐 둔 보고 분기와 다섯 칸을 불러옵니다
  const draftAuto = useRef(auto);
  useEffect(() => {
    if (draftAuto.current === auto) return;
    draftAuto.current = auto;
    const sync = (d: ReportDraft) => ({ ...d, period: base.periodText, fields: { ...settings.reportEdits?.[auto] } });
    setDraft(sync);
    setCommitted(sync);
  }, [auto, base.periodText, settings.reportEdits]);

  // 돌아온 설정이 내가 보낸 것인지 설정 창에서 바꾼 것인지 가리려고, 마지막으로 보낸 값과 저장 중인 횟수를 기억합니다
  const latest = useRef({ settings, auto, autoText, draft });
  useEffect(() => {
    latest.current = { settings, auto, autoText, draft };
  });
  const sent = useRef({ team: settings.team, author: settings.author });
  const saving = useRef(0);
  const save = useCallback(
    (value: ReportDraft) => {
      const { settings: current, auto: key, autoText: filled } = latest.current;
      const next = applyDraft(current, value, key, filled);
      if (sameSettings(next, current)) return;
      sent.current = { team: next.team, author: next.author };
      saving.current += 1;
      onSaveSettings(next)
        .then(() => setSaveError(''))
        .catch((err: unknown) => setSaveError(err instanceof Error ? `고친 내용을 저장하지 못했어요. ${err.message}` : '고친 내용을 저장하지 못했어요.'))
        .finally(() => {
          saving.current -= 1;
        });
    },
    [onSaveSettings],
  );
  useEffect(() => save(committed), [committed, save]);
  // 손을 멈추기 전에 창을 닫아도 고친 내용은 저장합니다
  useEffect(() => () => save(latest.current.draft), [save]);
  // 설정 창에서 부서나 작성자를 바꾸고 돌아오면 칸에도 반영합니다
  useEffect(() => {
    if (saving.current > 0) return;
    if (settings.team === sent.current.team && settings.author === sent.current.author) return;
    sent.current = { team: settings.team, author: settings.author };
    const sync = (d: ReportDraft) => ({
      ...d,
      team: settings.team,
      author: settings.author,
    });
    setDraft(sync);
    setCommitted(sync);
  }, [settings.team, settings.author]);

  useEffect(() => {
    setReady(null);
    setError('');
    if (!records.length) {
      setPreview(null);
      setProgress(null);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    setProgress({ done: 0, total: 0 });
    // 연달아 고칠 때 매번 만들지 않도록 잠깐 기다립니다
    const timer = window.setTimeout(async () => {
      try {
        // Word 라이브러리는 커서 이 창을 열 때만 불러옵니다
        const { buildDocxExport, imageToPng } = await import('../lib/exportDocx');
        const toPng = (url: string) => {
          let job = pngs.current.get(url);
          if (!job) {
            job = imageToPng(url);
            pngs.current.set(url, job);
            job.catch(() => pngs.current.delete(url));
          }
          return job;
        };
        const blob = await buildDocxExport(records, effective, images, {
          generatedOn: today,
          includeForm: !skipForm,
          imagesBelow,
          hideDates,
          toPng,
          signal,
          onProgress: (done, total) => {
            if (!signal.aborted) setProgress({ done, total });
          },
        });
        if (signal.aborted) return;
        setReady({ blob, key: docKey });
        setPreview(blob);
        setProgress(null);
      } catch (err) {
        if (signal.aborted) return;
        setProgress(null);
        setError(isOffline(err) ? OFFLINE : err instanceof Error ? `문서를 만들지 못했어요: ${err.message}` : '문서를 만들지 못했어요.');
      }
    }, 150);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [records, effective, skipForm, imagesBelow, hideDates, docKey, images, today]);

  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => setDone(null), DONE_TIME);
    return () => window.clearTimeout(timer);
  }, [done]);

  // 창을 닫은 뒤에 PDF 가 다 만들어지면 상태를 바꾸지 않습니다
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const deliver = useCallback(
    async (kind: FileKind, docx: Blob) => {
      if (kind === 'docx') {
        downloadBlob(docx, fileName);
        setDone('docx');
        return;
      }
      setPdfBusy(true);
      setPdfMessage(null);
      try {
        const { docxToPrintHtml, printHtml } = await import('../lib/exportPdf');
        const html = await docxToPrintHtml(docx, pdfName.replace(/\.pdf$/i, ''), PREFIX);
        const pdf = await api.pdf(html);
        if (!alive.current) return;
        if (pdf) {
          downloadBlob(pdf, pdfName);
          setDone('pdf');
        } else {
          await printHtml(html);
          if (alive.current)
            setPdfMessage({
              text: '이 PC에서는 PDF를 바로 만들 수 없어 인쇄 창을 열었어요. 대상에서 "PDF로 저장"을 고르세요.',
              error: false,
            });
        }
      } catch (err) {
        if (!alive.current) return;
        setPdfMessage({
          text: isOffline(err) ? OFFLINE : err instanceof Error ? err.message : 'PDF를 만들지 못했어요.',
          error: true,
        });
      } finally {
        if (alive.current) setPdfBusy(false);
      }
    },
    [fileName, pdfName],
  );

  useEffect(() => {
    if (!pending || !ready || ready.key !== docKey) return;
    setPending(null);
    void deliver(pending, ready.blob);
  }, [pending, ready, docKey, deliver]);
  useEffect(() => {
    if (error) setPending(null);
  }, [error]);

  // 받기를 누른 순간 칸에 보이는 값으로 만든 문서만 받습니다. 아직이면 바로 반영하고 다 만들어지면 받습니다.
  const download = (kind: FileKind) => {
    const wanted = docKeyOf(JSON.stringify(applyDraft(settings, draft, auto, autoText)), !skipForm, imagesBelow, hideDates);
    if (ready && ready.key === wanted) {
      void deliver(kind, ready.blob);
      return;
    }
    setCommitted(draft);
    setPending(kind);
  };

  const edit = (field: 'team' | 'author' | 'period') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setDraft((d) => ({ ...d, [field]: value }));
  };
  // 칸을 벗어나면 기다리지 않고 바로 반영합니다
  const commitNow = () => setCommitted(draft);
  const resetPeriod = () => {
    const next = { ...draft, period: auto };
    setDraft(next);
    setCommitted(next);
  };

  // 다섯 칸: 고치지 않은 칸은 기록으로 채운 내용을 보여 줍니다
  const fieldText = (key: ReportField) => draft.fields[key] ?? report.autoText[key];
  const fieldEdited = (key: ReportField) => {
    const text = draft.fields[key]?.trim();
    return !!text && text !== report.autoText[key].trim();
  };
  const editField = (key: ReportField) => (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
  };
  const resetField = (key: ReportField) => {
    const fields = { ...draft.fields };
    delete fields[key];
    const next = { ...draft, fields };
    setDraft(next);
    setCommitted(next);
  };
  // 창 안에서 체크를 푼 기록을 모두 다시 넣습니다
  const includeAll = () => {
    const ids = listed.map((r) => r.id);
    onCheckRecords(ids, true);
  };
  // 칸을 다 지우고 나가면 기록으로 채운 내용으로 돌아갑니다
  const leaveField = (key: ReportField) => {
    if (draft.fields[key]?.trim()) commitNow();
    else resetField(key);
  };

  return (
    <>
      <div className="dialog-top">
        <h2 id="export-title">보고서 내보내기</h2>
        <button type="button" className="icon-button" aria-label="내보내기 닫기" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="export-layout">
        <div className="export-side">
          <div className="export-form">
            <dl className="export-summary">
              <div>
                <dt>체크한 기록</dt>
                <dd>{records.length}개</dd>
              </div>
              <div>
                <dt>증빙 이미지</dt>
                <dd>{imageCount}장</dd>
              </div>
            </dl>
            <label className="check-line export-option">
              <input type="checkbox" checked={skipForm} onChange={(e) => setSkipForm(e.target.checked)} />
              1쪽 보고서 본문 빼기
            </label>
            <label className="check-line export-option">
              <input type="checkbox" checked={imagesBelow} onChange={(e) => setImagesBelow(e.target.checked)} />
              이미지를 내용 아래에 크게
            </label>
            <label className="check-line export-option">
              <input type="checkbox" checked={hideDates} onChange={(e) => setHideDates(e.target.checked)} />
              기록 날짜 빼기
            </label>
            {!skipForm && !settings.tools.length && !READ_ONLY && (
              <p className="export-callout">
                사용 도구가 비어 있어요.{' '}
                <button type="button" className="text-button inline" onClick={onOpenSettings}>
                  설정에서 채우기
                </button>
              </p>
            )}
            <div className="field">
              <label htmlFor={`${id}-team`}>부서</label>
              <input id={`${id}-team`} value={draft.team} placeholder="예: 기획팀" onChange={edit('team')} onBlur={commitNow} />
            </div>
            {!skipForm && (
              <div className="field">
                <label htmlFor={`${id}-author`}>작성자</label>
                <input id={`${id}-author`} value={draft.author} placeholder="예: 홍길동" onChange={edit('author')} onBlur={commitNow} />
              </div>
            )}
            <div className="field">
              <div className="field-head">
                <label htmlFor={`${id}-period`}>보고 분기</label>
                {periodEdited && (
                  <button type="button" className="text-button" onClick={resetPeriod}>
                    되돌리기
                  </button>
                )}
              </div>
              <input id={`${id}-period`} value={draft.period} placeholder={auto} onChange={edit('period')} onBlur={commitNow} />
            </div>
            {/* 다섯 칸은 첫 쪽 표에만 들어가므로, 첫 쪽을 빼면 숨깁니다. 고친 내용은 그대로 남아 있습니다. */}
            {!skipForm &&
              REPORT_FIELDS.map(({ key, label }) => (
                <div className="field" key={key}>
                  <div className="field-head">
                    <label htmlFor={`${id}-${key}`}>{label}</label>
                    {fieldEdited(key) && (
                      <button type="button" className="text-button" onClick={() => resetField(key)}>
                        되돌리기
                      </button>
                    )}
                  </div>
                  <textarea
                    id={`${id}-${key}`}
                    className="export-textarea"
                    value={fieldText(key)}
                    spellCheck={false}
                    onChange={editField(key)}
                    onBlur={() => leaveField(key)}
                  />
                </div>
              ))}
            <div className="export-pick">
              <div className="field-head">
                <span id={`${id}-records`}>넣을 기록</span>
                {listed.length > records.length && (
                  <button type="button" className="text-button" onClick={includeAll}>
                    모두 넣기
                  </button>
                )}
              </div>
              <ul className="export-records" role="group" aria-labelledby={`${id}-records`}>
                {listed.map((r) => (
                  <li key={r.id}>
                    <label className={`check-line${included.has(r.id) ? '' : ' is-off'}`} title={r.title}>
                      <input type="checkbox" checked={included.has(r.id)} onChange={(e) => onCheckRecords([r.id], e.target.checked)} />
                      <span className="export-record-date">{shortDate(r.date)}</span>
                      <span className="export-record-title">{r.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="export-actions">
            {saveError && <p className="export-error">{saveError}</p>}
            {pdfMessage && <p className={pdfMessage.error ? 'export-error' : 'export-note'}>{pdfMessage.text}</p>}
            <div className="export-buttons">
              <button
                type="button"
                className={`btn download-button${done === 'pdf' ? ' is-done' : ''}${pending === 'pdf' || pdfBusy ? ' is-waiting' : ''}`}
                disabled={!records.length || !!error || pdfBusy}
                aria-busy={pending === 'pdf' || pdfBusy}
                onClick={() => download('pdf')}
              >
                {done === 'pdf' ? (
                  <>
                    <IconCheck />
                    받았어요
                  </>
                ) : pdfBusy ? (
                  '만드는 중'
                ) : (
                  'PDF 받기'
                )}
              </button>
              <button
                type="button"
                className={`btn primary download-button${done === 'docx' ? ' is-done' : ''}${pending === 'docx' ? ' is-waiting' : ''}`}
                disabled={!records.length || !!error}
                aria-busy={pending === 'docx'}
                onClick={() => download('docx')}
              >
                {done === 'docx' ? (
                  <>
                    <IconCheck />
                    받았어요
                  </>
                ) : (
                  'Word 받기'
                )}
              </button>
            </div>
            <span className="sr-only" role="status">
              {done ? `${done === 'pdf' ? pdfName : fileName} 파일을 내려받았어요.` : pdfBusy ? 'PDF를 만드는 중이에요.' : ''}
            </span>
          </div>
        </div>
        <section className="export-viewer" aria-label="문서 미리보기">
          <div className="export-viewer-head">
            <span className="export-viewer-file">{records.length ? fileName : ''}</span>
          </div>
          <DocxView blob={preview} progress={progress} error={error} empty={records.length ? '' : '체크한 기록이 없어요.'} />
        </section>
      </div>
    </>
  );
}

/** docx-preview 가 만든 그림 주소(blob:)를 정리합니다. 바꿔 끼운 옛 문서와 닫는 창의 문서에만 씁니다. */
function revokeImages(root: HTMLElement) {
  for (const img of root.querySelectorAll('img')) if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
}

interface DocxViewProps {
  blob: Blob | null;
  /** 새 문서를 만드는 중이면 이미지를 몇 장째 넣고 있는지 */
  progress: { done: number; total: number } | null;
  error?: string;
  /** 보여 줄 문서가 없을 때의 글 */
  empty?: string;
}

/** active 가 delay 보다 오래 이어질 때만 true 가 됩니다. 한번 true 가 되면 적어도 minVisible 동안은 유지합니다. */
function useLingeringFlag(active: boolean, delay: number, minVisible: number): boolean {
  const [visible, setVisible] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (active) {
      if (visible) return;
      const timer = window.setTimeout(() => {
        since.current = Date.now();
        setVisible(true);
      }, delay);
      return () => window.clearTimeout(timer);
    }
    if (!visible) return;
    const timer = window.setTimeout(() => setVisible(false), Math.max(0, minVisible - (Date.now() - since.current)));
    return () => window.clearTimeout(timer);
  }, [active, visible, delay, minVisible]);
  return visible;
}

/** Word 문서를 Word 화면처럼 그리고, 쪽 폭을 칸 폭에 맞춰 줄입니다. 새 문서는 다 그린 뒤에 바꿔 끼웁니다. */
function DocxView({ blob, progress, error = '', empty = '' }: DocxViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  // 지금 화면에 그려 둔 문서. 새 문서를 만들고 그리는 동안에도 이 문서를 그대로 보여 줍니다.
  const [shownBlob, setShownBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState('');
  const shown = !!shownBlob;
  // 문서를 만드는 단계와 그리는 단계를 하나로 봅니다
  const working = !!progress || (!!blob && blob !== shownBlob && !failed);
  const slow = useLingeringFlag(working && shown, SLOW_UPDATE, MIN_NOTICE);

  // 쪽은 가운데 정렬이라 칸보다 넓으면 왼쪽으로도 넘칩니다. scrollWidth 는 그 부분을 빼고 재므로 쪽 폭으로 계산합니다.
  const fit = useCallback(() => {
    const scroll = scrollRef.current;
    const wrapper = hostRef.current?.querySelector<HTMLElement>(`.${PREFIX}-wrapper`);
    if (!scroll || !wrapper || !scroll.clientWidth) return;
    wrapper.style.zoom = '1';
    const pageWidth = Math.max(0, ...Array.from(wrapper.querySelectorAll<HTMLElement>(`section.${PREFIX}`), (page) => page.offsetWidth));
    const style = getComputedStyle(wrapper);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    wrapper.style.zoom = String(Math.min(1, scroll.clientWidth / (pageWidth + padding)));
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!blob) {
      revokeImages(host);
      host.replaceChildren();
      setShownBlob(null);
      return;
    }
    let alive = true;
    setFailed('');
    const next = document.createElement('div');
    // 문서를 그리는 라이브러리도 커서 필요할 때만 불러옵니다
    import('docx-preview')
      .then(({ renderAsync }) =>
        renderAsync(blob, next, undefined, {
          className: PREFIX,
          inWrapper: true,
          breakPages: true,
        }),
      )
      .then(() => {
        if (!alive) {
          revokeImages(next);
          return;
        }
        revokeImages(host);
        host.replaceChildren(next);
        setShownBlob(blob);
        fit();
      })
      .catch((err: unknown) => {
        revokeImages(next);
        if (!alive) return;
        setFailed(isOffline(err) ? OFFLINE : '미리보기를 그리지 못했어요. 창을 닫았다가 다시 열어 주세요.');
      });
    return () => {
      alive = false;
    };
  }, [blob, fit]);

  // 창을 닫을 때 마지막 문서의 그림 주소도 정리합니다
  useEffect(() => {
    const host = hostRef.current;
    return () => {
      if (host) revokeImages(host);
    };
  }, []);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(fit);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [fit]);

  const label = progress?.total ? `미리보기를 만드는 중이에요. 이미지 ${progress.done}/${progress.total}` : '미리보기를 만드는 중이에요.';
  const problem = error || failed;
  // 처음 열 때는 빈 칸 대신 바로 알리고, 이미 문서가 있으면 오래 걸릴 때만 위에 띄웁니다
  const centered = empty || problem || (!shown && working ? label : '');
  const notice = !centered && slow ? label : '';

  return (
    <div className={`docx-view${notice ? ' is-busy' : ''}`}>
      {notice && (
        <p className="docx-view-busy" aria-live="polite">
          {notice}
        </p>
      )}
      <div className="docx-view-scroll" ref={scrollRef}>
        {centered && (
          <div className="docx-view-state">
            <p>{centered}</p>
            {centered === OFFLINE && (
              <button type="button" className="btn" onClick={() => window.location.reload()}>
                새로고침
              </button>
            )}
          </div>
        )}
        <div className="docx-view-page" ref={hostRef} hidden={!!(empty || problem)} />
      </div>
    </div>
  );
}
