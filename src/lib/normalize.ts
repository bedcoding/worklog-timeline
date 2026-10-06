import { isValidISO } from './dates.ts';
import type { ImageRef, PlainVersion, ReportField, Settings, Tool, WorkRecord } from './types.ts';
import { isWorkType } from './workTypes.ts';

/*
 * 바깥에서 들어온 값(record.json, settings.json, 백업 파일, 서버 응답)을 앱이 쓰는 모양으로 맞춥니다.
 * 브라우저와 저장 서버가 같이 씁니다. 그래서 브라우저 전용 기능을 쓰지 않습니다.
 * 서버 설정(vite.config.ts)이 이 파일과 dates.ts, workTypes.ts 를 바로 불러오므로 이 셋은 import 에 .ts 를 붙입니다.
 */

/** 기록과 이미지 id 에 쓸 수 있는 문자. 폴더와 파일 이름에 들어가므로 좁게 잡습니다. */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** 데이터 폴더 안 이미지 파일 이름: 1.png, 2.jpg ... */
export const SAFE_IMAGE_FILE = /^\d{1,6}\.(png|jpg|webp|gif|svg)$/;

/** 보고서에서 고쳐 쓸 수 있는 칸 */
const REPORT_FIELD_KEYS: ReportField[] = ['tools', 'outputs', 'effects', 'opinion', 'attachments'];

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

function normalizeTool(raw: unknown): Tool | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const id = str(t.id);
  const name = str(t.name).trim();
  if (!id || !name) return null;
  return { id, name, seat: str(t.seat), note: str(t.note) };
}

/** 고쳐 쓴 보고 분기는 최근 것부터 이만큼만 남깁니다 */
const MAX_PERIODS = 50;

export function normalizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tools = Array.isArray(s.tools) ? s.tools.map(normalizeTool).filter((t): t is Tool => !!t) : [];
  const periods: Record<string, string> = {};
  if (s.periods && typeof s.periods === 'object' && !Array.isArray(s.periods)) {
    for (const [key, value] of Object.entries(s.periods as Record<string, unknown>).slice(-MAX_PERIODS)) {
      if (key.length <= 100 && typeof value === 'string' && value.trim() && value.length <= 200) periods[key] = value;
    }
  }
  const reportEdits: NonNullable<Settings['reportEdits']> = {};
  if (s.reportEdits && typeof s.reportEdits === 'object' && !Array.isArray(s.reportEdits)) {
    for (const [key, value] of Object.entries(s.reportEdits as Record<string, unknown>).slice(-MAX_PERIODS)) {
      if (key.length > 100 || !value || typeof value !== 'object') continue;
      const fields: Partial<Record<ReportField, string>> = {};
      for (const field of REPORT_FIELD_KEYS) {
        const text = (value as Record<string, unknown>)[field];
        if (typeof text === 'string' && text.trim() && text.length <= 4000) fields[field] = text;
      }
      if (Object.keys(fields).length) reportEdits[key] = fields;
    }
  }
  const settings: Settings = { team: str(s.team), author: str(s.author), tools };
  if (Object.keys(periods).length) settings.periods = periods;
  if (Object.keys(reportEdits).length) settings.reportEdits = reportEdits;
  return settings;
}

function normalizeImage(raw: unknown): ImageRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const i = raw as Record<string, unknown>;
  const id = str(i.id);
  if (!SAFE_ID.test(id)) return null;
  const ref: ImageRef = { id, label: str(i.label, '증빙'), name: str(i.name, 'image') };
  const file = str(i.file);
  if (SAFE_IMAGE_FILE.test(file)) ref.file = file;
  return ref;
}

/** 표 없는 버전에서 글이 있는 칸만 남깁니다. 남는 칸이 없으면 undefined */
function normalizePlain(raw: unknown): PlainVersion | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as Record<string, unknown>;
  const plain: PlainVersion = {};
  for (const key of ['title', 'description', 'effect'] as const) {
    const text = str(p[key]).trim();
    if (text) plain[key] = text;
  }
  return Object.keys(plain).length ? plain : undefined;
}

/** 쓸 수 없는 기록이면 null. 키 순서는 record.json 을 열어 볼 때 읽기 좋은 순서입니다. */
export function normalizeRecord(raw: unknown): WorkRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const title = str(r.title).trim();
  if (!SAFE_ID.test(id) || !title || !isValidISO(r.date)) return null;
  const images = Array.isArray(r.images) ? r.images.map(normalizeImage).filter((i): i is ImageRef => !!i) : [];
  const plain = normalizePlain(r.plain);
  const now = Date.now();
  return {
    id,
    date: r.date,
    title,
    type: isWorkType(r.type) ? r.type : 'etc',
    description: str(r.description),
    effect: str(r.effect),
    ...(plain ? { plain } : {}),
    toolIds: Array.isArray(r.toolIds) ? r.toolIds.filter((t): t is string => typeof t === 'string') : [],
    limitHit: r.limitHit === true,
    sample: r.sample === true,
    images,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
  };
}
