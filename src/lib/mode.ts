/**
 * 읽기 전용 빌드(npm run build:static)인지 나타냅니다.
 * 저장 서버 없이 빌드에 함께 넣은 기록을 보여 주고, 기록을 고쳐 쓰는 기능은 화면에서 숨깁니다.
 * 기록을 고르고 검색하고 Word와 PDF로 받는 기능은 그대로 씁니다.
 */
export const READ_ONLY = import.meta.env.MODE === 'static';
