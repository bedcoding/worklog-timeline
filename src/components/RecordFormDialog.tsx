import { useEffect, useRef, useState } from 'react';
import { isValidISO } from '../lib/dates';
import { ACCEPT_ATTR, hasFiles, imagesFromClipboard, imagesFromDrop } from '../lib/images';
import type { ImageEntry, RecordDraft, Settings, WorkRecord, WorkType } from '../lib/types';
import { uid } from '../lib/util';
import { WORK_TYPES, WORK_TYPE_ORDER } from '../lib/workTypes';
import { IconClose } from './Icons';
import { Modal } from './Modal';

interface RecordFormDialogProps {
  open: boolean;
  mode: 'add' | 'edit';
  record?: WorkRecord;
  initialFiles?: File[];
  defaultDate: string;
  settings: Settings;
  images: Map<string, ImageEntry>;
  onClose: () => void;
  onSubmit: (draft: RecordDraft, files: File[], removedImageIds: string[]) => Promise<void>;
  onManageTools: () => void;
}

export function RecordFormDialog(props: RecordFormDialogProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} labelledBy="record-form-title" className="record-dialog">
      <RecordForm {...props} />
    </Modal>
  );
}

interface Pending {
  key: string;
  file: File;
}

/**
 * 고른 파일 미리보기. 미리보기 주소를 effect 안에서 만들고 정리합니다.
 * (React 개발 모드는 화면을 한 번 붙였다 떼었다 다시 붙이는데, 처음에 만든 주소를 그때 정리해 버리면 그림이 깨집니다.)
 */
function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt="" /> : <span className="thumb-missing" />;
}

/** 대화상자가 열릴 때마다 새로 그려져서, 열 때의 기록 값으로 시작합니다 */
function RecordForm({ mode, record, initialFiles, defaultDate, settings, images, onClose, onSubmit, onManageTools }: RecordFormDialogProps) {
  const [date, setDate] = useState(record?.date ?? defaultDate);
  const [type, setType] = useState<WorkType>(record?.type ?? 'dev');
  const [toolIds, setToolIds] = useState<string[]>(record?.toolIds ?? (settings.tools[0] ? [settings.tools[0].id] : []));
  const [title, setTitle] = useState(record?.title ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [effect, setEffect] = useState(record?.effect ?? '');
  const [limitHit, setLimitHit] = useState(record?.limitHit ?? false);
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending[]>(() => (initialFiles ?? []).map((file) => ({ key: uid(), file })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const addFiles = (files: File[]) => {
    if (!files.length) return;
    setPending((list) => [...list, ...files.map((file) => ({ key: uid(), file }))]);
  };
  const removePending = (key: string) => setPending((list) => list.filter((p) => p.key !== key));
  const toggleTool = (id: string) => setToolIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const existing = (record?.images ?? []).filter((img) => !removed.includes(img.id));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError('어떤 작업을 했는지 한 줄로 적어 주세요.');
      titleRef.current?.focus();
      return;
    }
    if (!isValidISO(date)) {
      setError('날짜를 다시 골라 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(
        { date, type, toolIds, title: cleanTitle, description: description.trim(), effect: effect.trim(), limitHit },
        pending.map((p) => p.file),
        removed,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했어요. 다시 시도해 주세요.');
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      onPaste={(e) => {
        const files = imagesFromClipboard(e.clipboardData);
        if (!files.length) return;
        e.preventDefault();
        addFiles(files);
      }}
    >
      <div className="dialog-top">
        <h2 id="record-form-title">{mode === 'add' ? '작업 하나 남기기' : '기록 수정'}</h2>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <p className="dialog-note">한 줄 메모와 화면 한 장이면 충분해요. 캡처한 화면은 이 창에서 Ctrl+V로 바로 붙여 넣을 수 있어요.</p>
      <div className="form-grid">
        <label className="field">
          날짜
          <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          작업 유형
          <select value={type} onChange={(e) => setType(e.target.value as WorkType)}>
            {WORK_TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {WORK_TYPES[t].label}
              </option>
            ))}
          </select>
        </label>
        <div className="field wide">
          <span className="field-label">사용한 도구</span>
          {settings.tools.length ? (
            <div className="tool-picker" role="group" aria-label="사용한 도구">
              {settings.tools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className="tool-option"
                  aria-pressed={toolIds.includes(tool.id)}
                  onClick={() => toggleTool(tool.id)}
                >
                  {tool.name}
                </button>
              ))}
              <button type="button" className="text-button" onClick={onManageTools}>
                도구 관리
              </button>
            </div>
          ) : (
            <p className="field-hint">
              등록된 도구가 없어요.{' '}
              <button type="button" className="text-button inline" onClick={onManageTools}>
                설정에서 도구 추가
              </button>
            </p>
          )}
        </div>
        <label className="field wide">
          어떤 작업을 했나요?
          <input
            ref={titleRef}
            value={title}
            maxLength={80}
            placeholder="예: 반복하던 정리 작업을 자동화함"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field wide">
          작업 내용
          <textarea
            value={description}
            maxLength={600}
            placeholder="무엇을 했고, 도구를 어떻게 썼는지 짧게 적어 보세요."
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field wide">
          효과와 메모
          <textarea
            value={effect}
            maxLength={600}
            placeholder="이전 방식과 비교해 적으면 보고서에 그대로 쓰기 좋아요. 예: 1건에 하루 걸리던 초안이 반나절로 줄었음"
            onChange={(e) => setEffect(e.target.value)}
          />
        </label>
        <div className="field wide checks">
          <label className="check-line">
            <input type="checkbox" checked={limitHit} onChange={(e) => setLimitHit(e.target.checked)} />
            이 작업 중 도구 사용 한도에 도달
          </label>
        </div>
        <div className="field wide">
          <span className="field-label">증빙 이미지 (선택)</span>
          <div
            className={`drop-zone${dropActive ? ' active' : ''}`}
            onDragOver={(e) => {
              if (!hasFiles(e.dataTransfer)) return;
              e.preventDefault();
              setDropActive(true);
            }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(e) => {
              if (!hasFiles(e.dataTransfer)) return;
              e.preventDefault();
              setDropActive(false);
              addFiles(imagesFromDrop(e.dataTransfer));
            }}
          >
            {(existing.length > 0 || pending.length > 0) && (
              <div className="form-thumbs">
                {existing.map((img) => {
                  const entry = images.get(img.id);
                  return (
                    <figure key={img.id} className="form-thumb">
                      {entry ? <img src={entry.url} alt="" /> : <span className="thumb-missing" />}
                      <figcaption>{img.label}</figcaption>
                      <button type="button" aria-label={`${img.label} 빼기`} onClick={() => setRemoved((r) => [...r, img.id])}>
                        <IconClose />
                      </button>
                    </figure>
                  );
                })}
                {pending.map((p, i) => (
                  <figure key={p.key} className="form-thumb is-new">
                    <FilePreview file={p.file} />
                    <figcaption>새 이미지 {i + 1}</figcaption>
                    <button type="button" aria-label={`새 이미지 ${i + 1} 빼기`} onClick={() => removePending(p.key)}>
                      <IconClose />
                    </button>
                  </figure>
                ))}
              </div>
            )}
            <div className="drop-copy">
              <span>여기에 끌어놓거나 Ctrl+V로 붙여넣기</span>
              <label className="file-button">
                파일 고르기
                <input
                  type="file"
                  accept={ACCEPT_ATTR}
                  multiple
                  onChange={(e) => {
                    addFiles(Array.from(e.target.files ?? []));
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <span className="drop-help">PNG, JPG, WebP, GIF 파일을 10MB까지 넣을 수 있어요. 이미지는 이 PC의 데이터 폴더에 원본 그대로 저장되고 밖으로 보내지 않습니다.</span>
          </div>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          취소
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? '저장하는 중' : mode === 'add' ? '기록 남기기' : '수정 저장'}
        </button>
      </div>
    </form>
  );
}
