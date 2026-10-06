import { describe, expect, it } from 'vitest';
import { splitCases } from './cases';

describe('사례 나누기', () => {
  it('사례가 없으면 글 하나로 돌려준다', () => {
    expect(splitCases('화면을 새로 만듦.\n테스트로 확인함.')).toEqual([{ kind: 'text', text: '화면을 새로 만듦.\n테스트로 확인함.' }]);
  });

  it('AI 초안과 담당자 수정 줄을 사례로 묶고, 앞줄의 사례 번호를 떼어 항목으로 쓴다', () => {
    const text = [
      '기획 화면으로 초안을 받음.',
      '',
      '사례 1. 정렬 기준',
      'AI 초안: 최신순만 지원했음.',
      '담당자 수정: 인기순을 추가함.',
      '',
      '사례 2. 빈 결과',
      'AI 초안: 빈 화면만 보였음.',
      '담당자 수정: 안내 문구를 넣음.',
    ].join('\n');
    expect(splitCases(text)).toEqual([
      { kind: 'text', text: '기획 화면으로 초안을 받음.' },
      {
        kind: 'cases',
        rows: [
          { item: '정렬 기준', draft: '최신순만 지원했음.', revised: '인기순을 추가함.' },
          { item: '빈 결과', draft: '빈 화면만 보였음.', revised: '안내 문구를 넣음.' },
        ],
      },
    ]);
  });

  it('사례 앞줄이 온점으로 끝나는 문장이면 항목으로 가져오지 않는다', () => {
    expect(splitCases('초안을 받음.\nAI 초안: 가\n담당자 수정본: 나')).toEqual([
      { kind: 'text', text: '초안을 받음.' },
      { kind: 'cases', rows: [{ item: '', draft: '가', revised: '나' }] },
    ]);
  });

  it('사례 사이에 글이 있으면 표를 나눈다', () => {
    const parts = splitCases('가\nAI 초안: 1\n담당자 수정: 2\n중간 설명.\n나\nAI 초안: 3\n담당자 수정: 4');
    expect(parts.map((p) => p.kind)).toEqual(['cases', 'text', 'cases']);
  });

  it('담당자 수정 줄이 바로 뒤에 없으면 글로 둔다', () => {
    expect(splitCases('AI 초안: 혼자 있는 줄')).toEqual([{ kind: 'text', text: 'AI 초안: 혼자 있는 줄' }]);
  });
});
