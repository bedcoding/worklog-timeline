import { describe, expect, it } from 'vitest';
import { browserCandidates, findBrowser, htmlToPdf } from './pdf.ts';

describe('PDF 만들 브라우저 찾기', () => {
  it('윈도우는 Program Files 와 사용자 폴더의 Chrome, Edge 를 본다', () => {
    const list = browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' });
    expect(list).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(list).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
    expect(list).toContain('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
    expect(new Set(list).size).toBe(list.length);
  });

  it('맥과 리눅스는 흔히 깔리는 자리를 본다', () => {
    expect(browserCandidates('darwin', {})[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    expect(browserCandidates('linux', {})).toContain('/usr/bin/chromium');
  });

  it('직접 정한 실행 파일이 있으면 먼저 쓰고, 아무것도 없으면 null', () => {
    const exists = (file: string) => file === '/my/chrome' || file === '/b';
    expect(findBrowser('/my/chrome', exists, ['/a', '/b'])).toBe('/my/chrome');
    expect(findBrowser('/없는/경로', exists, ['/a', '/b'])).toBe('/b');
    expect(findBrowser(undefined, () => false, ['/a'])).toBeNull();
  });
});

// 이 PC에 Chrome 이나 Edge 가 있을 때만 실제로 인쇄해 봅니다
const browser = findBrowser(process.env.WORKLOG_BROWSER);

describe('HTML 을 PDF 로', () => {
  it.skipIf(!browser)(
    '한글 문서를 A4 PDF 로 만든다',
    async () => {
      const html = '<!doctype html><html><head><meta charset="utf-8"><style>@page { size: A4; margin: 15mm 20mm; }</style></head><body><h1>분기별 업무결과물 보고서</h1><p>한글 문서</p></body></html>';
      const pdf = await htmlToPdf(html, browser!);
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(pdf.length).toBeGreaterThan(1000);
    },
    60_000,
  );
});
