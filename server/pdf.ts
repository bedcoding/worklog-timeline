import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * 내보내기 창의 Word 미리보기와 같은 HTML 을 이 PC의 Chrome 이나 Edge 로 인쇄해 PDF 를 만듭니다.
 * 브라우저는 매번 빈 임시 프로필로 띄우고, 문서에 보안 정책(CSP)을 넣어 스크립트와 바깥 연결을 막습니다.
 * (브라우저 옵션으로 스크립트를 끄면 Chrome 이 PDF 인쇄를 하지 못해서 정책으로 막습니다.)
 */

/** 브라우저가 PDF 를 다 만들 때까지 기다리는 최대 시간(ms) */
const TIMEOUT = 60_000;

/** 문서 안 그림(data:)과 스타일만 쓰고, 바깥 주소는 아무것도 부르지 않게 합니다 */
const POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">`;

const FLAGS = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-sync',
  '--disable-background-networking',
  '--disable-component-update',
  // 쪽 위아래에 날짜와 파일 경로를 찍지 않습니다(버전에 따라 이름이 다른 두 옵션)
  '--no-pdf-header-footer',
  '--print-to-pdf-no-header',
];

/** 운영체제별로 Chrome, Edge, Chromium 이 흔히 깔리는 자리 */
export function browserCandidates(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA, 'C:\\Program Files', 'C:\\Program Files (x86)'];
    const list = roots
      .filter((root): root is string => !!root)
      .flatMap((root) => [
        path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]);
    return [...new Set(list)];
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];
}

/**
 * PDF 를 만들 브라우저를 찾습니다. own 은 .env.local 의 WORKLOG_BROWSER 로 정한 실행 파일이고, 있으면 먼저 씁니다.
 * 찾지 못하면 null 입니다.
 */
export function findBrowser(own?: string, exists: (file: string) => boolean = existsSync, candidates: string[] = browserCandidates()): string | null {
  for (const file of [own?.trim(), ...candidates]) {
    if (file && exists(file)) return file;
  }
  return null;
}

/** HTML 을 PDF 로 인쇄합니다. 쪽 크기와 여백은 HTML 의 @page 를 따릅니다. */
export async function htmlToPdf(html: string, browser: string, timeout = TIMEOUT): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worklog-pdf-'));
  try {
    const page = path.join(dir, 'page.html');
    const out = path.join(dir, 'out.pdf');
    await fs.writeFile(page, withPolicy(html), 'utf8');
    await run(browser, [...FLAGS, `--user-data-dir=${path.join(dir, 'profile')}`, `--print-to-pdf=${out}`, pathToFileURL(page).href], timeout);
    const pdf = await fs.readFile(out).catch(() => null);
    if (!pdf || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('브라우저가 PDF 파일을 만들지 못했어요.');
    return pdf;
  } finally {
    // 브라우저가 막 끝난 직후에는 프로필 파일을 잠시 붙잡고 있을 수 있어 몇 번 다시 시도합니다
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
}

function withPolicy(html: string): string {
  const head = /<head[^>]*>/i;
  return head.test(html) ? html.replace(head, (tag) => tag + POLICY) : POLICY + html;
}

/** 셸을 거치지 않고 실행합니다. 정해진 시간이 지나면 끕니다. */
function run(file: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PDF를 만드는 데 너무 오래 걸려요.'));
    }, timeout);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
