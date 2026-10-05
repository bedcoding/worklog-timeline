import * as fs from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApiHandler } from './api.ts';
import { createStorage } from './storage.ts';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ID = 'a1b2c3d4e5f6a7b8';

let dir: string;
let server: Server;
let port: number;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worklog-api-'));
  const handler = createApiHandler(createStorage(dir), {
    dataDir: dir,
    dataPath: '/data',
    // 실제 브라우저 대신, 'no-browser' 가 든 문서는 브라우저가 없는 PC 처럼 답합니다
    makePdf: async (html) => (html.includes('no-browser') ? null : Buffer.from(`%PDF-1.7 ${html.length}`)),
  });
  server = createServer((req, res) =>
    handler(req, res, () => {
      res.end('next');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

function call(method: string, url: string, options: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Reply> {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method, path: url, headers: { host: `localhost:${port}`, ...options.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const WRITE = { 'content-type': 'application/json', 'x-worklog': '1' };

const recordBody = {
  record: { id: ID, date: '2026-10-01', title: '자동화 도구', type: 'dev', images: [{ id: 'img1', label: '증빙 1', name: 'a.png' }] },
  uploads: [{ id: 'img1', dataUrl: PNG }],
};

describe('저장 서버 주소', () => {
  it('기록을 저장하고 이미지 파일을 내려준다', async () => {
    const saved = await call('PUT', `/api/records/${ID}`, { headers: WRITE, body: recordBody });
    expect(saved.status).toBe(200);
    expect(JSON.parse(saved.text).record.images[0].file).toBe('1.png');

    const data = JSON.parse((await call('GET', '/api/data')).text);
    expect(data.records).toHaveLength(1);
    expect(data.dataDir).toBe(dir);

    const image = await call('GET', `/api/files/${ID}/1.png?v=img1`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['cross-origin-resource-policy']).toBe('same-origin');
    const again = await call('GET', `/api/files/${ID}/1.png`, { headers: { 'if-none-match': String(image.headers.etag) } });
    expect(again.status).toBe(304);
  });

  it('localhost 가 아닌 Host 는 거절한다', async () => {
    expect((await call('GET', '/api/data', { headers: { host: 'evil.example:5173' } })).status).toBe(403);
  });

  it('다른 사이트에서 온 요청은 거절한다', async () => {
    expect((await call('GET', '/api/data', { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await call('GET', '/api/data', { headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403);
    const fromOtherOrigin = await call('PUT', `/api/records/${ID}`, { headers: { ...WRITE, origin: 'http://evil.example' }, body: recordBody });
    expect(fromOtherOrigin.status).toBe(403);
  });

  it('쓰기 요청은 X-Worklog 헤더와 JSON 이 있어야 받는다', async () => {
    expect((await call('PUT', `/api/records/${ID}`, { headers: { 'content-type': 'application/json' }, body: recordBody })).status).toBe(403);
    expect((await call('PUT', `/api/records/${ID}`, { headers: { 'content-type': 'text/plain', 'x-worklog': '1' }, body: recordBody })).status).toBe(403);
    expect((await call('OPTIONS', `/api/records/${ID}`)).status).toBe(403);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('주소의 id 와 기록 id 가 다르면 거절한다', async () => {
    expect((await call('PUT', '/api/records/ffff0000ffff0000', { headers: WRITE, body: recordBody })).status).toBe(400);
  });

  it('데이터 폴더 파일을 다른 주소로 바로 내주지 않는다', async () => {
    await call('PUT', `/api/records/${ID}`, { headers: WRITE, body: recordBody });
    expect((await call('GET', '/data/records/2026-10-01_a1b2c3d4/record.json')).status).toBe(404);
    expect((await call('GET', `/@fs/${dir.replace(/\\/g, '/')}/settings.json`)).status).toBe(404);
    expect((await call('GET', `/api/files/${ID}/..%2F..%2Fsettings.json`)).status).toBe(404);
  });

  it('문서 HTML 을 PDF 로 만들어 돌려준다', async () => {
    const pdf = await call('POST', '/api/pdf', { headers: WRITE, body: { html: '<p>보고서</p>' } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.text.startsWith('%PDF-')).toBe(true);
  });

  it('PDF 를 만들 브라우저가 없으면 501, 문서가 없으면 400 으로 알린다', async () => {
    const none = await call('POST', '/api/pdf', { headers: WRITE, body: { html: '<p>no-browser</p>' } });
    expect(none.status).toBe(501);
    expect(JSON.parse(none.text).error).toContain('Chrome');
    expect((await call('POST', '/api/pdf', { headers: WRITE, body: {} })).status).toBe(400);
    expect((await call('POST', '/api/pdf', { headers: { 'content-type': 'application/json' }, body: { html: '<p>x</p>' } })).status).toBe(403);
  });

  it('api 가 아닌 주소는 다음 처리로 넘긴다', async () => {
    expect((await call('GET', '/src/main.tsx')).text).toBe('next');
  });
});
