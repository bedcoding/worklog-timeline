// 버튼 안 아이콘은 worklog.css 의 `button svg` 규칙(선 굵기, 크기)을 따릅니다.
// 경로는 디자인 시안의 아이콘을 그대로 쓰고, 시안에 없던 아이콘만 같은 선 스타일로 더했습니다.

export const IconPlus = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconCheck = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const IconChevronLeft = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m14 7-5 5 5 5" />
  </svg>
);

export const IconChevronRight = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m10 7 5 5-5 5" />
  </svg>
);

export const IconClose = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const STAR_PATH = 'm12 3 2.7 5.8 6.3.8-4.6 4.5 1.1 6.3L12 17.5l-5.5 2.9 1.1-6.3L3 9.6l6.3-.8Z';

export const IconStar = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d={STAR_PATH} />
  </svg>
);

export const IconImage = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9" cy="9" r="1.5" />
    <path d="m4 16 5-4 4 3 3-5 4 5" />
  </svg>
);

export const IconExpand = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />
  </svg>
);

export const IconEdit = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);

export const IconTrash = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13" />
  </svg>
);

export const IconSettings = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4m0 13.6v2.4M4.2 7.5l2.1 1.2m11.4 6.6 2.1 1.2M4.2 16.5l2.1-1.2m11.4-6.6 2.1-1.2" />
  </svg>
);

export const BrandMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 12h16" stroke="#d8f58b" strokeWidth="2" />
    <circle cx="8" cy="12" r="2" fill="#d8f58b" />
    <circle cx="16" cy="12" r="3" fill="#d8f58b" />
  </svg>
);
