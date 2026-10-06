import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildDocxExport, type DocxOptions } from './exportDocx';
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
const images = new Map<string, ImageEntry>(['img1', 'img2', 'img3'].map((id) => [id, { id, name: `${id}.png`, url: `/api/images/${id}` }]));
// 1x1 PNG. 브라우저 없이 만들 수 있게 이미지 변환은 건너뜁니다.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const toPng = async () => ({ data: PNG.buffer, width: 1, height: 1 });

/** 만든 Word 파일에서 본문과 문서 정보(제목)를 꺼냅니다 */
async function build(options: Partial<DocxOptions> = {}, list: WorkRecord[] = records) {
  const blob = await buildDocxExport(list, settings, images, { generatedOn: '2026-10-06', toPng, ...options });
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
    const { body, core } = await build({ includeForm: false });
    expect(body).not.toContain('분기별 업무결과물 보고서');
    expect(body).not.toContain('1. 보고서 본문');
    expect(body).not.toContain('홍길동');
    expect(body).not.toContain('w:pageBreakBefore');
    expect(body).toContain('2026년 3분기(7. 1.~9. 30.), 날짜순 2건');
    expect(body).toContain('목록 화면 개선');
    expect(body).toContain('날짜 입력 버그 수정');
    expect(core).toContain('업무 기록 (2026년 3분기)');
  });

  it('이미지를 내용 아래에 넣으면 칸 하나짜리 표에 칸 이름 줄 없이 담는다', async () => {
    const { body } = await build({ includeForm: false, imagesBelow: true });
    expect(body).not.toContain('<w:tblHeader');
    expect(body).toContain('<w:gridCol w:w="9638"/>');
    expect(body).not.toContain('<w:gridCol w:w="5300"/>');
    expect(body).not.toContain('<w:gridSpan');
    expect(body).toContain('목록 화면 개선');
    expect(body).toContain('날짜 입력 버그 수정');
  });

  it('내용 아래에 넣는 이미지는 옆 칸보다 크게 넣는다', async () => {
    // 가로 1400px 화면 캡처는 옆 칸에서 폭 330px, 내용 아래에서 폭 620px로 줄입니다(1px는 9525 EMU)
    const shot = async () => ({ data: PNG.buffer, width: 1400, height: 380 });
    const side = await build({ toPng: shot });
    const below = await build({ toPng: shot, imagesBelow: true });
    expect(side.body).toContain(`cx="${330 * 9525}" cy="${90 * 9525}"`);
    expect(below.body).toContain(`cx="${620 * 9525}" cy="${168 * 9525}"`);
  });

  it('내용 아래에 넣는 이미지가 여러 장이면 첫 장은 내용과 같은 줄에, 나머지는 한 장씩 다음 줄에 넣고 줄 사이에 선을 긋지 않는다', async () => {
    const shots = ['img1', 'img2', 'img3'].map((id) => ({ id, label: '화면 캡처', name: `${id}.png` }));
    const list = [rec('a', '2026-07-14', '목록 화면 개선', { images: shots }), rec('b', '2026-08-07', '날짜 입력 버그 수정')];
    const { body } = await build({ includeForm: false, imagesBelow: true }, list);
    // 기록 a는 세 줄, 기록 b는 한 줄입니다
    const rows = body.split('<w:tr>').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('목록 화면 개선');
    expect(rows[0]).toContain('<w:drawing>');
    expect(rows[1]).toContain('<w:drawing>');
    expect(rows[2]).toContain('<w:drawing>');
    expect(rows[3]).toContain('날짜 입력 버그 수정');
    // 기록 a의 줄 사이 두 곳만 선을 지웁니다
    expect(body.match(/<w:bottom w:val="nil"/g)).toHaveLength(2);
    expect(body.match(/<w:top w:val="nil"/g)).toHaveLength(2);
    expect(rows[3]).not.toContain('w:val="nil"');
  });
});
