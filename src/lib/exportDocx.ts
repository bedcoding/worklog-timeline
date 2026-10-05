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
import { buildReport, type ReportLine, type ReportRow } from './report';
import type { ImageEntry, Settings, WorkRecord } from './types';
import { isOffline } from './util';

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
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER };
const GRAY = { type: ShadingType.CLEAR, color: 'auto', fill: 'D9D9D9' };
const CELL_MARGINS = { top: 80, bottom: 40, left: 108, right: 108 };
/** 표 안 글자 9pt, 작은 글자 8.5pt */
const CELL_TEXT = 18;
const SMALL_TEXT = 17;
/** 기록 표: 왼쪽 증빙 칸과 오른쪽 작업 칸의 폭(twip). 합은 양식 표와 같습니다. */
const SHOT_WIDTH = 5300;
const NOTE_WIDTH = LABEL_WIDTH + BODY_WIDTH - SHOT_WIDTH;
/** 증빙 칸에 들어가는 이미지 크기(px). 칸 폭에서 안쪽 여백을 뺀 만큼입니다. */
const MAX_IMAGE_WIDTH = 330;
const MAX_IMAGE_HEIGHT = 460;
/** 이보다 넓은 이미지는 줄여서 넣습니다(문서 크기) */
const MAX_SOURCE_WIDTH = 1400;

export interface DocxOptions {
  /** 내보낸 날 */
  generatedOn: string;
  /** 첫 쪽 보고서 본문(결재 양식 칸)을 넣을지. 빼면 기록 표만 담습니다. 기본은 넣습니다. */
  includeForm?: boolean;
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

function cell(children: Paragraph[], width: number, shaded = false, columnSpan?: number): TableCell {
  return new TableCell({ width: { size: width, type: WidthType.DXA }, margins: CELL_MARGINS, shading: shaded ? GRAY : undefined, columnSpan, children });
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
    borders: BORDERS,
    rows: rows.map(
      (row) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell(
              [
                new Paragraph({ spacing: { after: 60, line: 288 }, children: [new TextRun({ text: row.label, bold: true, size: CELL_TEXT })] }),
                ...(row.sub ? [new Paragraph({ spacing: { after: 60, line: 288 }, children: textRuns(row.sub, { size: CELL_TEXT }) })] : []),
              ],
              LABEL_WIDTH,
              true,
            ),
            cell(row.lines.length ? row.lines.map(lineParagraph) : [new Paragraph({})], BODY_WIDTH),
          ],
        }),
    ),
  });
}

const headCell = (text: string, width: number) =>
  cell([new Paragraph({ spacing: { line: 288 }, children: [new TextRun({ text, bold: true, size: CELL_TEXT })] })], width, true);

/**
 * Word(.docx) 문서. 첫 쪽은 전자결재 양식 칸 순서대로 채운 표, 다음 쪽부터 기록마다 증빙 이미지와 내용을 한 줄씩 담은 표입니다.
 * 첫 쪽을 빼면(포트폴리오나 결과물만 낼 때) 기록 표만 담습니다.
 */
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
  const withForm = options.includeForm !== false;
  let done = 0;
  options.onProgress?.(done, total);

  // 머리 부분은 결재 양식 문서와 같은 글자 크기와 간격으로 씁니다
  const children: (Paragraph | Table)[] = withForm
    ? [
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
      ]
    : [];
  // 기록 표는 새 쪽에서 시작하고, 제목 없이 기간과 건수만 작게 적습니다
  children.push(
    new Paragraph({
      pageBreakBefore: withForm,
      spacing: { after: 120 },
      children: [new TextRun({ text: `${report.periodText}, 날짜순 ${list.length}건`, color: MUTED, size: 17 })],
    }),
  );

  // 기록마다 한 줄: 왼쪽은 증빙 이미지, 오른쪽은 날짜, 제목, 내용과 효과(앱의 상세 화면과 같은 배치). 이미지가 없으면 두 칸을 합칩니다.
  const rows: TableRow[] = [new TableRow({ tableHeader: true, cantSplit: true, children: [headCell('증빙', SHOT_WIDTH), headCell('작업', NOTE_WIDTH)] })];
  for (const r of list) {
    const shots: Paragraph[] = [];
    for (const ref of r.images) {
      options.signal?.throwIfAborted();
      const entry = images.get(ref.id);
      try {
        if (!entry) throw new Error('missing');
        const png = await toPng(entry.url);
        const scale = Math.min(1, MAX_IMAGE_WIDTH / png.width, MAX_IMAGE_HEIGHT / png.height);
        const width = Math.max(1, Math.round(png.width * scale));
        const height = Math.max(1, Math.round(png.height * scale));
        // 이미지 아래에 설명은 달지 않습니다. 여러 장이면 사이만 조금 띄웁니다.
        shots.push(
          new Paragraph({
            spacing: { before: shots.length ? 120 : 0 },
            children: [new ImageRun({ type: 'png', data: png.data, transformation: { width, height } })],
          }),
        );
      } catch (err) {
        // 서버가 꺼졌으면 이미지마다 빈칸을 넣지 않고 문서 만들기를 멈춥니다
        if (isOffline(err)) throw err;
        shots.push(new Paragraph({ children: [new TextRun({ text: `이미지를 넣지 못했어요: ${ref.name}`, color: MUTED, size: SMALL_TEXT })] }));
      }
      done += 1;
      options.onProgress?.(done, total);
    }

    // 유형과 도구는 첫 쪽 표에 모아 적으므로 기록마다 되풀이하지 않습니다. 사용 한도에 닿은 기록만 표시합니다.
    const notes: Paragraph[] = [
      new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${shortDate(r.date)} ${weekdayKo(r.date)}`, color: MUTED, size: SMALL_TEXT })] }),
      new Paragraph({ spacing: { after: 100, line: 288 }, children: [new TextRun({ text: r.title, bold: true, size: 20 })] }),
    ];
    if (r.limitHit) notes.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: '사용 한도 도달', color: MUTED, size: SMALL_TEXT })] }));
    if (r.description.trim()) notes.push(new Paragraph({ spacing: { after: 100, line: 288 }, children: textRuns(r.description.trim(), { size: CELL_TEXT }) }));
    if (r.effect.trim()) {
      notes.push(
        new Paragraph({
          spacing: { line: 288 },
          children: [new TextRun({ text: '효과와 메모  ', bold: true, size: CELL_TEXT }), ...textRuns(r.effect.trim(), { size: CELL_TEXT })],
        }),
      );
    }
    const cells = shots.length ? [cell(shots, SHOT_WIDTH), cell(notes, NOTE_WIDTH)] : [cell(notes, SHOT_WIDTH + NOTE_WIDTH, false, 2)];
    rows.push(new TableRow({ cantSplit: true, children: cells }));
  }
  children.push(
    new Table({
      width: { size: SHOT_WIDTH + NOTE_WIDTH, type: WidthType.DXA },
      columnWidths: [SHOT_WIDTH, NOTE_WIDTH],
      layout: TableLayoutType.FIXED,
      borders: BORDERS,
      rows,
    }),
  );
  options.signal?.throwIfAborted();

  const doc = new Document({
    creator: 'Worklog',
    title: `${withForm ? FORM_TITLE : '업무 기록'} (${report.periodLabel})`,
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
