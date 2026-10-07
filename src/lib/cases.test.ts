import { describe, expect, it } from 'vitest';
import { hasCases, joinDescription, plainRecord, splitCases, splitDescription, withoutCases } from './cases';
import type { WorkRecord } from './types';

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

describe('입력 화면의 내용 칸과 사례 칸', () => {
  const saved = [
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

  it('맨 끝의 사례 묶음을 사례 칸으로 나누고, 다시 합치면 저장된 글과 같다', () => {
    const { body, cases } = splitDescription(saved);
    expect(body).toBe('기획 화면으로 초안을 받음.');
    expect(cases.map((c) => c.item)).toEqual(['정렬 기준', '빈 결과']);
    expect(joinDescription(body, cases)).toBe(saved);
  });

  it('사례 뒤에 글이 더 있으면 나누지 않고 쓴 글을 그대로 내용 칸에 둔다', () => {
    const text = `${saved}\n\n마지막 설명.`;
    expect(splitDescription(text)).toEqual({ body: text, cases: [] });
  });

  it('합칠 때 빈 사례는 빼고, 항목의 번호와 끝 온점을 떼고, 줄바꿈은 띄어쓰기로 바꾼다', () => {
    const text = joinDescription('개요.', [
      { item: '', draft: '', revised: '' },
      { item: '사례 3. 정렬 기준.', draft: '최신순만\n지원했음.', revised: '인기순 추가' },
    ]);
    expect(text).toBe('개요.\n\n사례 1. 정렬 기준\nAI 초안: 최신순만 지원했음.\n담당자 수정: 인기순 추가');
  });

  it('예시 기록은 모두 사례를 담고 있어서, 처음 쓰는 사람이 내보내 보면 사례 표가 보인다', () => {
    const samples = Object.values(import.meta.glob<WorkRecord>('../../data-sample/records/*/record.json', { eager: true, import: 'default' }));
    expect(samples.length).toBeGreaterThan(0);
    for (const r of samples) expect(splitDescription(r.description).cases.length).toBeGreaterThan(0);
  });

  it('항목이 비면 번호만 써서 표의 항목 칸을 비우고, 앞의 글을 항목으로 가져가지 않는다', () => {
    const text = joinDescription('개요', [{ item: '', draft: '가', revised: '나' }]);
    expect(splitCases(text)).toEqual([
      { kind: 'text', text: '개요' },
      { kind: 'cases', rows: [{ item: '', draft: '가', revised: '나' }] },
    ]);
  });
});

describe('표 없는 버전', () => {
  const withCases = joinDescription('초안을 받아 화면을 만듦.', [{ item: '정렬 기준', draft: '최신순만 지원했음.', revised: '인기순을 추가함.' }]);
  const record = (patch: Partial<WorkRecord> = {}): WorkRecord => ({
    id: 'a1',
    date: '2026-09-03',
    type: 'dev',
    toolIds: [],
    title: '정렬 화면',
    description: withCases,
    effect: '초안을 하루 만에 받음.',
    limitHit: false,
    images: [],
    sample: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  });

  it('AI 초안 줄과 담당자 수정 줄이 짝을 이뤄야 사례 표가 있다고 본다', () => {
    expect(hasCases(withCases)).toBe(true);
    expect(hasCases('사례 없는 글.\n둘째 줄.')).toBe(false);
    expect(hasCases('AI 초안: 짝이 없는 줄.')).toBe(false);
    expect(hasCases('')).toBe(false);
  });

  it('사례 묶음을 빼고 글만 남긴다', () => {
    expect(withoutCases(withCases)).toBe('초안을 받아 화면을 만듦.');
    expect(withoutCases('사례 없는 글.\n둘째 줄.')).toBe('사례 없는 글.\n둘째 줄.');
  });

  it('따로 쓴 제목, 내용, 효과가 있으면 그 글을 쓴다', () => {
    const plain = plainRecord(record({ plain: { title: '정렬 화면 (관리자)', description: '인기순 정렬을 더함.', effect: '원하는 순서로 볼 수 있게 됨.' } }));
    expect([plain.title, plain.description, plain.effect]).toEqual(['정렬 화면 (관리자)', '인기순 정렬을 더함.', '원하는 순서로 볼 수 있게 됨.']);
  });

  it('비워 둔 칸은 표 있는 버전의 글을 쓰고, 내용에서는 사례 표를 뺀다', () => {
    const plain = plainRecord(record({ plain: { effect: '원하는 순서로 볼 수 있게 됨.' } }));
    expect([plain.title, plain.description, plain.effect]).toEqual(['정렬 화면', '초안을 받아 화면을 만듦.', '원하는 순서로 볼 수 있게 됨.']);
    expect(plainRecord(record()).description).toBe('초안을 받아 화면을 만듦.');
  });

  it('따로 쓴 내용에 사례 줄이 들어 있어도 표로 만들지 않는다', () => {
    expect(splitCases(plainRecord(record({ plain: { description: withCases } })).description).every((p) => p.kind === 'text')).toBe(true);
  });
});
