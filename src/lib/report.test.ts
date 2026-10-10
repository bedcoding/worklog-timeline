import { describe, expect, it } from 'vitest';
import { buildReport, linesToText, reportFileName, textToLines, type Report } from './report';
import type { Settings, WorkRecord } from './types';

const settings: Settings = {
  team: '기획팀',
  author: '홍길동',
  tools: [
    { id: 'claude', name: 'Claude Team Premium', seat: 'Premium', note: '팀 3명' },
    { id: 'img', name: '이미지 도구', seat: 'Pro', note: '' },
  ],
};
const blank: Settings = { team: '', author: '', tools: [] };

let seq = 0;
function rec(date: string, patch: Partial<WorkRecord> = {}): WorkRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    date,
    type: 'doc',
    toolIds: ['claude'],
    title: `기록 ${seq}`,
    description: '',
    effect: '',
    limitHit: false,
    images: [],
    sample: false,
    createdAt: seq,
    updatedAt: seq,
    ...patch,
  };
}

/** 칸 내용을 Word 에 들어가는 모양대로(굵은 앞부분 뒤 두 칸 띄움) 한 줄씩 */
const cell = (report: Report, key: string) =>
  report.rows
    .find((r) => r.key === key)!
    .lines.map((l) => [l.head, l.text].filter(Boolean).join('  '))
    .join('\n');

describe('buildReport', () => {
  const q3 = [
    rec('2026-09-24', { type: 'design', toolIds: ['img'], title: '아이콘 시안', description: '아이콘 시안 12개를 만들고\n4개를 골랐음' }),
    rec('2026-07-03', { type: 'doc', title: '업무 매뉴얼 초안', effect: '손으로 하던 목차 정리를\n템플릿으로 바꿈' }),
    rec('2026-08-12', { type: 'dev', toolIds: ['claude'], limitHit: true }),
  ];
  const report = buildReport(q3, settings);

  it('한 분기 안의 기록이면 그 분기 보고서로 적고 날짜순으로 담는다', () => {
    expect(report.quarter).toEqual({ year: 2026, quarter: 3 });
    expect(report.periodLabel).toBe('2026년 3분기');
    expect(report.records.map((r) => r.date)).toEqual(['2026-07-03', '2026-08-12', '2026-09-24']);
  });

  it('양식과 같은 여섯 칸을 같은 순서로 만든다', () => {
    expect(report.rows.map((r) => r.label)).toEqual([
      '부서, 작성자, 보고 분기',
      '사용 도구 / 좌석 등급',
      '주요 산출물',
      '활용 사례와 효과',
      '부서장 의견',
      '첨부 결과물 (1~2건)',
    ]);
  });

  it('첫 칸은 양식 예시와 같은 꼴', () => {
    expect(cell(report, 'header')).toBe('기획팀, 홍길동, 2026년 3분기(7. 1.~9. 30.)');
  });

  it('도구별 좌석, 메모, 건수를 적는다', () => {
    expect(cell(report, 'tools')).toContain('Claude Team Premium Premium  팀 3명, 기록 2건');
    expect(cell(report, 'tools')).toContain('이미지 도구 Pro  기록 1건');
  });

  it('유형별 건수와 월 주기를 적는다', () => {
    expect(cell(report, 'outputs')).toContain('1) 개발 1건  7월 0건, 8월 1건, 9월 0건');
    expect(cell(report, 'outputs')).toContain('전체 3건, 기록한 날 3일');
  });

  it('효과는 한 줄로 합치고 한계를 붙인다', () => {
    const text = cell(report, 'effects');
    expect(text).toContain('업무 매뉴얼 초안  손으로 하던 목차 정리를 템플릿으로 바꿈');
    expect(text).not.toContain('절감');
    expect(text).toContain('한계  사용 한도 도달 1회(8/12)');
  });

  it('효과는 큰 작업을 최근 것부터 적고 기타로 묶은 기록은 그 뒤에 적는다', () => {
    const text = cell(
      buildReport(
        [
          rec('2026-07-10', { type: 'dev', title: '큰 작업 1', effect: '효과 1' }),
          rec('2026-09-30', { type: 'etc', title: '9월 기타', effect: '기타 효과' }),
          rec('2026-08-20', { type: 'dev', title: '큰 작업 2', effect: '효과 2' }),
        ],
        settings,
      ),
      'effects',
    );
    expect(text.split('\n').slice(0, 3)).toEqual(['큰 작업 2  효과 2', '큰 작업 1  효과 1', '9월 기타  기타 효과']);
  });

  it('부서장 의견은 도구별 빈칸만 만든다', () => {
    const opinion = report.rows.find((r) => r.key === 'opinion')!;
    expect(opinion.lines.map((l) => l.head)).toEqual(['Claude Team Premium Premium', '이미지 도구 Pro']);
    expect(opinion.lines.every((l) => l.muted)).toBe(true);
  });

  it('첨부 결과물은 팀명_결과물명 꼴로 채울 자리만 만든다', () => {
    const attachments = report.rows.find((r) => r.key === 'attachments')!;
    expect(cell(report, 'attachments')).toContain('첨부 1. 기획팀_결과물명');
    expect(attachments.lines.every((l) => l.muted)).toBe(true);
  });

  it('고쳐 쓴 칸은 같은 기간을 내보낼 때만 그 글을 쓰고, 고치기 전 내용도 함께 준다', () => {
    const key = '2026년 3분기(7. 1.~9. 30.)';
    const custom: Settings = {
      ...settings,
      reportEdits: { [key]: { opinion: 'Claude Team Premium  유지, 모두 매주 사용', attachments: '첨부 1. 기획팀_매뉴얼.pdf  초안과 수정본' } },
    };
    const edited = buildReport(q3, custom);
    expect(cell(edited, 'opinion')).toBe('Claude Team Premium  유지, 모두 매주 사용');
    expect(edited.rows.find((r) => r.key === 'opinion')!.lines[0]).toEqual({ head: 'Claude Team Premium', text: '유지, 모두 매주 사용' });
    expect(cell(edited, 'attachments')).toBe('첨부 1. 기획팀_매뉴얼.pdf  초안과 수정본');
    expect(edited.autoText.opinion).toContain('[유지, 증설, 감축, 반납 중 하나와 사유]');
    expect(cell(edited, 'tools')).toBe(cell(report, 'tools'));
    expect(cell(buildReport([rec('2026-10-02')], custom), 'opinion')).toContain('[유지, 증설, 감축, 반납 중 하나와 사유]');
  });

  it('칸 내용을 입력 칸 글로 바꿨다가 다시 읽으면 굵은 앞부분, 띄운 줄, 채울 자리가 그대로다', () => {
    for (const row of report.rows) expect(textToLines(linesToText(row.lines))).toEqual(row.lines);
    expect(textToLines('한계  없음\n\n  \n전체 3건\n[적을 자리]')).toEqual([
      { head: '한계', text: '없음' },
      { text: '전체 3건', gap: true },
      { text: '[적을 자리]', muted: true },
    ]);
  });

  it('여러 분기에 걸치면 기록 날짜 범위로 적고 기록이 있는 달만 센다', () => {
    const mixed = buildReport([rec('2026-09-08', { type: 'dev' }), rec('2026-10-05', { type: 'dev' })], settings);
    expect(mixed.quarter).toBeNull();
    expect(mixed.periodLabel).toBe('2026. 9. 8.~10. 5.');
    expect(cell(mixed, 'header')).toBe('기획팀, 홍길동, 2026. 9. 8.~10. 5.');
    expect(cell(mixed, 'outputs')).toContain('1) 개발 2건  9월 1건, 10월 1건');
  });

  it('해가 바뀌면 달에 해를 붙인다', () => {
    const span = buildReport([rec('2025-12-30'), rec('2026-01-02')], settings);
    expect(cell(span, 'header')).toContain('2025. 12. 30.~2026. 1. 2.');
    expect(cell(span, 'outputs')).toContain('2025년 12월 1건, 2026년 1월 1건');
  });

  it('비어 있는 설정은 빈칸 표시로 채운다', () => {
    const empty = buildReport([rec('2026-02-10')], blank);
    expect(cell(empty, 'header')).toBe('[부서], [작성자], 2026년 1분기(1. 1.~3. 31.)');
    expect(cell(empty, 'tools')).toContain('도구를 고르지 않은 기록 1건');
    expect(empty.rows.find((r) => r.key === 'attachments')!.lines[0].muted).toBe(true);
  });

  it('고쳐 쓴 보고 분기는 같은 기간을 내보낼 때만 쓴다', () => {
    const custom: Settings = { ...settings, periods: { '2026년 3분기(7. 1.~9. 30.)': '2026년 3분기(8. 1.~9. 30.)' } };
    const edited = buildReport(q3, custom);
    expect(edited.autoPeriodText).toBe('2026년 3분기(7. 1.~9. 30.)');
    expect(edited.periodText).toBe('2026년 3분기(8. 1.~9. 30.)');
    expect(cell(edited, 'header')).toBe('기획팀, 홍길동, 2026년 3분기(8. 1.~9. 30.)');
    const other = buildReport([rec('2026-10-02')], custom);
    expect(other.periodText).toBe('2026년 4분기(10. 1.~12. 31.)');
  });

  it('파일 이름은 팀명_기간_업무결과물보고서', () => {
    expect(reportFileName(report, settings)).toBe('기획팀_2026년3분기_업무결과물보고서.docx');
    const mixed = buildReport([rec('2026-09-08'), rec('2026-10-05')], blank);
    expect(reportFileName(mixed, blank)).toBe('20260908-20261005_업무결과물보고서.docx');
  });

  it('첫 쪽 보고서 본문을 빼면 파일 이름 끝이 업무기록', () => {
    expect(reportFileName(report, settings, false)).toBe('기획팀_2026년3분기_업무기록.docx');
  });

  it('가운데 점과 긴 줄표를 쓰지 않는다', () => {
    const all = report.rows.flatMap((r) => [r.label, r.sub ?? '', ...r.lines.map((l) => `${l.head ?? ''} ${l.text ?? ''}`)]).join('\n');
    expect(all).not.toMatch(/[·—–]/);
  });
});
