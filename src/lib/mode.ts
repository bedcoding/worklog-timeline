/**
 * 읽기 전용 빌드(npm run build:static)인지 나타냅니다.
 * 저장 서버 없이 빌드에 함께 넣은 기록을 보여 주고, 기록을 고쳐 쓰는 기능은 화면에서 숨깁니다.
 * 기록을 고르고 검색하고 Word와 PDF로 받는 기능은 그대로 씁니다.
 */
export const READ_ONLY = import.meta.env.MODE === 'static';

/**
 * 읽기 전용 빌드에서 예시 기록을 보는 중인지 나타냅니다.
 * 주소 끝에 ?sample 을 붙이면 빌드에 함께 넣은 예시 기록(data-sample)을 보여 줍니다.
 */
export const SAMPLE_VIEW = READ_ONLY && typeof location !== 'undefined' && new URLSearchParams(location.search).has('sample');
