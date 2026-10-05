import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildDocxExport } from './exportDocx';
import type { ImageEntry, Settings, WorkRecord } from './types';

const settings: Settings = {
  team: '기획팀',
  author: '홍길동',
  tools: [{ id: 'claude', name: 'Claude Team Premium', seat: 'Premium', note: '' }],
};

function rec(id: string, date: string, title: string, patch: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id,
    date,
    type: 'doc',
    toolIds: ['claude'],
    title,
    description: `${title} 설명`,
    effect: '',
    limitHit: false,
    images: [],
    sample: false,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

const records = [
  rec('a', '2026-07-14', '목록 화면 개선', { images: [{ id: 'img1', label: '화면 캡처', name: 'shot.png' }] }),
  rec('b', '2026-08-07', '날짜 입력 버그 수정'),
];
const images = new Map<string, ImageEntry>([['img1', { id: 'img1', name: 'shot.png', url: '/api/images/img1' }]]);
// 1x1 PNG. 브라우저 없이 만들 수 있게 이미지 변환은 건너뜁니다.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const toPng = async () => ({ data: PNG.buffer, width: 1, height: 1 });

/** 만든 Word 파일에서 본문과 문서 정보(제목)를 꺼냅니다 */
async function build(includeForm?: boolean) {
  const blob = await buildDocxExport(records, settings, images, { generatedOn: '2026-10-06', toPng, includeForm });
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return { body: await zip.file('word/document.xml')!.async('string'), core: await zip.file('docProps/core.xml')!.async('string') };
}

describe('Word 내보내기', () => {
  it('기본은 첫 쪽 보고서 본문 뒤 새 쪽에 기록 표를 담는다', async () => {
    const { body, core } = await build();
    expect(body).toContain('분기별 업무결과물 보고서');
    expect(body).toContain('1. 보고서 본문');
    expect(body).toContain('w:pageBreakBefore');
    expect(body).toContain('2026년 3분기(7. 1.~9. 30.), 날짜순 2건');
    expect(body).toContain('목록 화면 개선');
    expect(body).toContain('날짜 입력 버그 수정');
    expect(core).toContain('분기별 업무결과물 보고서 (2026년 3분기)');
  });

  it('기록 표 위에 대제목을 따로 달지 않는다', async () => {
    const { body } = await build();
    expect(body).not.toContain('기록과 증빙');
  });

  it('이미지가 없는 기록은 두 칸을 합쳐 내용만 넣는다', async () => {
    const { body } = await build();
    expect(body).not.toContain('이미지 없음');
    expect(body.match(/<w:gridSpan w:val="2"\/>/g)).toHaveLength(1);
  });

  it('증빙 이미지는 아래 설명 없이 이미지만 넣는다', async () => {
    const { body } = await build();
    expect(body).toContain('<w:drawing>');
    expect(body).not.toContain('화면 캡처');
  });

  it('첫 쪽을 빼면 양식 칸 없이 기록 표만 담는다', async () => {
    const { body, core } = await build(false);
    expect(body).not.toContain('분기별 업무결과물 보고서');
    expect(body).not.toContain('1. 보고서 본문');
    expect(body).not.toContain('홍길동');
    expect(body).not.toContain('w:pageBreakBefore');
    expect(body).toContain('2026년 3분기(7. 1.~9. 30.), 날짜순 2건');
    expect(body).toContain('목록 화면 개선');
    expect(body).toContain('날짜 입력 버그 수정');
    expect(core).toContain('업무 기록 (2026년 3분기)');
  });
});
