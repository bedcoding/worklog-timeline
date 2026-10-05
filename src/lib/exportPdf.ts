import { MARGIN } from './exportDocx';

/*
 * PDF 내보내기. 내보내기 창의 Word 미리보기를 그리는 라이브러리(docx-preview)로 같은 문서를 HTML 로 그리고,
 * 저장 서버가 이 PC의 Chrome 이나 Edge 로 A4 에 인쇄합니다. 그래서 PDF 가 미리보기와 같은 모양으로 나옵니다.
 * 서버에 쓸 브라우저가 없으면 이 브라우저의 인쇄 창을 열어 "PDF로 저장"으로 받게 합니다.
 */

/** Word 여백(twip)을 인쇄 여백(mm)으로 */
const mm = (twip: number) => `${Math.round((twip / 1440) * 25.4 * 10) / 10}mm`;

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * 미리보기는 쪽마다 회색 바탕 위 흰 종이로 그립니다. 인쇄할 때는 종이 테두리와 쪽 여백을 걷어 내고
 * A4 여백(@page)을 Word 문서와 같게 둡니다. 긴 쪽도 넘어가는 쪽마다 같은 여백이 생깁니다.
 * 표의 한 줄은 Word 문서처럼 쪽 사이에서 나누지 않습니다.
 */
function printStyle(prefix: string): string {
  return `
@page { size: A4; margin: ${mm(MARGIN.top)} ${mm(MARGIN.right)} ${mm(MARGIN.bottom)} ${mm(MARGIN.left)}; }
html, body { margin: 0; padding: 0; background: #fff; }
.${prefix}-wrapper { display: block !important; padding: 0 !important; background: none !important; }
.${prefix}-wrapper > section.${prefix} {
  width: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important;
  box-shadow: none !important; background: #fff !important;
}
.${prefix}-wrapper > section.${prefix} + section.${prefix} { break-before: page; }
tr { break-inside: avoid; }
img { break-inside: avoid; }
p { orphans: 2; widows: 2; }`;
}

/** Word 파일을 미리보기와 같은 모양의 인쇄용 HTML 로 그립니다. 그림은 파일 안에 data 주소로 넣습니다. */
export async function docxToPrintHtml(docx: Blob, title: string, prefix: string): Promise<string> {
  const { renderAsync } = await import('docx-preview');
  const host = document.createElement('div');
  await renderAsync(docx, host, undefined, { className: prefix, inWrapper: true, breakPages: true, useBase64URL: true });
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${printStyle(prefix)}</style></head>
<body>${host.innerHTML}</body></html>`;
}

/**
 * 인쇄 창을 엽니다. 저장 서버에 PDF 를 만들 브라우저가 없을 때 대신 씁니다.
 * 보이지 않는 틀에 문서를 넣고 그 틀만 인쇄하므로 앱 화면은 인쇄되지 않습니다.
 */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    const remove = () => frame.remove();
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        remove();
        reject(new Error('인쇄 창을 열지 못했어요.'));
        return;
      }
      win.addEventListener('afterprint', remove, { once: true });
      // 인쇄 창을 닫았다는 알림이 오지 않는 브라우저도 있어서, 오래 남지 않게 따로 치웁니다
      window.setTimeout(remove, 10 * 60_000);
      win.focus();
      win.print();
      resolve();
    };
    frame.srcdoc = html;
    document.body.append(frame);
  });
}
