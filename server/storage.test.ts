import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkRecord } from '../src/lib/types.ts';
import { createStorage, type Storage } from './storage.ts';

/** 1x1 PNG */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ID = 'a1b2c3d4e5f6a7b8';

function record(patch: Partial<WorkRecord> = {}): WorkRecord {
  return {
    id: ID,
    date: '2026-10-01',
    title: '자동화 도구',
    type: 'dev',
    description: '',
    effect: '',
    toolIds: [],
    limitHit: false,
    sample: false,
    images: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

let dir: string;
let storage: Storage;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worklog-test-'));
  storage = createStorage(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const ls = async (sub: string) => (await fs.readdir(path.join(dir, sub)).catch(() => [] as string[])).sort();
const readJson = async (sub: string) => JSON.parse(await fs.readFile(path.join(dir, sub), 'utf8'));

describe('데이터 폴더 저장소', () => {
  it('빈 폴더에만 첫 내용을 넣는다', async () => {
    expect((await storage.load()).initialized).toBe(false);
    const first = await storage.init({ settings: { team: '기획팀', author: '', tools: [] }, records: [{ record: record(), uploads: [] }] });
    expect(first).toEqual({ applied: true, failed: [] });
    const second = await storage.init({ settings: {}, records: [{ record: record({ id: 'ffff0000ffff0000' }), uploads: [] }] });
    expect(second.applied).toBe(false);
    const snap = await storage.load();
    expect(snap.initialized).toBe(true);
    expect(snap.settings?.team).toBe('기획팀');
    expect(snap.records.map((r) => r.id)).toEqual([ID]);
  });

  it('동시에 init 해도 한 번만 들어간다', async () => {
    const results = await Promise.all([
      storage.init({ settings: {}, records: [{ record: record(), uploads: [] }] }),
      storage.init({ settings: {}, records: [{ record: record({ id: 'ffff0000ffff0000' }), uploads: [] }] }),
    ]);
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(await ls('records')).toHaveLength(1);
  });

  it('기록 하나를 폴더 하나에 record.json 과 번호 붙은 원본 이미지로 저장한다', async () => {
    const saved = await storage.saveRecord({
      record: record({ images: [{ id: 'img1', label: '증빙 1', name: 'capture.png' }] }),
      uploads: [{ id: 'img1', dataUrl: PNG }],
    });
    expect(saved.images[0].file).toBe('1.png');
    expect(await ls('records')).toEqual(['2026-10-01_a1b2c3d4']);
    expect(await ls('records/2026-10-01_a1b2c3d4')).toEqual(['1.png', 'record.json']);
    const json = await readJson('records/2026-10-01_a1b2c3d4/record.json');
    expect(json.title).toBe('자동화 도구');
    expect(json.images).toEqual([{ id: 'img1', label: '증빙 1', name: 'capture.png', file: '1.png' }]);
    const bytes = await fs.readFile(path.join(dir, 'records/2026-10-01_a1b2c3d4/1.png'));
    expect(bytes.equals(Buffer.from(PNG.split(',')[1], 'base64'))).toBe(true);
  });

  it('날짜를 바꾸면 폴더 이름을 바꾸고, 뺀 이미지는 trash 로 옮긴다', async () => {
    const first = await storage.saveRecord({
      record: record({
        images: [
          { id: 'img1', label: 'a', name: 'a.png' },
          { id: 'img2', label: 'b', name: 'b.png' },
        ],
      }),
      uploads: [
        { id: 'img1', dataUrl: PNG },
        { id: 'img2', dataUrl: PNG },
      ],
    });
    const next = await storage.saveRecord({
      record: { ...first, date: '2026-10-03', images: [first.images[1], { id: 'img3', label: 'c', name: 'c.png' }] },
      uploads: [{ id: 'img3', dataUrl: PNG }],
    });
    expect(next.images.map((i) => i.file)).toEqual(['2.png', '3.png']);
    expect(await ls('records')).toEqual(['2026-10-03_a1b2c3d4']);
    expect(await ls('records/2026-10-03_a1b2c3d4')).toEqual(['2.png', '3.png', 'record.json']);
    const trash = await ls('trash');
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatch(/^\d{8}-\d{6}_2026-10-03_a1b2c3d4_1\.png$/);
  });

  it('지운 기록은 폴더째 trash 로 옮긴다', async () => {
    await storage.saveRecord({ record: record(), uploads: [] });
    expect(await storage.deleteRecords({ ids: [ID, 'nope'] })).toEqual([ID]);
    expect(await ls('records')).toEqual([]);
    expect((await ls('trash'))[0]).toMatch(/^\d{8}-\d{6}_2026-10-01_a1b2c3d4$/);
    expect((await storage.load()).records).toEqual([]);
  });

  it('reset 은 records 폴더를 통째로 trash 로 옮기고 설정은 남긴다', async () => {
    await storage.saveSettings({ team: '기획팀', author: '', tools: [] });
    await storage.saveRecord({ record: record(), uploads: [] });
    expect(await storage.reset()).toMatch(/^trash\/\d{8}-\d{6}_records$/);
    const snap = await storage.load();
    expect(snap.records).toEqual([]);
    expect(snap.settings?.team).toBe('기획팀');
  });

  it('동시에 저장해도 둘 다 남는다', async () => {
    await Promise.all([
      storage.saveRecord({ record: record(), uploads: [] }),
      storage.saveRecord({ record: record({ id: 'ffff0000ffff0000' }), uploads: [] }),
    ]);
    expect((await storage.load()).records).toHaveLength(2);
  });

  it('깨진 record.json 과 없는 이미지는 problems 로 알리고 나머지는 읽는다', async () => {
    await storage.saveRecord({ record: record({ images: [{ id: 'img1', label: 'a', name: 'a.png' }] }), uploads: [{ id: 'img1', dataUrl: PNG }] });
    await storage.saveRecord({ record: record({ id: 'ffff0000ffff0000', date: '2026-10-02' }), uploads: [] });
    await fs.writeFile(path.join(dir, 'records/2026-10-02_ffff0000/record.json'), '{ broken');
    await fs.rm(path.join(dir, 'records/2026-10-01_a1b2c3d4/1.png'));
    const snap = await storage.load();
    expect(snap.records.map((r) => r.id)).toEqual([ID]);
    expect(snap.problems.map((p) => p.folder).sort()).toEqual(['2026-10-01_a1b2c3d4', '2026-10-02_ffff0000']);
  });

  it('같은 기록이 두 폴더에 있으면 하나만 읽고 알린다', async () => {
    await storage.saveRecord({ record: record(), uploads: [] });
    await fs.cp(path.join(dir, 'records/2026-10-01_a1b2c3d4'), path.join(dir, 'records/2026-10-01_a1b2c3d4-copy'), { recursive: true });
    const snap = await storage.load();
    expect(snap.records).toHaveLength(1);
    expect(snap.problems).toEqual([{ folder: '2026-10-01_a1b2c3d4-copy', message: expect.stringContaining('같은 기록') }]);
  });

  it('서버가 켜진 뒤 직접 넣은 폴더도 같은 기록이면 그 폴더에 저장한다', async () => {
    await storage.load();
    await fs.mkdir(path.join(dir, 'records/2026-10-01_a1b2c3d4'), { recursive: true });
    await fs.writeFile(path.join(dir, 'records/2026-10-01_a1b2c3d4/record.json'), JSON.stringify(record()));
    await storage.saveRecord({ record: record({ title: '고친 제목' }), uploads: [] });
    expect(await ls('records')).toEqual(['2026-10-01_a1b2c3d4']);
    expect((await readJson('records/2026-10-01_a1b2c3d4/record.json')).title).toBe('고친 제목');
  });

  it('깨진 settings.json 은 지우지 않고 trash 로 옮긴 뒤 기본값으로 연다', async () => {
    await fs.writeFile(path.join(dir, 'settings.json'), 'not json');
    const snap = await storage.load();
    expect(snap.settings).toBeNull();
    expect(snap.problems[0].folder).toBe('settings.json');
    expect((await ls('trash'))[0]).toMatch(/_settings\.json$/);
  });

  it('이상한 id, 받지 않는 이미지 형식, 이상한 파일 이름은 거절하고 아무것도 쓰지 않는다', async () => {
    await expect(storage.saveRecord({ record: record({ id: '../escape' }), uploads: [] })).rejects.toMatchObject({ status: 400 });
    await expect(
      storage.saveRecord({
        record: record({ images: [{ id: 'img1', label: 'a', name: 'a.html' }] }),
        uploads: [{ id: 'img1', dataUrl: 'data:text/html;base64,PGgxPmhpPC9oMT4=' }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await ls('records')).toEqual([]);
    await storage.saveRecord({ record: record(), uploads: [] });
    expect(await storage.imageFile(ID, '../settings.json')).toBeNull();
    expect(await storage.imageFile('../x', '1.png')).toBeNull();
  });

  it('임시 파일을 남기지 않는다', async () => {
    await storage.saveSettings({ team: 'a', author: '', tools: [] });
    await storage.saveRecord({ record: record({ images: [{ id: 'img1', label: 'a', name: 'a.png' }] }), uploads: [{ id: 'img1', dataUrl: PNG }] });
    const all = [...(await ls('.')), ...(await ls('records/2026-10-01_a1b2c3d4'))];
    expect(all.some((name) => name.endsWith('.tmp'))).toBe(false);
  });
});

describe('예시 데이터(data-sample) 넣기', () => {
  let sampleDir: string;

  /** 예시 폴더: 기록 둘(9/28, 10/4)과 그림 한 장, 설정 */
  beforeEach(async () => {
    sampleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'worklog-sample-'));
    const put = async (folder: string, rec: WorkRecord, image?: string) => {
      await fs.mkdir(path.join(sampleDir, 'records', folder), { recursive: true });
      await fs.writeFile(path.join(sampleDir, 'records', folder, 'record.json'), JSON.stringify(rec));
      if (image) await fs.writeFile(path.join(sampleDir, 'records', folder, image), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    };
    await put('a', record({ id: 'sample01', date: '2026-09-28', sample: true, toolIds: ['tool-a'] }));
    await put('b', record({ id: 'sample02', date: '2026-10-04', sample: true, images: [{ id: 'sample02a', label: '화면', name: 'x.svg', file: '1.svg' }] }), '1.svg');
    await fs.writeFile(path.join(sampleDir, 'settings.json'), JSON.stringify({ team: '', author: '', tools: [{ id: 'tool-a', name: '도구', seat: '', note: '' }] }));
    storage = createStorage(dir, sampleDir);
  });

  afterEach(async () => {
    await fs.rm(sampleDir, { recursive: true, force: true });
  });

  it('비어 있는 데이터 폴더를 예시로 채우고, 가장 최근 예시가 오늘이 되게 날짜를 옮긴다', async () => {
    const first = await storage.addSamples({ initial: true, today: '2027-01-10' });
    expect(first.applied).toBe(true);
    expect(first.records.map((r) => r.date).sort()).toEqual(['2027-01-04', '2027-01-10']);
    const snap = await storage.load();
    expect(snap.initialized).toBe(true);
    expect(snap.settings?.tools.map((t) => t.name)).toEqual(['도구']);
    expect(await ls('records')).toEqual(['2027-01-04_sample01', '2027-01-10_sample02']);
    expect(await ls('records/2027-01-10_sample02')).toEqual(['1.svg', 'record.json']);
    expect(snap.problems).toEqual([]);
  });

  it('처음 채우기는 한 번만 한다', async () => {
    await storage.addSamples({ initial: true, today: '2027-01-10' });
    const again = await storage.addSamples({ initial: true, today: '2027-01-10' });
    expect(again.applied).toBe(false);
    expect((await ls('records')).length).toBe(2);
  });

  it('예시 다시 넣기는 이미 있는 기록을 건너뛰고 지금 쓰는 도구로 바꾼다', async () => {
    await storage.saveRecord({ record: record({ id: 'sample01', date: '2026-09-28', sample: true }), uploads: [] });
    const res = await storage.addSamples({ today: '2026-10-04', toolId: 'tool-b' });
    expect(res.records.map((r) => r.id)).toEqual(['sample02']);
    expect(res.records[0].toolIds).toEqual(['tool-b']);
    expect((await readJson('records/2026-10-04_sample02/record.json')).toolIds).toEqual(['tool-b']);
  });

  it('저장소에 들어 있는 data-sample 폴더가 깨지지 않고 그대로 들어간다', async () => {
    const real = createStorage(dir, path.resolve('data-sample'));
    const folders = (await fs.readdir(path.resolve('data-sample', 'records'))).length;
    const res = await real.addSamples({ initial: true, today: '2027-03-15' });
    expect(res.records).toHaveLength(folders);
    expect(res.records.every((r) => r.sample)).toBe(true);
    expect(res.records.map((r) => r.date).sort().pop()).toBe('2027-03-15');
    expect((await real.load()).problems).toEqual([]);
  });

  it('예시 폴더가 없으면 알려 준다', async () => {
    const none = createStorage(dir, path.join(sampleDir, 'missing'));
    await expect(none.addSamples({ initial: true })).rejects.toThrow('예시 폴더');
    expect((await none.load()).initialized).toBe(false);
  });
});
