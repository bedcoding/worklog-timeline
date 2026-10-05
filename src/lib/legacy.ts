import { openDB } from 'idb';
import type { RecordPayload } from './api';
import { blobToDataURL } from './images';
import { normalizeRecord, normalizeSettings } from './normalize';
import type { Settings, WorkRecord } from './types';

/*
 * 예전 버전은 기록을 브라우저 IndexedDB 에 저장했습니다.
 * 그 기록을 데이터 폴더로 옮길 때만 읽고, 옮긴 뒤에도 지우지 않고 그대로 둡니다(옮겼다는 표시만 남김).
 */

/** 예전 버전이 쓰던 저장소 이름(앱 이름을 바꾸기 전 이름). 그 저장소를 찾을 때만 씁니다. */
const LEGACY_DB = 'ai-worklog-timeline';

export interface LegacyData {
  settings: Settings | null;
  records: WorkRecord[];
  blobs: Map<string, Blob>;
  /** 이미 데이터 폴더로 옮긴 적이 있는지 */
  migrated: boolean;
}

/** 이 브라우저에 예전 저장소가 없거나 읽을 수 없으면 null. 없는 저장소를 새로 만들지 않습니다. */
export async function readLegacy(): Promise<LegacyData | null> {
  try {
    if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return null;
    if (!(await indexedDB.databases()).some((d) => d.name === LEGACY_DB)) return null;
    const db = await openDB(LEGACY_DB);
    try {
      const stores = ['records', 'images', 'meta'];
      if (!stores.every((name) => db.objectStoreNames.contains(name))) return null;
      const tx = db.transaction(stores, 'readonly');
      const [rawRecords, rawImages, rawSettings, migratedAt] = await Promise.all([
        tx.objectStore('records').getAll(),
        tx.objectStore('images').getAll(),
        tx.objectStore('meta').get('settings'),
        tx.objectStore('meta').get('migratedAt'),
      ]);
      await tx.done;
      const blobs = new Map<string, Blob>();
      for (const img of rawImages as { id?: unknown; blob?: unknown }[]) {
        if (typeof img?.id === 'string' && img.blob instanceof Blob) blobs.set(img.id, img.blob);
      }
      return {
        settings: rawSettings ? normalizeSettings(rawSettings) : null,
        records: (rawRecords as unknown[]).map(normalizeRecord).filter((r): r is WorkRecord => !!r),
        blobs,
        migrated: typeof migratedAt === 'string',
      };
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** 옮겼다는 표시를 남겨, 다음에 열 때 다시 묻지 않게 합니다 */
export async function markLegacyMigrated(): Promise<void> {
  try {
    const db = await openDB(LEGACY_DB);
    try {
      if (db.objectStoreNames.contains('meta')) await db.put('meta', new Date().toISOString(), 'migratedAt');
    } finally {
      db.close();
    }
  } catch {
    // 표시를 못 남겨도 옮긴 기록은 그대로입니다. 다음에 다시 물으면 이미 있는 기록은 건너뜁니다.
  }
}

/** 예전 기록을 저장 서버로 보낼 모양으로 바꿉니다. 이미지가 없어진 참조는 뺍니다. */
export async function legacyPayloads(legacy: LegacyData, records: WorkRecord[]): Promise<RecordPayload[]> {
  const payloads: RecordPayload[] = [];
  for (const record of records) {
    const refs = record.images.filter((ref) => legacy.blobs.has(ref.id));
    const uploads = await Promise.all(refs.map(async (ref) => ({ id: ref.id, dataUrl: await blobToDataURL(legacy.blobs.get(ref.id)!) })));
    payloads.push({ record: { ...record, images: refs.map((ref) => ({ id: ref.id, label: ref.label, name: ref.name })) }, uploads });
  }
  return payloads;
}
