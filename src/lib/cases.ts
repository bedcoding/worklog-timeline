import type { WorkRecord } from './types';

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

/**
 * 기록 내용을 입력 화면의 내용 칸과 사례 칸으로 나눕니다.
 * 사례 묶음이 하나이고 내용 맨 끝에 있을 때만 나눕니다.
 * 그 밖의 모양이면 쓴 글을 그대로 내용 칸에 두어 순서가 바뀌지 않게 합니다.
 */
export function splitDescription(text: string): { body: string; cases: CaseRow[] } {
  const parts = splitCases(text.trim());
  const last = parts[parts.length - 1];
  if (last?.kind !== 'cases' || parts.filter((p) => p.kind === 'cases').length !== 1) return { body: text.trim(), cases: [] };
  const body = parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])).join('\n\n');
  return { body, cases: last.rows };
}

/**
 * 내용 칸과 사례 칸을 저장할 기록 내용 한 덩어리로 합칩니다.
 * 사례는 번호와 항목 줄, AI 초안 줄, 담당자 수정 줄의 세 줄로 쓰고 사례 사이는 빈 줄로 띄웁니다.
 * 세 칸이 모두 빈 사례는 빼고, 사례 안의 줄바꿈은 표 한 칸에 들어가도록 띄어쓰기로 바꿉니다.
 * 항목이 비면 "사례 1"처럼 번호만 써서 앞의 글이 항목으로 잘못 들어가지 않게 합니다.
 */
export function joinDescription(body: string, cases: readonly CaseRow[]): string {
  const oneLine = (value: string) => value.replace(/\s*\n\s*/g, ' ').trim();
  const blocks = cases
    .map((c) => ({ item: oneLine(c.item).replace(NUMBER, '').replace(/[.。]+$/, ''), draft: oneLine(c.draft), revised: oneLine(c.revised) }))
    .filter((c) => c.item || c.draft || c.revised)
    .map((c, i) => [c.item ? `사례 ${i + 1}. ${c.item}` : `사례 ${i + 1}`, `AI 초안: ${c.draft}`, `담당자 수정: ${c.revised}`].join('\n'));
  return [body.trim(), ...blocks].filter(Boolean).join('\n\n');
}

/**
 * 기록 내용에 사례 표가 하나라도 있는지 알려 줍니다.
 * 표가 없는 기록에는 표 있는 버전과 없는 버전을 고르는 칸을 보여 주지 않습니다.
 */
export function hasCases(text: string): boolean {
  return splitCases(text).some((p) => p.kind === 'cases');
}

/** 기록 내용에서 사례 묶음을 빼고 글만 남깁니다 */
export function withoutCases(text: string): string {
  const parts = splitCases(text);
  if (!parts.some((p) => p.kind === 'cases')) return text;
  return parts.flatMap((p) => (p.kind === 'text' ? [p.text] : [])).join('\n\n');
}

/**
 * 표 없는 버전으로 바꾼 기록. 따로 써 둔 칸은 그 글을 쓰고, 비워 둔 칸은 표 있는 버전의 글을 씁니다.
 * 내용에서는 어느 쪽이든 사례 표를 뺍니다.
 */
export function plainRecord(record: WorkRecord): WorkRecord {
  const plain = record.plain ?? {};
  return {
    ...record,
    title: plain.title || record.title,
    description: withoutCases(plain.description || record.description),
    effect: plain.effect || record.effect,
  };
}
