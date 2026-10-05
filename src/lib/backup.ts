import { blobToDataURL, fetchImageBlob } from './images';
import { normalizeRecord, normalizeSettings } from './normalize';
import type { ImageEntry, Settings, WorkRecord } from './types';

/**
 * 백업 파일(JSON). 기록, 설정, 이미지(데이터 URL)를 파일 하나에 담습니다.
 * 다른 PC로 옮기거나 팀원 기록을 모을 때 씁니다. 데이터 폴더를 통째로 복사해도 백업이 됩니다.
 */
export const BACKUP_APP = 'worklog-timeline';
export const BACKUP_VERSION = 1;
/** 앱 이름을 바꾸기 전에 받은 백업 파일의 app 값. 이 파일도 그대로 불러옵니다. */
const OLD_BACKUP_APPS: unknown[] = ['ai-worklog-timeline'];

export interface BackupImage {
  id: string;
  name: string;
  dataUrl: string;
}

interface BackupFile {
  app: typeof BACKUP_APP;
  version: number;
  exportedAt: string;
  settings: Settings;
  records: WorkRecord[];
  images: BackupImage[];
}

export interface ParsedBackup {
  records: WorkRecord[];
  images: Map<string, BackupImage>;
  settings: Settings;
}

export async function buildBackup(records: WorkRecord[], settings: Settings, images: Map<string, ImageEntry>): Promise<Blob> {
  const list: BackupImage[] = [];
  for (const record of records) {
    for (const ref of record.images) {
      const entry = images.get(ref.id);
      if (entry) list.push({ id: ref.id, name: entry.name, dataUrl: await blobToDataURL(await fetchImageBlob(entry.url)) });
    }
  }
  const file: BackupFile = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    // 폴더 안 파일 이름(file)은 이 PC에서만 맞는 값이라 빼고, 불러올 때 새로 정합니다
    records: records.map((r) => ({ ...r, images: r.images.map((ref) => ({ id: ref.id, label: ref.label, name: ref.name })) })),
    images: list,
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function readBackup(file: File): Promise<ParsedBackup> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('백업 파일을 읽지 못했어요. JSON 형식이 아닙니다.');
  }
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (d.app !== BACKUP_APP && !OLD_BACKUP_APPS.includes(d.app)) throw new Error('이 앱에서 받은 백업 파일이 아니에요.');
  if (typeof d.version !== 'number' || d.version > BACKUP_VERSION) throw new Error('더 새 버전에서 만든 백업이라 불러올 수 없어요.');
  const records = Array.isArray(d.records) ? d.records.map(normalizeRecord).filter((r): r is WorkRecord => !!r) : [];
  const images = new Map<string, BackupImage>();
  if (Array.isArray(d.images)) {
    for (const raw of d.images) {
      if (!raw || typeof raw !== 'object') continue;
      const img = raw as Record<string, unknown>;
      const id = typeof img.id === 'string' ? img.id : '';
      const dataUrl = typeof img.dataUrl === 'string' ? img.dataUrl : '';
      if (!id || !dataUrl.startsWith('data:')) continue;
      images.set(id, { id, name: typeof img.name === 'string' ? img.name : 'image', dataUrl });
    }
  }
  return { records, images, settings: normalizeSettings(d.settings) };
}
