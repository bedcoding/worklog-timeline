import { describe, expect, it } from 'vitest';
import { matchesSearch, searchTerms } from './search';

const record = (title: string, description = '', effect = '') => ({ title, description, effect });

describe('기록 검색', () => {
  it('빈 검색어는 단어가 없고 모든 기록에 맞는다', () => {
    expect(searchTerms('   ')).toEqual([]);
    expect(matchesSearch(record('목록 화면 개선'), searchTerms(''))).toBe(true);
  });

  it('띄어쓰기를 가리지 않는다', () => {
    expect(matchesSearch(record('목록 화면 개선'), searchTerms('화면개선'))).toBe(true);
    expect(matchesSearch(record('목록 화면개선'), searchTerms('화면 개선'))).toBe(true);
  });

  it('여러 단어를 띄어 쓰면 모두 들어 있어야 맞는다', () => {
    expect(matchesSearch(record('목록 화면 개선', '정렬 버그 수정'), searchTerms('목록 정렬'))).toBe(true);
    expect(matchesSearch(record('목록 화면 개선'), searchTerms('목록 정렬'))).toBe(false);
  });

  it('제목, 내용, 효과를 모두 본다', () => {
    expect(matchesSearch(record('제목', '내용에만 있는 말'), searchTerms('내용에만'))).toBe(true);
    expect(matchesSearch(record('제목', '', '효과에만 있는 말'), searchTerms('효과에만'))).toBe(true);
    expect(matchesSearch(record('제목', '내용', '효과'), searchTerms('없는말'))).toBe(false);
  });

  it('표 없는 버전으로 따로 쓴 글도 본다', () => {
    const r = { ...record('제목', '내용', '효과'), plain: { title: '따로 쓴 제목', description: '따로 쓴 내용', effect: '따로 쓴 효과' } };
    expect(['따로쓴제목', '따로쓴내용', '따로쓴효과'].every((q) => matchesSearch(r, searchTerms(q)))).toBe(true);
    expect(matchesSearch(r, searchTerms('없는말'))).toBe(false);
  });

  it('영문 대소문자를 가리지 않는다', () => {
    expect(matchesSearch(record('React 전환'), searchTerms('react'))).toBe(true);
  });

  it('제목 끝과 내용 첫머리를 이어 붙여 맞추지 않는다', () => {
    expect(matchesSearch(record('목록 화면', '개선 작업'), searchTerms('화면개선'))).toBe(false);
  });
});
