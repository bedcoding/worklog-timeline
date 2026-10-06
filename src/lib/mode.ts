import { choosePortalView } from './samples';

/**
 * 읽기 전용 빌드(npm run build:static)인지 나타냅니다.
 * 저장 서버 없이 빌드에 함께 넣은 기록을 보여 주고, 기록을 고쳐 쓰는 기능은 화면에서 숨깁니다.
 * 기록을 고르고 검색하고 Word와 PDF로 받는 기능은 그대로 씁니다.
 */
export const READ_ONLY = import.meta.env.MODE === 'static';

const PORTAL_VIEW_KEY = 'worklog-portal-view';

/** 주소와 이 브라우저에 기억해 둔 값으로 예시를 보여 줄지 정하고, 주소로 고른 쪽은 기억해 둡니다 */
function sampleViewFromAddress(): boolean {
  if (typeof location === 'undefined') return false;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(PORTAL_VIEW_KEY);
  } catch {
    // 저장소를 쓸 수 없는 브라우저에서는 주소대로 보여 주고, 주소에도 없으면 예시부터 보여 줍니다
  }
  const { sample, remember } = choosePortalView(location.search, stored);
  if (remember) {
    try {
      localStorage.setItem(PORTAL_VIEW_KEY, remember);
    } catch {
      // 기억하지 못해도 이번 화면은 주소대로 보여 줍니다
    }
  }
  return sample;
}

/**
 * 읽기 전용 빌드에서 예시 기록(data-sample)을 보는 중인지 나타냅니다.
 * 처음 들어온 사람에게는 예시부터 보여 주고, 그다음부터는 마지막에 고른 화면을 보여 줍니다.
 * 주소 끝에 ?sample 을 붙이면 예시, ?mine 을 붙이면 실제 기록이 바로 열립니다.
 */
export const SAMPLE_VIEW = READ_ONLY && sampleViewFromAddress();
