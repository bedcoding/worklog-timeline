import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fromDay, isValidISO, toDay, todayISO } from '../src/lib/dates.ts';
import { normalizeRecord, normalizeSettings, SAFE_ID, SAFE_IMAGE_FILE } from '../src/lib/normalize.ts';
import type { ImageRef, Settings, WorkRecord } from '../src/lib/types.ts';

/*
 * 기록을 데이터 폴더에 파일로 저장합니다.
 *
 *   settings.json                  부서, 작성자, 도구, 고쳐 쓴 보고 분기
 *   records/
 *     2026-10-01_a1b2c3d4/         기록 하나가 폴더 하나 (날짜_기록 id 앞 8자리)
 *       record.json                기록 내용
 *       1.png, 2.png               붙여 넣은 증빙 이미지 원본
 *   trash/                         지운 기록과 이미지. 바로 없애지 않고 여기로 옮깁니다.
 *
 * 폴더 이름은 탐색기에서 찾기 쉽게 붙인 것이고, 날짜와 id 는 record.json 안의 값을 씁니다.
 * 파일은 임시 파일에 다 쓴 뒤 바꿔치기해서, 저장 도중에 꺼져도 반쯤 쓴 파일이 남지 않습니다.
 */

export interface Problem {
  folder: string;
  message: string;
}

export interface Snapshot {
  dataDir: string;
  initialized: boolean;
  settings: Settings | null;
  records: WorkRecord[];
  problems: Problem[];
}

export interface InitResult {
  applied: boolean;
  failed: string[];
}

/** 사용자에게 그대로 보여 줄 수 있는 오류. status 는 HTTP 응답 코드입니다. */
export class StorageError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  // 예시 그림만 SVG 입니다. 사용자가 넣는 이미지는 화면에서 PNG, JPG, WebP, GIF 로 막습니다.
  'image/svg+xml': 'svg',
};

export const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const isCode = (err: unknown, ...codes: string[]) =>
  !!err && typeof err === 'object' && codes.includes(String((err as { code?: unknown }).code));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** 윈도우는 백신이나 검색 색인이 파일을 잠깐 잡고 있으면 이름 바꾸기가 실패해서, 조금씩 기다리며 다시 시도합니다 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      if (attempt >= 6 || !isCode(err, 'EPERM', 'EACCES', 'EBUSY')) throw err;
      await wait(40 * 2 ** attempt);
    }
  }
}

/** 같은 폴더의 임시 파일에 다 쓰고 디스크에 내려보낸 뒤, 원래 이름으로 바꿔치기합니다 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await fs.open(tmp, 'wx');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

/** name 이 이미 있으면 확장자 앞에 -2, -3 을 붙인 이름을 돌려줍니다 */
async function freeName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; await exists(path.join(dir, candidate)); n++) candidate = `${base}-${n}${ext}`;
  return candidate;
}

function decodeDataUrl(dataUrl: string): { ext: string; data: Buffer } {
  const comma = dataUrl.indexOf(',');
  const head = /^data:([^;,]+)((?:;[^;,]*)*)$/.exec(comma > 0 ? dataUrl.slice(0, comma) : '');
  if (!head) throw new StorageError(400, '이미지 데이터 형식이 올바르지 않아요.');
  const ext = IMAGE_EXTENSIONS[head[1].toLowerCase()];
  if (!ext) throw new StorageError(400, 'PNG, JPG, WebP, GIF 이미지만 저장할 수 있어요.');
  const body = dataUrl.slice(comma + 1);
  const data = head[2].split(';').includes('base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  if (!data.length) throw new StorageError(400, '빈 이미지는 저장할 수 없어요.');
  if (data.length > MAX_IMAGE_BYTES) throw new StorageError(413, '이미지는 10MB 이하만 저장할 수 있어요.');
  return { ext, data };
}

/** 새 이미지로 받은 값: 이미지 id 와 데이터 URL */
function parseUploads(raw: unknown): Map<string, string> {
  const uploads = new Map<string, string>();
  if (!Array.isArray(raw)) return uploads;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, dataUrl } = item as Record<string, unknown>;
    if (typeof id === 'string' && SAFE_ID.test(id) && typeof dataUrl === 'string') uploads.set(id, dataUrl);
  }
  return uploads;
}

/** 폴더에 있는 1.png, 2.jpg 같은 이름 가운데 가장 큰 번호 다음 번호 */
function nextImageNumber(files: Iterable<string>): number {
  let max = 0;
  for (const name of files) {
    const n = Number(/^(\d+)\./.exec(name)?.[1] ?? 0);
    if (n > max) max = n;
  }
  return max + 1;
}

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export type Storage = ReturnType<typeof createStorage>;

/**
 * dataDir: 기록을 저장하는 데이터 폴더
 * sampleDir: 예시 데이터 폴더(data-sample). 데이터 폴더와 같은 구조이고, 비어 있는 데이터 폴더를 처음 채울 때 씁니다.
 */
export function createStorage(dataDir: string, sampleDir: string | null = null) {
  const recordsDir = path.join(dataDir, 'records');
  const trashDir = path.join(dataDir, 'trash');
  const settingsFile = path.join(dataDir, 'settings.json');

  /** 기록 id 에서 폴더 이름. 폴더를 다시 읽을 때마다 새로 만듭니다. */
  let folders = new Map<string, string>();
  let scanned = false;

  // 쓰기와 폴더 읽기는 한 번에 하나씩 합니다. 탭 두 개에서 동시에 저장해도 서로 끼어들지 않습니다.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function list(dir: string, kind: 'dir' | 'file'): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => (kind === 'dir' ? e.isDirectory() : e.isFile()))
        .map((e) => e.name)
        .sort();
    } catch (err) {
      if (isCode(err, 'ENOENT')) return [];
      throw err;
    }
  }

  async function readRecordAt(folder: string): Promise<WorkRecord | null> {
    try {
      return normalizeRecord(JSON.parse(await fs.readFile(path.join(recordsDir, folder, 'record.json'), 'utf8')));
    } catch {
      return null;
    }
  }

  async function scan(): Promise<{ records: WorkRecord[]; problems: Problem[] }> {
    const next = new Map<string, string>();
    const records: WorkRecord[] = [];
    const problems: Problem[] = [];
    for (const folder of await list(recordsDir, 'dir')) {
      const dir = path.join(recordsDir, folder);
      let raw: unknown;
      try {
        raw = JSON.parse(await fs.readFile(path.join(dir, 'record.json'), 'utf8'));
      } catch (err) {
        problems.push({
          folder,
          message: isCode(err, 'ENOENT') ? 'record.json 파일이 없어요.' : 'record.json 파일을 읽지 못했어요. 내용이 깨졌을 수 있어요.',
        });
        continue;
      }
      const record = normalizeRecord(raw);
      if (!record) {
        problems.push({ folder, message: 'record.json 에 id, 날짜, 제목이 올바르게 들어 있지 않아요.' });
        continue;
      }
      const other = next.get(record.id);
      if (other) {
        problems.push({ folder, message: `${other} 폴더와 같은 기록이라 건너뛰었어요.` });
        continue;
      }
      next.set(record.id, folder);
      const files = new Set(await list(dir, 'file'));
      const missing = record.images.filter((img) => !img.file || !files.has(img.file));
      if (missing.length) problems.push({ folder, message: `이미지 파일이 없어요: ${missing.map((img) => img.file ?? img.name).join(', ')}` });
      records.push(record);
    }
    folders = next;
    scanned = true;
    return { records, problems };
  }

  /** 파일이나 폴더를 trash 로 옮기고, 옮긴 자리를 돌려줍니다 */
  async function moveToTrash(source: string, label: string): Promise<string> {
    await fs.mkdir(trashDir, { recursive: true });
    const name = await freeName(trashDir, `${stamp()}_${label}`);
    await renameWithRetry(source, path.join(trashDir, name));
    return `trash/${name}`;
  }

  async function readSettings(problems: Problem[]): Promise<Settings | null> {
    let text: string;
    try {
      text = await fs.readFile(settingsFile, 'utf8');
    } catch (err) {
      if (isCode(err, 'ENOENT')) return null;
      throw err;
    }
    try {
      return normalizeSettings(JSON.parse(text));
    } catch {
      // 깨진 설정 파일은 지우지 않고 trash 로 옮긴 뒤 기본 설정으로 엽니다
      const moved = await moveToTrash(settingsFile, 'settings.json');
      problems.push({ folder: 'settings.json', message: `설정 파일이 깨져 있어서 ${moved} 로 옮기고 기본 설정으로 열었어요.` });
      return null;
    }
  }

  async function load(): Promise<Snapshot> {
    const problems: Problem[] = [];
    const settings = await readSettings(problems);
    const result = await scan();
    const initialized = settings !== null || (await list(recordsDir, 'dir')).length > 0;
    return { dataDir, initialized, settings, records: result.records, problems: [...problems, ...result.problems] };
  }

  const folderNameFor = (record: WorkRecord) => `${record.date}_${record.id.slice(0, 8)}`;

  /** 날짜를 바꾸면 폴더 이름도 바꿉니다. 다른 프로그램이 폴더를 잡고 있어 실패하면 원래 이름을 그대로 씁니다. */
  async function renameFolder(from: string, wanted: string): Promise<string> {
    const to = await freeName(recordsDir, wanted);
    try {
      await renameWithRetry(path.join(recordsDir, from), path.join(recordsDir, to));
      return to;
    } catch (err) {
      console.warn(`[worklog] 폴더 이름을 바꾸지 못해 그대로 둡니다: ${from} (${err instanceof Error ? err.message : String(err)})`);
      return from;
    }
  }

  async function saveRecord(input: unknown): Promise<WorkRecord> {
    const body = asObject(input);
    const record = normalizeRecord(body.record);
    if (!record) throw new StorageError(400, '기록 내용이 올바르지 않아요. 날짜와 제목을 확인해 주세요.');
    // 받은 이미지를 먼저 모두 확인합니다. 하나라도 잘못되면 아무 파일도 건드리지 않습니다.
    const uploads = parseUploads(body.uploads);
    const decoded = new Map<string, { ext: string; data: Buffer }>();
    for (const ref of record.images) {
      const dataUrl = uploads.get(ref.id);
      if (dataUrl) decoded.set(ref.id, decodeDataUrl(dataUrl));
    }
    if (!scanned) await scan();

    const wanted = folderNameFor(record);
    let folder = folders.get(record.id);
    // 서버가 켜진 뒤 누가 폴더를 직접 넣었을 수도 있어서, 같은 이름의 폴더가 있으면 확인합니다
    if (!folder && (await readRecordAt(wanted))?.id === record.id) folder = wanted;
    const previous = folder ? await readRecordAt(folder) : null;
    const created = !folder;
    if (!folder) {
      folder = await freeName(recordsDir, wanted);
      await fs.mkdir(path.join(recordsDir, folder), { recursive: true });
    } else if (folder !== wanted && !folder.startsWith(`${wanted}-`)) {
      folder = await renameFolder(folder, wanted);
    }
    const dir = path.join(recordsDir, folder);

    // 새 이미지를 먼저 쓰고 record.json 을 마지막에 씁니다. 도중에 멈추면 쓰다 만 이미지만 남고 기록은 그대로입니다.
    const files = new Set(await list(dir, 'file'));
    let number = nextImageNumber(files);
    const images: ImageRef[] = [];
    let saved: WorkRecord;
    try {
      for (const ref of record.images) {
        const upload = decoded.get(ref.id);
        if (upload) {
          const file = `${number++}.${upload.ext}`;
          await writeFileAtomic(path.join(dir, file), upload.data);
          files.add(file);
          images.push({ ...ref, file });
          continue;
        }
        // 이미 있던 이미지는 이전 record.json 의 파일 이름을 그대로 씁니다
        const file = previous?.images.find((img) => img.id === ref.id)?.file;
        if (file) images.push({ ...ref, file });
      }
      saved = { ...record, images };
      await writeFileAtomic(path.join(dir, 'record.json'), json(saved));
    } catch (err) {
      // 새로 만든 폴더면 쓰다 만 파일과 함께 치웁니다. 원래 있던 기록 폴더는 그대로 둡니다.
      if (created) await fs.rm(dir, { recursive: true, force: true });
      throw err;
    }
    folders.set(saved.id, folder);

    // 기록에서 뺀 이미지는 trash 로 옮깁니다. 옮기지 못해도 기록 저장은 끝났으므로 실패로 보지 않습니다.
    const kept = new Set(images.map((img) => img.file));
    for (const img of previous?.images ?? []) {
      if (!img.file || kept.has(img.file) || !files.has(img.file)) continue;
      try {
        await moveToTrash(path.join(dir, img.file), `${folder}_${img.file}`);
      } catch (err) {
        console.warn(`[worklog] 뺀 이미지를 trash 로 옮기지 못했어요: ${folder}/${img.file}`, err);
      }
    }
    return saved;
  }

  async function deleteRecords(input: unknown): Promise<string[]> {
    const ids = asObject(input).ids;
    if (!Array.isArray(ids)) throw new StorageError(400, '지울 기록을 알려 주세요.');
    const wanted = ids.filter((id): id is string => typeof id === 'string');
    if (!scanned || wanted.some((id) => !folders.has(id))) await scan();
    const deleted: string[] = [];
    for (const id of wanted) {
      const folder = folders.get(id);
      if (!folder) continue;
      await moveToTrash(path.join(recordsDir, folder), folder);
      folders.delete(id);
      deleted.push(id);
    }
    return deleted;
  }

  async function saveSettings(input: unknown): Promise<Settings> {
    const settings = normalizeSettings(input);
    await fs.mkdir(dataDir, { recursive: true });
    await writeFileAtomic(settingsFile, json(settings));
    return settings;
  }

  /** 기록 폴더를 통째로 trash 로 옮깁니다(모두 지우기, 백업으로 모두 바꾸기). 설정은 남깁니다. */
  async function reset(): Promise<string | null> {
    if (!(await list(recordsDir, 'dir')).length) return null;
    let moved: string;
    try {
      moved = await moveToTrash(recordsDir, 'records');
    } catch {
      throw new StorageError(409, 'records 폴더를 옮기지 못했어요. 그 안의 파일을 연 프로그램을 닫고 다시 시도해 주세요.');
    }
    await fs.mkdir(recordsDir, { recursive: true });
    folders = new Map();
    scanned = true;
    return moved;
  }

  /** 비어 있는 데이터 폴더에만 첫 내용(예시 기록이나 예전 브라우저 저장소의 기록)을 넣습니다 */
  async function init(input: unknown): Promise<InitResult> {
    const body = asObject(input);
    if ((await exists(settingsFile)) || (await list(recordsDir, 'dir')).length) return { applied: false, failed: [] };
    await fs.mkdir(recordsDir, { recursive: true });
    // 설정을 먼저 써 둡니다. 기록을 넣다가 멈춰도 다음에 또 넣지 않습니다.
    await saveSettings(body.settings ?? {});
    const failed: string[] = [];
    for (const item of Array.isArray(body.records) ? body.records : []) {
      try {
        await saveRecord(item);
      } catch (err) {
        const title = asObject(asObject(item).record).title;
        failed.push(`${typeof title === 'string' ? title : '제목 없음'}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { applied: true, failed };
  }

  /**
   * 예시 폴더의 기록을 데이터 폴더에 넣습니다. 날짜는 가장 최근 예시가 today 가 되게 다 같이 옮겨서,
   * 언제 열어도 최근 30일 보기에 예시가 보입니다.
   * initial 이면 비어 있는 데이터 폴더에만 넣고 예시 설정도 같이 씁니다. 아니면 이미 있는 기록(같은 id)은 건너뜁니다.
   */
  async function addSamples(input: unknown): Promise<{ applied: boolean; records: WorkRecord[] }> {
    const body = asObject(input);
    const initial = body.initial === true;
    if (initial && ((await exists(settingsFile)) || (await list(recordsDir, 'dir')).length)) return { applied: false, records: [] };
    const sampleRecords = sampleDir ? path.join(sampleDir, 'records') : '';
    const samples: { folder: string; record: WorkRecord }[] = [];
    for (const folder of sampleRecords ? await list(sampleRecords, 'dir') : []) {
      try {
        const record = normalizeRecord(JSON.parse(await fs.readFile(path.join(sampleRecords, folder, 'record.json'), 'utf8')));
        if (record) samples.push({ folder, record });
      } catch {
        // 읽지 못한 예시는 건너뜁니다
      }
    }
    if (!sampleDir || !samples.length) throw new StorageError(404, '예시 폴더(data-sample)를 찾지 못했어요.');

    await fs.mkdir(recordsDir, { recursive: true });
    if (initial) {
      // 예시 설정을 먼저 써 둡니다. 기록을 넣다가 멈춰도 다음에 또 넣지 않습니다.
      let settings: unknown = {};
      try {
        settings = JSON.parse(await fs.readFile(path.join(sampleDir, 'settings.json'), 'utf8'));
      } catch {
        // 예시 설정이 없으면 빈 설정으로 시작합니다
      }
      await saveSettings(settings);
    }
    if (!scanned) await scan();
    const today = isValidISO(body.today) ? body.today : todayISO();
    const toolId = typeof body.toolId === 'string' && body.toolId ? body.toolId : null;
    const shift = toDay(today) - Math.max(...samples.map((s) => toDay(s.record.date)));
    const added: WorkRecord[] = [];
    for (const { folder, record: sample } of samples) {
      if (folders.has(sample.id)) continue;
      const record: WorkRecord = { ...sample, date: fromDay(toDay(sample.date) + shift), toolIds: toolId ? [toolId] : sample.toolIds };
      const name = await freeName(recordsDir, folderNameFor(record));
      const target = path.join(recordsDir, name);
      await fs.mkdir(target);
      try {
        for (const img of record.images) {
          if (img.file) await fs.copyFile(path.join(sampleRecords, folder, img.file), path.join(target, img.file));
        }
        await writeFileAtomic(path.join(target, 'record.json'), json(record));
      } catch (err) {
        await fs.rm(target, { recursive: true, force: true });
        throw err;
      }
      folders.set(record.id, name);
      added.push(record);
    }
    return { applied: true, records: added };
  }

  /** 이미지 파일의 실제 경로. 없거나 이름이 이상하면 null */
  async function imageFile(recordId: string, file: string): Promise<string | null> {
    if (!SAFE_ID.test(recordId) || !SAFE_IMAGE_FILE.test(file)) return null;
    if (!folders.has(recordId)) await exclusive(scan);
    const folder = folders.get(recordId);
    return folder ? path.join(recordsDir, folder, file) : null;
  }

  return {
    dataDir,
    load: () => exclusive(load),
    init: (input: unknown) => exclusive(() => init(input)),
    addSamples: (input: unknown) => exclusive(() => addSamples(input)),
    saveRecord: (input: unknown) => exclusive(() => saveRecord(input)),
    deleteRecords: (input: unknown) => exclusive(() => deleteRecords(input)),
    saveSettings: (input: unknown) => exclusive(() => saveSettings(input)),
    reset: () => exclusive(reset),
    imageFile,
  };
}
