import type { WorkRecord } from './types';

/** 띄어쓰기를 지우고 대소문자를 맞춥니다 */
const squash = (text: string) => text.normalize('NFC').replace(/\s+/g, '').toLowerCase();

/** 검색어를 단어로 나눕니다. 빈 검색어는 빈 목록입니다. */
export function searchTerms(query: string): string[] {
  return query.split(/\s+/).map(squash).filter(Boolean);
}

/**
 * 기록의 제목, 내용, 효과에 검색어의 단어가 모두 들어 있는지 봅니다.
 * 띄어쓰기는 가리지 않아서 "화면개선"으로 "화면 개선"도 찾습니다.
 * 제목 끝과 내용 첫머리를 이어 붙여 맞추지 않도록 칸마다 따로 봅니다.
 */
export function matchesSearch(record: Pick<WorkRecord, 'title' | 'description' | 'effect'>, terms: string[]): boolean {
  if (!terms.length) return true;
  const fields = [record.title, record.description, record.effect].map(squash);
  return terms.every((term) => fields.some((field) => field.includes(term)));
}
