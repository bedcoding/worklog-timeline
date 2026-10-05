import {
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { shortDate, weekdayKo } from './dates';
import { blobToPng, fetchImageBlob, imageSize, type Png } from './images';
import { buildReport, toolNames, type ReportLine, type ReportRow } from './report';
import type { ImageEntry, Settings, WorkRecord } from './types';
import { isOffline } from './util';
import { WORK_TYPES } from './workTypes';

/** 문서 제목은 전자결재 양식 이름 그대로 씁니다 */
const FORM_TITLE = '분기별 업무결과물 보고서';
const FONT = 'Malgun Gothic';
const MUTED = '71786F';
const PLACEHOLDER = '8C8C8C';
/** 결재 양식 문서와 같은 A4 여백과 표 폭(twip) */
const PAGE = { width: 11906, height: 16838 };
export const MARGIN = { top: 850, right: 1134, bottom: 850, left: 1134 };
const LABEL_WIDTH = 2268;
const BODY_WIDTH = 7370;
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const CELL_MARGINS = { top: 80, bottom: 40, left: 108, right: 108 };
/** 표 안 글자 9pt */
const CELL_TEXT = 18;
/** 본문 폭과 쪽 높이에 들어가는 이미지 크기(px) */
const MAX_IMAGE_WIDTH = 600;
const MAX_IMAGE_HEIGHT = 860;
/** 이보다 넓은 이미지는 줄여서 넣습니다(문서 크기) */
const MAX_SOURCE_WIDTH = 1400;

export interface DocxOptions {
  /** 내보낸 날 */
  generatedOn: string;
  /** 같은 이미지를 여러 번 바꾸지 않도록 미리보기 창이 넘기는 변환 함수 */
  toPng?: (url: string) => Promise<Png>;
  onProgress?: (done: number, total: number) => void;
  /** 범위를 바꿔 다시 만들 때 하던 일을 멈춥니다 */
  signal?: AbortSignal;
}

/** 저장 서버의 이미지를 Word 에 넣을 PNG 로 준비합니다 */
export async function imageToPng(url: string): Promise<Png> {
  const blob = await fetchImageBlob(url);
  // 캡처는 대개 PNG 라서, 폭이 넘치지 않으면 다시 그리지 않고 원본을 그대로 넣습니다(미리보기가 훨씬 빨라짐)
  if (blob.type === 'image/png') {
    const { width, height } = await imageSize(blob);
    if (width > 0 && height > 0 && width <= MAX_SOURCE_WIDTH) return { data: await blob.arrayBuffer(), width, height };
  }
  return blobToPng(blob, MAX_SOURCE_WIDTH);
}

/** 줄바꿈을 Word 줄바꿈으로 바꿉니다 */
function textRuns(text: string, style: { color?: string; size?: number } = {}): TextRun[] {
  return text.split(/\r?\n/).map((line, i) => new TextRun({ text: line, break: i ? 1 : undefined, ...style }));
}

function lineParagraph(line: ReportLine): Paragraph {
  const runs: TextRun[] = [];
  if (line.head) runs.push(new TextRun({ text: line.head, bold: true, size: CELL_TEXT }));
  if (line.text) {
    runs.push(new TextRun({ text: line.head ? `  ${line.text}` : line.text, size: CELL_TEXT, color: line.muted ? PLACEHOLDER : undefined }));
  }
  return new Paragraph({ spacing: { before: line.gap ? 120 : 0, after: 60, line: 288 }, children: runs });
}

/** 전자결재 양식과 같은 두 칸 표. 왼쪽은 회색 칸 이름, 오른쪽은 채운 내용입니다. */
function reportTable(rows: ReportRow[]): Table {
  return new Table({
    width: { size: LABEL_WIDTH + BODY_WIDTH, type: WidthType.DXA },
    columnWidths: [LABEL_WIDTH, BODY_WIDTH],
    layout: TableLayoutType.FIXED,
    borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER },
    rows: rows.map(
      (row) =>
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: LABEL_WIDTH, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' },
              margins: CELL_MARGINS,
              children: [
                new Paragraph({ spacing: { after: 60, line: 288 }, children: [new TextRun({ text: row.label, bold: true, size: CELL_TEXT })] }),
                ...(row.sub ? [new Paragraph({ spacing: { after: 60, line: 288 }, children: textRuns(row.sub, { size: CELL_TEXT }) })] : []),
              ],
            }),
            new TableCell({
              width: { size: BODY_WIDTH, type: WidthType.DXA },
              margins: CELL_MARGINS,
              children: row.lines.map(lineParagraph),
            }),
          ],
        }),
    ),
  });
}

/** Word(.docx) 문서. 첫 쪽은 전자결재 양식 칸 순서대로 채운 표, 다음 쪽부터 기록과 증빙 이미지입니다. */
export async function buildDocxExport(
  records: readonly WorkRecord[],
  settings: Settings,
  images: Map<string, ImageEntry>,
  options: DocxOptions,
): Promise<Blob> {
  const report = buildReport(records, settings);
  const list = report.records;
  const toPng = options.toPng ?? imageToPng;
  const total = list.reduce((n, r) => n + r.images.length, 0);
  let done = 0;
  options.onProgress?.(done, total);

  // 머리 부분은 결재 양식 문서와 같은 글자 크기와 간격으로 씁니다
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(FORM_TITLE)] }),
    new Paragraph({
      spacing: { after: 40, line: 300 },
      children: [new TextRun({ text: `${report.periodLabel}, ${settings.team.trim() || '[부서]'}`, size: 19 })],
    }),
    new Paragraph({
      spacing: { after: 240, line: 300 },
      children: [new TextRun({ text: `업무 기록 ${list.length}건, 증빙 ${total}장. ${options.generatedOn} 내보냄`, color: MUTED, size: 17 })],
    }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. 보고서 본문')] }),
    reportTable(report.rows),
    new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun('2. 기록과 증빙')] }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: `${report.periodText}, 날짜순 ${list.length}건`, color: MUTED, size: 17 })],
    }),
  ];

  for (const r of list) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 360, after: 60 },
        keepNext: true,
        children: [new TextRun(`${shortDate(r.date)} ${weekdayKo(r.date)}  ${r.title}`)],
      }),
    );
    const tags = [WORK_TYPES[r.type].label, ...toolNames(r, settings)];
    if (r.featured) tags.push(`대표 결과물 [첨부 ${report.featured.indexOf(r) + 1}]`);
    if (r.limitHit) tags.push('사용 한도 도달');
    children.push(new Paragraph({ spacing: { after: 80 }, keepNext: true, children: [new TextRun({ text: tags.join(', '), color: MUTED, size: 17 })] }));
    if (r.description.trim()) children.push(new Paragraph({ spacing: { after: 80 }, children: textRuns(r.description.trim()) }));
    if (r.effect.trim()) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: '효과와 메모  ', bold: true }), ...textRuns(r.effect.trim())],
        }),
      );
    }
    for (const ref of r.images) {
      options.signal?.throwIfAborted();
      const entry = images.get(ref.id);
      try {
        if (!entry) throw new Error('missing');
        const png = await toPng(entry.url);
        const scale = Math.min(1, MAX_IMAGE_WIDTH / png.width, MAX_IMAGE_HEIGHT / png.height);
        const width = Math.max(1, Math.round(png.width * scale));
        const height = Math.max(1, Math.round(png.height * scale));
        children.push(
          new Paragraph({
            spacing: { before: 160 },
            keepNext: true,
            children: [new ImageRun({ type: 'png', data: png.data, transformation: { width, height } })],
          }),
          new Paragraph({ children: [new TextRun({ text: ref.label, color: '8A9182', size: 17 })] }),
        );
      } catch (err) {
        // 서버가 꺼졌으면 이미지마다 빈칸을 넣지 않고 문서 만들기를 멈춥니다
        if (isOffline(err)) throw err;
        children.push(new Paragraph({ children: [new TextRun({ text: `이미지를 넣지 못했어요: ${ref.name}`, color: MUTED, size: 17 })] }));
      }
      done += 1;
      options.onProgress?.(done, total);
    }
  }
  options.signal?.throwIfAborted();

  const doc = new Document({
    creator: 'Worklog',
    title: `${FORM_TITLE} (${report.periodLabel})`,
    styles: {
      default: {
        document: { run: { font: FONT, size: 20, color: '000000' } },
        title: { run: { font: FONT, size: 30, bold: true, color: '000000' }, paragraph: { spacing: { before: 0, after: 40, line: 300 } } },
        heading1: { run: { font: FONT, size: 23, bold: true, color: '000000' }, paragraph: { spacing: { before: 0, after: 120, line: 300 } } },
        heading2: { run: { font: FONT, size: 21, bold: true, color: '000000' } },
      },
    },
    sections: [{ properties: { page: { size: PAGE, margin: MARGIN } }, children }],
  });
  return Packer.toBlob(doc);
}
