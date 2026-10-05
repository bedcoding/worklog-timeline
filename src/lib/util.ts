/** 충돌 걱정 없는 무작위 id. crypto.randomUUID 는 보안 컨텍스트에서만 되므로 getRandomValues 로 만듭니다. */
export function uid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 숫자를 소수 첫째 자리까지, 필요 없으면 정수로 */
export function formatHours(n: number): string {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
}

/**
 * 서버가 꺼져서 요청이 닿지 않은 오류인지. 이미지 요청과, 필요할 때 받아 오는 화면 코드 조각(동적 import)이 이렇게 실패합니다.
 * 브라우저마다 문구가 달라서(Failed to fetch, NetworkError, Load failed, ...dynamically imported module) 넓게 봅니다.
 */
export function isOffline(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|load failed|module/i.test(err.message);
}

/** 파일 이름에 못 쓰는 문자를 지우고 공백을 줄입니다 */
export function safeFileName(text: string, max = 40): string {
  const cleaned = text
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '')
    .slice(0, max);
  return cleaned || '기록';
}
