import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { findBrowser, htmlToPdf } from './pdf.ts';
import { CONTENT_TYPES, StorageError, type Storage } from './storage.ts';

/*
 * 화면이 기록을 읽고 쓰는 주소(/api/...).
 *
 * 다른 웹사이트가 이 PC의 서버로 몰래 요청을 보내 기록을 읽거나 바꾸지 못하게 막습니다.
 * - Host 가 localhost 가 아니면 거절합니다(DNS 리바인딩 차단).
 * - 다른 사이트에서 온 요청(Sec-Fetch-Site)과 다른 출처(Origin)의 쓰기 요청을 거절합니다.
 * - 쓰기 요청은 JSON 과 X-Worklog 헤더가 있어야 받습니다. 다른 사이트는 이 헤더를 붙여 보낼 수 없습니다.
 * - 응답은 다른 출처에서 읽거나 끼워 넣지 못하게 헤더를 붙입니다.
 */

const MAX_BODY_BYTES = 200 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

type Next = (err?: unknown) => void;

export interface ApiOptions {
  /** 데이터 폴더의 실제 경로. 개발 서버가 이 폴더의 파일을 주소로 바로 내주지 않게 막을 때 씁니다. */
  dataDir: string;
  /** 데이터 폴더가 프로젝트 안에 있으면 그 주소(예: /data) */
  dataPath: string | null;
  /** PDF 를 만들 브라우저 실행 파일(.env.local 의 WORKLOG_BROWSER). 비우면 Chrome, Edge 가 흔히 깔리는 자리에서 찾습니다. */
  browser?: string;
  /** HTML 을 PDF 로 바꾸는 함수. 테스트에서 바꿔 끼웁니다. 브라우저가 없으면 null 을 돌려줍니다. */
  makePdf?: (html: string) => Promise<Buffer | null>;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const normalizePath = (p: string) => safeDecode(p).replace(/\\/g, '/').toLowerCase();

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, err: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof StorageError) {
    send(res, err.status, { error: err.message });
    return;
  }
  console.error('[worklog]', err);
  send(res, 500, { error: `저장하지 못했어요. ${err instanceof Error ? err.message : String(err)}` });
}

/** 거절할 이유가 있으면 그 이유를, 괜찮으면 null */
function checkRequest(req: IncomingMessage, method: string): string | null {
  const host = req.headers.host ?? '';
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, '').toLowerCase())) return '이 PC에서 연 화면에서만 쓸 수 있어요.';
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return '다른 사이트에서 온 요청은 받지 않아요.';
  if (method === 'GET' || method === 'HEAD') return null;
  if (req.headers['x-worklog'] !== '1') return '앱 화면에서 보낸 요청이 아니에요.';
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return '다른 사이트에서 온 요청은 받지 않아요.';
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return 'JSON 요청만 받아요.';
  return null;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new StorageError(413, '한 번에 보내는 내용이 너무 커요.');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new StorageError(400, 'JSON 형식이 올바르지 않아요.');
  }
}

/** 데이터 폴더를 파일 탐색기로 엽니다. 정해진 명령에 폴더 경로만 넘기고 셸은 거치지 않습니다. */
async function openFolder(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [dir], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function createApiHandler(storage: Storage, options: ApiOptions) {
  const makePdf =
    options.makePdf ??
    (async (html: string) => {
      const browser = findBrowser(options.browser);
      return browser ? htmlToPdf(html, browser) : null;
    });
  const dataPath = options.dataPath ? normalizePath(options.dataPath).replace(/\/$/, '') : null;
  const dataAbs = normalizePath(options.dataDir).replace(/\/$/, '');

  /** /data/... 나 /@fs/D:/.../data/... 처럼 데이터 폴더 파일을 바로 가리키는 주소 */
  const isDataUrl = (pathname: string) => {
    const p = normalizePath(pathname);
    if (dataPath && (p === dataPath || p.startsWith(`${dataPath}/`))) return true;
    const i = p.indexOf(dataAbs);
    return i >= 0 && (p.length === i + dataAbs.length || p[i + dataAbs.length] === '/');
  };

  async function sendImage(req: IncomingMessage, res: ServerResponse, recordId: string, file: string): Promise<void> {
    const filePath = await storage.imageFile(recordId, file);
    const stat = filePath ? await fs.stat(filePath).catch(() => null) : null;
    if (!filePath || !stat?.isFile()) {
      send(res, 404, { error: '이미지 파일을 찾지 못했어요.' });
      return;
    }
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // 이미지 주소를 새 탭에서 바로 열어도 SVG 안의 스크립트가 돌지 않게 합니다
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    if (req.headers['if-none-match'] === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    await pipeline(createReadStream(filePath), res);
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? 'GET';
    const denied = checkRequest(req, method);
    if (denied) {
      send(res, 403, { error: denied });
      return;
    }
    const [, resource, a, b, extra] = url.pathname.split('/').filter(Boolean).map(safeDecode);
    if (extra !== undefined) {
      send(res, 404, { error: '없는 주소예요.' });
      return;
    }

    if (method === 'GET' || method === 'HEAD') {
      if (resource === 'data' && !a) send(res, 200, await storage.load());
      else if (resource === 'files' && a && b) await sendImage(req, res, a, b);
      else send(res, 404, { error: '없는 주소예요.' });
      return;
    }

    const body = await readJson(req);
    if (method === 'POST' && resource === 'init' && !a) {
      const result = await storage.init(body);
      send(res, 200, { ...result, data: await storage.load() });
    } else if (method === 'POST' && resource === 'samples' && !a) {
      const result = await storage.addSamples(body);
      send(res, 200, { ...result, data: await storage.load() });
    } else if (method === 'PUT' && resource === 'records' && a && !b) {
      const record = (body as { record?: { id?: unknown } } | null)?.record;
      if (record?.id !== a) throw new StorageError(400, '주소와 기록 id 가 달라요.');
      send(res, 200, { record: await storage.saveRecord(body) });
    } else if (method === 'POST' && resource === 'records' && a === 'delete' && !b) {
      send(res, 200, { deleted: await storage.deleteRecords(body) });
    } else if (method === 'PUT' && resource === 'settings' && !a) {
      send(res, 200, { settings: await storage.saveSettings(body) });
    } else if (method === 'POST' && resource === 'reset' && !a) {
      send(res, 200, { trash: await storage.reset() });
    } else if (method === 'POST' && resource === 'pdf' && !a) {
      const html = (body as { html?: unknown } | null)?.html;
      if (typeof html !== 'string' || !html.trim()) throw new StorageError(400, 'PDF로 만들 문서가 없어요.');
      let pdf: Buffer | null;
      try {
        pdf = await makePdf(html);
      } catch (err) {
        throw new StorageError(500, `PDF를 만들지 못했어요. ${err instanceof Error ? err.message : String(err)}`);
      }
      // 화면은 501 을 받으면 브라우저 인쇄 창으로 PDF 를 저장하게 안내합니다
      if (!pdf) throw new StorageError(501, '이 PC에서 PDF를 만들 Chrome이나 Edge를 찾지 못했어요.');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', pdf.length);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.end(pdf);
    } else if (method === 'POST' && resource === 'open-folder' && !a) {
      await openFolder(storage.dataDir);
      send(res, 200, { ok: true });
    } else {
      send(res, 404, { error: '없는 주소예요.' });
    }
  }

  return function handle(req: IncomingMessage, res: ServerResponse, next: Next): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (isDataUrl(url.pathname)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }
    route(req, res, url).catch((err: unknown) => sendError(res, err));
  };
}
