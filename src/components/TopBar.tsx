import { READ_ONLY } from '../lib/mode';
import { BrandMark, IconPlus, IconSettings } from './Icons';

interface TopBarProps {
  onSettings: () => void;
  onAdd: () => void;
}

// 내보내기와 지우기는 주간 목록에서 체크한 기록으로 합니다("선택 내보내기", "선택 삭제")
export function TopBar({ onSettings, onAdd }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-icon" aria-hidden="true">
          <BrandMark />
        </span>
        worklog<small>WORK TIMELINE</small>
      </div>
      <div className="top-right">
        {READ_ONLY ? (
          // 읽기 전용 빌드는 기록을 고칠 수 없어서 설정과 기록 추가 대신 그 사실을 알립니다
          <span className="readonly-mark">읽기 전용</span>
        ) : (
          <>
            <button type="button" className="btn icon-text" aria-label="설정" onClick={onSettings}>
              <IconSettings />
              <span className="btn-label">설정</span>
            </button>
            <button type="button" className="btn primary" onClick={onAdd}>
              <IconPlus />
              기록 추가
            </button>
          </>
        )}
      </div>
    </header>
  );
}
