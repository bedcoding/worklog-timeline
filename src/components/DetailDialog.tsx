import { useState } from 'react';
import { dottedDate, weekdayEn } from '../lib/dates';
import { ACCEPT_ATTR, hasFiles, imagesFromClipboard, imagesFromDrop } from '../lib/images';
import { READ_ONLY } from '../lib/mode';
import type { ImageEntry, Settings, WorkRecord } from '../lib/types';
import { WORK_TYPES } from '../lib/workTypes';
import { IconChevronLeft, IconChevronRight, IconClose, IconEdit, IconExpand, IconImage, IconTrash } from './Icons';
import { Modal } from './Modal';

interface DetailDialogProps {
  open: boolean;
  record: WorkRecord | undefined;
  settings: Settings;
  images: Map<string, ImageEntry>;
  imageIndex: number;
  counter: { index: number; total: number };
  checked: boolean;
  onImageIndex: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleCheck: (value: boolean) => void;
  onAddImages: (files: File[]) => void;
  onRemoveImage: (imageId: string) => void;
  onExpand: (url: string, title: string) => void;
}

/** 기록 상세 화면. 디자인 시안의 상세 화면에 수정, 삭제, 증빙 추가와 삭제를 더했습니다. */
export function DetailDialog(props: DetailDialogProps) {
  const { open, record, settings, images, imageIndex, counter, checked } = props;
  const [dropActive, setDropActive] = useState(false);

  const refs = record?.images ?? [];
  const index = Math.min(imageIndex, Math.max(0, refs.length - 1));
  const current = refs[index];
  const entry = current ? images.get(current.id) : undefined;
  const tools = record ? record.toolIds.map((id) => settings.tools.find((t) => t.id === id)?.name).filter((n): n is string => !!n) : [];

  return (
    <Modal
      open={open && !!record}
      onClose={props.onClose}
      className={`work-modal${dropActive ? ' drop-active' : ''}`}
      labelledBy="work-dialog-title"
      onPaste={(e) => {
        // 읽기 전용 빌드에서는 이미지를 붙여넣거나 끌어놓아도 기록에 넣지 않습니다
        if (READ_ONLY) return;
        const files = imagesFromClipboard(e.clipboardData);
        if (!files.length) return;
        e.preventDefault();
        props.onAddImages(files);
      }}
      onDragOver={(e) => {
        if (READ_ONLY || !hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(false);
      }}
      onDrop={(e) => {
        if (READ_ONLY || !hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        setDropActive(false);
        const files = imagesFromDrop(e.dataTransfer);
        if (files.length) props.onAddImages(files);
      }}
    >
      {record && (
        <>
          <div className="modal-toolbar">
            <h2 id="work-dialog-title">작업 기록 상세</h2>
            <div className="modal-actions">
              {!READ_ONLY && (
                <>
                  <button type="button" className="icon-button" aria-label="기록 수정" title="기록 수정" onClick={props.onEdit}>
                    <IconEdit />
                  </button>
                  <button type="button" className="icon-button" aria-label="기록 삭제" title="기록 삭제" onClick={props.onDelete}>
                    <IconTrash />
                  </button>
                  <span className="modal-divider" aria-hidden="true" />
                </>
              )}
              <button type="button" className="icon-button" aria-label="이전 기록" disabled={counter.index <= 1} onClick={props.onPrev}>
                <IconChevronLeft />
              </button>
              <span className="modal-counter">
                {counter.total ? `${counter.index} / ${counter.total}` : '0 / 0'}
              </span>
              <button type="button" className="icon-button" aria-label="다음 기록" disabled={counter.index >= counter.total} onClick={props.onNext}>
                <IconChevronRight />
              </button>
              <button type="button" className="icon-button modal-close" aria-label="상세 화면 닫기" onClick={props.onClose}>
                <IconClose />
              </button>
            </div>
          </div>
          <div className="showcase" aria-label="선택한 작업의 증빙과 설명">
            <div className="evidence">
              <div className="section-label">
                <span className="label-text">
                  <IconImage />
                  증빙 미리보기
                </span>
                <div className="image-tools">
                  <span>
                    {String(refs.length ? index + 1 : 0).padStart(2, '0')} / {String(refs.length).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="증빙 이미지 크게 보기"
                    disabled={!entry}
                    onClick={() => entry && current && props.onExpand(entry.url, current.label)}
                  >
                    <IconExpand />
                  </button>
                </div>
              </div>
              <div className="stage">
                {entry && current ? (
                  <img src={entry.url} alt={`${record.title}의 ${current.label}`} />
                ) : (
                  <div className="stage-empty">
                    <strong>{READ_ONLY ? '증빙 이미지가 없어요.' : '증빙 이미지가 아직 없어요.'}</strong>
                    {!READ_ONLY && <span>화면을 캡처한 뒤 이 창에 붙여넣거나(Ctrl+V) 끌어다 놓으세요.</span>}
                  </div>
                )}
                {record.sample && entry && <span className="demo-mark">가상 증빙 화면</span>}
              </div>
              <div className="evidence-footer">
                <div className="thumbnails" role="group" aria-label="증빙 이미지 선택">
                  {refs.map((ref, i) => {
                    const thumb = images.get(ref.id);
                    return (
                      <button
                        key={ref.id}
                        type="button"
                        className={`thumb${i === index ? ' active' : ''}`}
                        aria-pressed={i === index}
                        onClick={() => props.onImageIndex(i)}
                      >
                        {thumb ? <img src={thumb.url} alt="" /> : <span className="thumb-missing" />}
                        {ref.label}
                      </button>
                    );
                  })}
                </div>
                {current && <span className="filename">{current.name}</span>}
              </div>
            </div>
            <article className="detail">
              <div className="detail-meta">
                <span className="date-large">
                  {dottedDate(record.date)}
                  <span className="date-weekday">{weekdayEn(record.date)}</span>
                </span>
                <span className="meta-slash">/</span>
                <span className="tag" style={{ color: WORK_TYPES[record.type].tagInk }}>
                  {WORK_TYPES[record.type].label}
                </span>
                {record.limitHit && <span className="tag limit-tag">사용 한도 도달</span>}
              </div>
              <h2>{record.title}</h2>
              {record.description && <p className="description">{record.description}</p>}
              {tools.length > 0 && (
                <div className="tool-row">
                  {tools.map((t) => (
                    <span key={t} className="tool-chip">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              <dl className="notes">
                <dt>활용 효과와 메모</dt>
                <dd>
                  {record.effect || (READ_ONLY ? '적어 둔 효과가 없어요.' : '아직 적지 않았어요. 수정 버튼을 눌러 이전 방식과 비교한 효과를 적어 두세요.')}
                </dd>
              </dl>
              <label className="detail-check">
                <input type="checkbox" checked={checked} onChange={(e) => props.onToggleCheck(e.target.checked)} />
                선택 내보내기에 포함
              </label>
            </article>
          </div>
          {!READ_ONLY && (
            <div className="modal-attach">
              <span>이미지를 붙여넣거나 끌어놓으면 이 기록에 증빙이 추가돼요.</span>
              <div className="attach-actions">
                {current && (
                  <button type="button" className="text-button" onClick={() => props.onRemoveImage(current.id)}>
                    이 이미지 삭제
                  </button>
                )}
                <label>
                  증빙 이미지 추가
                  <input
                    type="file"
                    accept={ACCEPT_ATTR}
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (files.length) props.onAddImages(files);
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
