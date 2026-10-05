import { normalizeRecord, normalizeSettings } from './normalize';
import type { ImageRef, Settings, WorkRecord } from './types';

/*
 * 저장 서버(개발 서버에 붙은 /api)와 주고받는 함수.
 * 기록과 이미지는 서버가 데이터 폴더에 파일로 저장합니다.
 */

/** 새로 넣는 이미지: 이미지 id 와 데이터 URL */
export interface Upload {
  id: string;
  dataUrl: string;
}

export interface RecordPayload {
  record: WorkRecord;
  uploads: Upload[];
}

export interface Problem {
  folder: string;
  message: string;
}

export interface DataSnapshot {
  dataDir: string;
  initialized: boolean;
  settings: Settings | null;
  records: WorkRecord[];
  problems: Problem[];
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const write = method !== 'GET';
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: write ? { 'Content-Type': 'application/json', 'X-Worklog': '1' } : undefined,
      body: write ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new Error('저장 서버에 연결하지 못했어요. 서버가 켜져 있는지 확인해 주세요.');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // 아래에서 상태 코드로 알립니다
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new Error(typeof message === 'string' ? message : `저장 서버가 요청을 처리하지 못했어요. (${res.status})`);
  }
  if (data === null) throw new Error('저장 서버의 응답을 읽지 못했어요. 서버를 다시 켜 보세요.');
  return data as T;
}

function parseSnapshot(raw: unknown): DataSnapshot {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    dataDir: typeof d.dataDir === 'string' ? d.dataDir : '',
    initialized: d.initialized === true,
    settings: d.settings ? normalizeSettings(d.settings) : null,
    records: Array.isArray(d.records) ? d.records.map(normalizeRecord).filter((r): r is WorkRecord => !!r) : [],
    problems: Array.isArray(d.problems)
      ? d.problems.filter((p): p is Problem => !!p && typeof p.folder === 'string' && typeof p.message === 'string')
      : [],
  };
}

function savedRecord(raw: { record?: unknown }): WorkRecord {
  const record = normalizeRecord(raw.record);
  if (!record) throw new Error('저장한 기록을 다시 읽지 못했어요. 새로고침해 주세요.');
  return record;
}

export const api = {
  load: async () => parseSnapshot(await call<unknown>('GET', '/api/data')),

  /** 데이터 폴더가 비어 있을 때만 들어갑니다. 다른 탭이 먼저 채웠으면 applied 가 false 입니다. */
  init: async (settings: Settings, records: RecordPayload[]) => {
    const res = await call<{ applied?: unknown; failed?: unknown; data?: unknown }>('POST', '/api/init', { settings, records });
    return {
      applied: res.applied === true,
      failed: Array.isArray(res.failed) ? res.failed.filter((f): f is string => typeof f === 'string') : [],
      data: parseSnapshot(res.data),
    };
  },

  /** data-sample 폴더의 예시 기록을 넣습니다. initial 이면 비어 있는 데이터 폴더에만 예시 설정과 함께 넣습니다. */
  addSamples: async (options: { initial?: boolean; today: string; toolId?: string | null }) => {
    const res = await call<{ applied?: unknown; records?: unknown; data?: unknown }>('POST', '/api/samples', options);
    return {
      applied: res.applied === true,
      records: Array.isArray(res.records) ? res.records.map(normalizeRecord).filter((r): r is WorkRecord => !!r) : [],
      data: parseSnapshot(res.data),
    };
  },

  /**
   * Word 미리보기와 같은 HTML 을 저장 서버가 이 PC의 Chrome 이나 Edge 로 인쇄해 PDF 로 돌려줍니다.
   * 서버에 쓸 브라우저가 없으면 null 입니다(화면이 인쇄 창으로 대신 엽니다).
   */
  pdf: async (html: string): Promise<Blob | null> => {
    let res: Response;
    try {
      res = await fetch('/api/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Worklog': '1' },
        body: JSON.stringify({ html }),
        cache: 'no-store',
      });
    } catch {
      throw new Error('저장 서버에 연결하지 못했어요. 서버가 켜져 있는지 확인해 주세요.');
    }
    if (res.status === 501) return null;
    if (!res.ok) {
      let message = '';
      try {
        message = String(((await res.json()) as { error?: unknown }).error ?? '');
      } catch {
        // 아래 기본 문구로 알립니다
      }
      throw new Error(message || `PDF를 만들지 못했어요. (${res.status})`);
    }
    return res.blob();
  },

  saveRecord: async (payload: RecordPayload) =>
    savedRecord(await call<{ record?: unknown }>('PUT', `/api/records/${encodeURIComponent(payload.record.id)}`, payload)),

  /** 기록 폴더를 trash 로 옮깁니다 */
  deleteRecords: async (ids: string[]) => {
    const res = await call<{ deleted?: unknown }>('POST', '/api/records/delete', { ids });
    return Array.isArray(res.deleted) ? res.deleted.filter((id): id is string => typeof id === 'string') : [];
  },

  saveSettings: async (settings: Settings) => normalizeSettings((await call<{ settings?: unknown }>('PUT', '/api/settings', settings)).settings),

  /** records 폴더를 통째로 trash 로 옮깁니다 */
  reset: () => call<{ trash: string | null }>('POST', '/api/reset'),

  openFolder: () => call<{ ok: boolean }>('POST', '/api/open-folder'),
};

/** 화면에 띄울 이미지 주소. 이미지 id 를 붙여서, 같은 파일 이름에 다른 이미지가 들어와도 예전 그림이 보이지 않게 합니다. */
export function imageUrl(recordId: string, ref: ImageRef): string | null {
  if (!ref.file) return null;
  return `/api/files/${encodeURIComponent(recordId)}/${encodeURIComponent(ref.file)}?v=${encodeURIComponent(ref.id)}`;
}
