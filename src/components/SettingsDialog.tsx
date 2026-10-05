import { useState } from 'react';
import type { Settings, Tool } from '../lib/types';
import { uid } from '../lib/util';
import { IconClose, IconTrash } from './Icons';
import { Modal } from './Modal';

interface SettingsDialogProps {
  open: boolean;
  settings: Settings;
  dataDir: string;
  recordCount: number;
  imageCount: number;
  sampleCount: number;
  toolUsage: Map<string, number>;
  onClose: () => void;
  onSave: (settings: Settings) => Promise<void>;
  onExportBackup: () => Promise<void>;
  onImportBackup: (file: File, mode: 'merge' | 'replace') => Promise<void>;
  onOpenFolder: () => Promise<void>;
  onInsertSamples: () => Promise<void>;
  onClearSamples: () => Promise<void>;
  onClearAll: () => Promise<void>;
}

export function SettingsDialog(props: SettingsDialogProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} className="settings-dialog" labelledBy="settings-title">
      <SettingsBody {...props} />
    </Modal>
  );
}

function SettingsBody(props: SettingsDialogProps) {
  const { settings, dataDir, recordCount, imageCount, sampleCount, toolUsage, onClose } = props;
  const [team, setTeam] = useState(settings.team);
  const [author, setAuthor] = useState(settings.author);
  const [tools, setTools] = useState<Tool[]>(settings.tools);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');

  const dirty =
    team !== settings.team || author !== settings.author || JSON.stringify(tools) !== JSON.stringify(settings.tools);

  const run = async (task: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await task();
      setStatus(done);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '처리하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const updateTool = (id: string, patch: Partial<Tool>) => setTools((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeTool = (tool: Tool) => {
    const used = toolUsage.get(tool.id) ?? 0;
    if (used && !window.confirm(`${tool.name || '이 도구'}를 쓴 기록이 ${used}개 있어요. 지우면 그 기록에서 도구 표시가 빠집니다. 지울까요?`)) return;
    setTools((list) => list.filter((t) => t.id !== tool.id));
  };

  const save = () =>
    run(async () => {
      const cleanTools = tools.map((t) => ({ ...t, name: t.name.trim(), seat: t.seat.trim(), note: t.note.trim() })).filter((t) => t.name);
      await props.onSave({ ...settings, team: team.trim(), author: author.trim(), tools: cleanTools });
      setTools(cleanTools);
    }, '설정을 저장했어요.');

  return (
    <>
      <div className="dialog-top">
        <h2 id="settings-title">설정</h2>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
          <IconClose />
        </button>
      </div>

      <section className="settings-section">
        <h3>보고서 정보</h3>
        <p className="settings-help">Word로 내보낸 보고서의 첫 칸(부서, 작성자, 보고 분기)과 첨부 파일 이름에 들어갑니다. 내보내기 창에서도 고칠 수 있어요.</p>
        <div className="form-grid">
          <label className="field">
            부서
            <input value={team} placeholder="예: 기획팀" onChange={(e) => setTeam(e.target.value)} />
          </label>
          <label className="field">
            작성자
            <input value={author} placeholder="보고서를 올리는 사람" onChange={(e) => setAuthor(e.target.value)} />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h3>사용하는 도구</h3>
        <p className="settings-help">「사용 도구 / 좌석 등급」 칸에 들어갑니다. 좌석 수, 사용자, 부여일은 메모에 적어 두세요.</p>
        <div className="tool-list">
          {tools.map((tool) => (
            <div key={tool.id} className="tool-item">
              <input aria-label="도구 이름" value={tool.name} placeholder="도구 이름" onChange={(e) => updateTool(tool.id, { name: e.target.value })} />
              <input aria-label="좌석 등급" value={tool.seat} placeholder="좌석 등급" onChange={(e) => updateTool(tool.id, { seat: e.target.value })} />
              <input aria-label="메모" value={tool.note} placeholder="예: 3석, 7. 28. 부여" onChange={(e) => updateTool(tool.id, { note: e.target.value })} />
              <span className="tool-usage">{toolUsage.get(tool.id) ?? 0}건</span>
              <button type="button" className="icon-button" aria-label={`${tool.name || '도구'} 지우기`} onClick={() => removeTool(tool)}>
                <IconTrash />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="text-button" onClick={() => setTools((list) => [...list, { id: uid(), name: '', seat: '', note: '' }])}>
          + 도구 추가
        </button>
        <div className="settings-save">
          <button type="button" className="btn primary" disabled={!dirty || busy} onClick={save}>
            설정 저장
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>데이터 보관</h3>
        <p className="settings-help">
          기록과 이미지는 아래 데이터 폴더에 파일로 저장됩니다. 기록 하나가 폴더 하나이고, 지운 기록과 이미지는 그 안의 trash 폴더로 옮겨집니다. 데이터 폴더를 통째로 복사해 두면 그대로 백업이 됩니다.
        </p>
        <dl className="storage-info">
          <div className="wide">
            <dt>데이터 폴더</dt>
            <dd>
              <code>{dataDir}</code>
            </dd>
          </div>
          <div>
            <dt>기록</dt>
            <dd>
              {recordCount}개{sampleCount ? ` (예시 ${sampleCount}개 포함)` : ''}
            </dd>
          </div>
          <div>
            <dt>증빙 이미지</dt>
            <dd>{imageCount}장</dd>
          </div>
        </dl>
        <div className="settings-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => run(props.onOpenFolder, '데이터 폴더를 열었어요.')}>
            폴더 열기
          </button>
          <button type="button" className="btn" disabled={busy || !recordCount} onClick={() => run(props.onExportBackup, '백업 파일을 내려받았어요.')}>
            백업 파일 받기
          </button>
        </div>
        <p className="settings-help settings-note">
          백업 파일은 기록과 이미지를 JSON 파일 하나에 담습니다. 다른 PC로 옮기거나 팀원 기록을 모을 때 씁니다. 폴더 위치를 바꾸려면 프로젝트 폴더의 .env.local 파일에
          WORKLOG_DATA_DIR=경로 를 적고 서버를 다시 켜세요.
        </p>
        <div className="import-box">
          <label className="file-button">
            백업 파일 고르기
            <input type="file" accept="application/json,.json" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
          </label>
          <span className="import-name">{importFile ? importFile.name : '고른 파일 없음'}</span>
          <div className="import-modes" role="radiogroup" aria-label="불러오는 방식">
            <label>
              <input type="radio" name="import-mode" checked={importMode === 'merge'} onChange={() => setImportMode('merge')} />
              합치기 <small>지금 기록에 없는 것만 더함. 팀원 기록 모으기에 씀</small>
            </label>
            <label>
              <input type="radio" name="import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} />
              모두 바꾸기 <small>지금 기록을 trash로 옮기고 백업 내용으로 바꿈</small>
            </label>
          </div>
          <button
            type="button"
            className="btn"
            disabled={!importFile || busy}
            onClick={() => {
              if (!importFile) return;
              if (importMode === 'replace' && !window.confirm('지금 있는 기록과 이미지를 모두 데이터 폴더의 trash로 옮기고 백업 내용으로 바꿉니다. 계속할까요?')) return;
              void run(() => props.onImportBackup(importFile, importMode), '백업을 불러왔어요.');
            }}
          >
            불러오기
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h3>예시 데이터와 초기화</h3>
        <div className="settings-actions">
          {sampleCount ? (
            <button type="button" className="btn" disabled={busy} onClick={() => run(props.onClearSamples, '예시 데이터를 지웠어요.')}>
              예시 데이터 지우기
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={() => run(props.onInsertSamples, '예시 데이터를 넣었어요.')}>
              예시 데이터 넣기
            </button>
          )}
          <button
            type="button"
            className="btn danger"
            disabled={busy || !recordCount}
            onClick={() => {
              if (!window.confirm(`기록 ${recordCount}개와 이미지를 모두 데이터 폴더의 trash로 옮깁니다. trash에서 records 폴더로 다시 옮기면 되살릴 수 있어요. 지울까요?`)) return;
              void run(props.onClearAll, '모든 기록을 trash로 옮겼어요.');
            }}
          >
            모든 기록 지우기
          </button>
        </div>
      </section>

      <p className="settings-status" role="status" aria-live="polite">
        {status}
      </p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>
          닫기
        </button>
      </div>
    </>
  );
}
