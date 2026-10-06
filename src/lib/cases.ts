/** 기록 내용 안의 "AI 초안 → 담당자 수정" 사례 하나 */
export interface CaseRow {
  /**
   * 무엇에 관한 사례인지 적는 칸입니다.
   * 사례 앞줄에서 "사례 1" 같은 번호를 떼고 씁니다.
   */
  item: string;
  draft: string;
  revised: string;
}

export type DescriptionPart = { kind: 'text'; text: string } | { kind: 'cases'; rows: CaseRow[] };

const DRAFT = /^AI\s*초안\s*[:：]\s*/;
const REVISED = /^담당자\s*수정본?\s*[:：]\s*/;
const NUMBER = /^사례\s*\d+\s*[.)]?\s*/;

/**
 * 기록 내용을 일반 글과 사례 묶음으로 나눕니다.
 * "AI 초안:" 줄 바로 다음에 "담당자 수정:" 줄이 오면 사례 하나로 봅니다.
 * 그 앞줄이 온점으로 끝나지 않는 글이면 번호를 뗀 뒤 항목 이름으로 씁니다.
 * 빈 줄만 사이에 둔 사례들은 표 하나로 묶습니다.
 */
export function splitCases(text: string): DescriptionPart[] {
  const lines = text.split(/\r?\n/);
  const parts: DescriptionPart[] = [];
  let buffer: string[] = [];
  const flush = () => {
    // 글 앞뒤의 빈 줄은 버립니다
    while (buffer.length && !buffer[0].trim()) buffer.shift();
    while (buffer.length && !buffer[buffer.length - 1].trim()) buffer.pop();
    if (buffer.length) parts.push({ kind: 'text', text: buffer.join('\n') });
    buffer = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const next = (lines[i + 1] ?? '').trim();
    if (!DRAFT.test(line) || !REVISED.test(next)) {
      buffer.push(lines[i]);
      continue;
    }
    const last = buffer.length ? buffer[buffer.length - 1].trim() : '';
    const item = last && !last.endsWith('.') ? (buffer.pop() ?? '').trim().replace(NUMBER, '') : '';
    const row = { item, draft: line.replace(DRAFT, ''), revised: next.replace(REVISED, '') };
    const prev = parts[parts.length - 1];
    // 앞 사례와 사이에 빈 줄만 있으면 같은 표에 잇습니다
    if (prev?.kind === 'cases' && buffer.every((l) => !l.trim())) {
      buffer = [];
      prev.rows.push(row);
    } else {
      flush();
      parts.push({ kind: 'cases', rows: [row] });
    }
    i += 1;
  }
  flush();
  return parts;
}
