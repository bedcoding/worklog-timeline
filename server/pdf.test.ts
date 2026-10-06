import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { browserCandidates, findBrowser, htmlToPdf, printPdf } from './pdf.ts';

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

describe('브라우저가 PDF를 다 쓰기를 기다리기', () => {
  const PDF = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n';
  let dir: string;
  let out: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worklog-pdf-test-'));
    out = path.join(dir, 'out.pdf');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 브라우저 대신 node를 띄웁니다. body에서 out에 무엇을 쓰고 언제 끝날지 정합니다. */
  const fake = (body: string) => ['-e', `const fs = require('fs'); const out = ${JSON.stringify(out)}; fs.writeFileSync(out + '.pid', String(process.pid)); ${body}`];

  /** 가짜 브라우저가 아직 떠 있는지 봅니다 */
  async function alive(): Promise<boolean> {
    const pid = Number(await fs.readFile(out + '.pid', 'utf8'));
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it('PDF를 다 쓰고도 끝나지 않으면 기다리지 않고 끈다', async () => {
    const started = Date.now();
    const pdf = await printPdf(process.execPath, fake(`fs.writeFileSync(out, ${JSON.stringify(PDF)}); setInterval(() => {}, 1000);`), out, 30_000);
    expect(pdf?.toString('latin1')).toBe(PDF);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await alive()).toBe(false);
  });

  it('PDF를 쓰지 않고 끝나면 null', async () => {
    expect(await printPdf(process.execPath, fake(''), out, 30_000)).toBeNull();
  });

  it('끝까지 쓰지 않은 PDF는 다 쓴 것으로 보지 않고, 시간이 지나면 끄고 실패로 본다', async () => {
    await expect(printPdf(process.execPath, fake(`fs.writeFileSync(out, '%PDF-1.7\\n1 0 obj'); setInterval(() => {}, 1000);`), out, 500)).rejects.toThrow('너무 오래');
    expect(await alive()).toBe(false);
  });

  it('브라우저를 실행하지 못하면 그 오류를 낸다', async () => {
    await expect(printPdf(path.join(dir, '없는 브라우저'), [], out, 30_000)).rejects.toThrow('ENOENT');
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
