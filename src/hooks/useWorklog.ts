import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, imageUrl, type DataSnapshot, type Problem, type RecordPayload, type Upload } from '../lib/api';
import { buildBackup, readBackup, type ParsedBackup } from '../lib/backup';
import { todayISO } from '../lib/dates';
import { blobToDataURL, checkDecodable, validateImage } from '../lib/images';
import { legacyPayloads, markLegacyMigrated, readLegacy } from '../lib/legacy';
import { READ_ONLY } from '../lib/mode';
import type { ImageEntry, ImageRef, RecordDraft, Settings, WorkRecord } from '../lib/types';
import { uid } from '../lib/util';

export const DEFAULT_SETTINGS: Settings = {
  team: '',
  author: '',
  tools: [{ id: 'claude-team-premium', name: 'Claude Team Premium', seat: '', note: '' }],
};

export type LoadStatus = 'loading' | 'ready' | 'error';

interface State {
  status: LoadStatus;
  error: string | null;
  records: WorkRecord[];
  settings: Settings;
  /** 기록을 저장하는 폴더의 실제 경로 */
  dataDir: string;
  /** 데이터 폴더에서 읽지 못한 기록 폴더 */
  problems: Problem[];
  /** 이 브라우저의 예전 저장소에 남아 있고 아직 데이터 폴더로 옮기지 않은 기록 수 */
  legacyPending: number;
  /** 처음 열 때 한 번 알릴 말 */
  notice: string | null;
}

export interface ActionResult {
  errors: string[];
}

const sortRecords = (records: WorkRecord[]) =>
  [...records].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 기록에 붙은 이미지를 id 로 찾을 수 있게 모읍니다 */
function entriesOf(records: WorkRecord[]): Map<string, ImageEntry> {
  const map = new Map<string, ImageEntry>();
  for (const record of records) {
    for (const ref of record.images) {
      const url = imageUrl(record.id, ref);
      if (url) map.set(ref.id, { id: ref.id, name: ref.name, url });
    }
  }
  return map;
}

/** 비어 있는 팀명과 작성자는 채우고, 없는 도구는 더합니다 */
function mergeSettings(current: Settings, other: Settings): Settings {
  const known = new Set(current.tools.map((t) => t.id));
  const merged: Settings = {
    team: current.team || other.team,
    author: current.author || other.author,
    tools: [...current.tools, ...other.tools.filter((t) => !known.has(t.id))],
  };
  const periods = { ...other.periods, ...current.periods };
  if (Object.keys(periods).length) merged.periods = periods;
  return merged;
}

const sameSettings = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);

/** 파일을 검사하고 저장 서버로 보낼 형태로 바꿉니다. 문제가 있는 파일은 건너뛰고 이유를 모읍니다. */
async function prepareImages(files: File[], startIndex: number): Promise<{ uploads: Upload[]; refs: ImageRef[]; errors: string[] }> {
  const uploads: Upload[] = [];
  const refs: ImageRef[] = [];
  const errors: string[] = [];
  for (const file of files) {
    const problem = validateImage(file);
    if (problem) {
      errors.push(`${file.name || '이미지'}: ${problem}`);
      continue;
    }
    if (!(await checkDecodable(file))) {
      errors.push(`${file.name || '이미지'}: 이미지를 열 수 없어요.`);
      continue;
    }
    const id = uid();
    uploads.push({ id, dataUrl: await blobToDataURL(file) });
    refs.push({ id, name: file.name || `image-${startIndex + refs.length + 1}.png`, label: `증빙 ${startIndex + refs.length + 1}` });
  }
  return { uploads, refs, errors };
}

/** 백업 파일의 기록 한 건을 저장 서버로 보낼 모양으로 바꿉니다. 이미지가 빠진 참조는 뺍니다. */
function backupPayload(backup: ParsedBackup, record: WorkRecord): RecordPayload {
  const refs = record.images.filter((ref) => backup.images.has(ref.id));
  return {
    record: { ...record, images: refs.map((ref) => ({ id: ref.id, label: ref.label, name: ref.name })) },
    uploads: refs.map((ref) => ({ id: ref.id, dataUrl: backup.images.get(ref.id)!.dataUrl })),
  };
}

interface InitResult {
  data: DataSnapshot;
  legacyPending: number;
  notice: string | null;
}

// React 개발 모드(StrictMode)는 effect를 두 번 실행합니다. 첫 실행 준비(예시 넣기, 예전 기록 옮기기)가
// 두 번 일어나지 않도록 약속(Promise) 하나를 같이 씁니다.
let initPromise: Promise<InitResult> | null = null;

function initialize(): Promise<InitResult> {
  if (!initPromise) {
    initPromise = (async () => {
      let data = await api.load();
      // 읽기 전용 빌드는 빌드에 넣은 기록만 보여 주므로 예시 넣기와 예전 기록 옮기기를 건너뜁니다
      if (READ_ONLY) return { data, legacyPending: 0, notice: null };
      const legacy = await readLegacy();
      let migrated = !legacy || legacy.migrated;
      let notice: string | null = null;
      if (!data.initialized) {
        if (legacy && !legacy.migrated && legacy.records.length) {
          // 예전 버전에서 쓰던 기록이 이 브라우저에 있으면 예시 대신 그 기록으로 데이터 폴더를 채웁니다
          const res = await api.init(legacy.settings ?? DEFAULT_SETTINGS, await legacyPayloads(legacy, legacy.records));
          data = res.data;
          if (res.applied) {
            await markLegacyMigrated();
            migrated = true;
            notice = `이 브라우저에 있던 기록 ${legacy.records.length - res.failed.length}개를 데이터 폴더로 옮겼어요.`;
            if (res.failed.length) notice += ` 옮기지 못한 기록이 ${res.failed.length}개 있어요. ${res.failed[0]}`;
          }
        } else {
          try {
            // 처음 열면 data-sample 폴더의 예시를 복사해 넣습니다
            data = (await api.addSamples({ initial: true, today: todayISO() })).data;
          } catch {
            // 예시 폴더가 없으면 빈 데이터 폴더로 시작합니다
            data = (await api.init(DEFAULT_SETTINGS, [])).data;
          }
        }
      }
      const known = new Set(data.records.map((r) => r.id));
      // 예시 기록은 어디서 열어도 같은 내용이라 옮길 대상에서 뺍니다
      const legacyPending = legacy && !migrated ? legacy.records.filter((r) => !r.sample && !known.has(r.id)).length : 0;
      return { data, legacyPending, notice };
    })();
    initPromise.catch(() => {
      initPromise = null;
    });
  }
  return initPromise;
}

export function useWorklog() {
  const [state, setState] = useState<State>({
    status: 'loading',
    error: null,
    records: [],
    settings: DEFAULT_SETTINGS,
    dataDir: '',
    problems: [],
    legacyPending: 0,
    notice: null,
  });
  // 비동기 작업이 항상 최신 상태를 읽도록 상태 변경은 commit 으로만 합니다
  const ref = useRef(state);

  const commit = useCallback((updater: (s: State) => State) => {
    const next = updater(ref.current);
    ref.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    let alive = true;
    initialize()
      .then(({ data, legacyPending, notice }) => {
        if (!alive) return;
        commit(() => ({
          status: 'ready',
          error: null,
          records: sortRecords(data.records),
          settings: data.settings ?? DEFAULT_SETTINGS,
          dataDir: data.dataDir,
          problems: data.problems,
          legacyPending,
          notice,
        }));
      })
      .catch((e: unknown) => {
        if (!alive) return;
        commit((s) => ({ ...s, status: 'error', error: errorText(e) }));
      });
    return () => {
      alive = false;
    };
  }, [commit]);

  const images = useMemo(() => entriesOf(state.records), [state.records]);

  const find = (id: string) => {
    const record = ref.current.records.find((r) => r.id === id);
    if (!record) throw new Error('기록을 찾지 못했어요. 새로고침 후 다시 시도해 주세요.');
    return record;
  };

  const putRecord = useCallback(
    (saved: WorkRecord) =>
      commit((s) => ({
        ...s,
        records: sortRecords(s.records.some((r) => r.id === saved.id) ? s.records.map((r) => (r.id === saved.id ? saved : r)) : [...s.records, saved]),
      })),
    [commit],
  );

  /** 데이터 폴더를 다시 읽습니다. 폴더를 직접 고쳤거나, 여러 건을 저장하다 멈췄을 때 화면을 맞춥니다. */
  const refresh = useCallback(async () => {
    const data = await api.load();
    commit((s) => ({
      ...s,
      status: 'ready',
      error: null,
      records: sortRecords(data.records),
      settings: data.settings ?? s.settings,
      dataDir: data.dataDir,
      problems: data.problems,
    }));
  }, [commit]);

  const addRecord = useCallback(
    async (draft: RecordDraft, files: File[]): Promise<ActionResult & { record: WorkRecord }> => {
      const prepared = await prepareImages(files, 0);
      const now = Date.now();
      const record: WorkRecord = { id: uid(), ...draft, images: prepared.refs, sample: false, createdAt: now, updatedAt: now };
      const saved = await api.saveRecord({ record, uploads: prepared.uploads });
      putRecord(saved);
      return { record: saved, errors: prepared.errors };
    },
    [putRecord],
  );

  const updateRecord = useCallback(
    async (id: string, draft: RecordDraft, files: File[], removedImageIds: string[]): Promise<ActionResult & { record: WorkRecord }> => {
      const current = find(id);
      const keep = current.images.filter((i) => !removedImageIds.includes(i.id));
      const prepared = await prepareImages(files, keep.length);
      const record: WorkRecord = { ...current, ...draft, images: [...keep, ...prepared.refs], updatedAt: Date.now() };
      const saved = await api.saveRecord({ record, uploads: prepared.uploads });
      putRecord(saved);
      return { record: saved, errors: prepared.errors };
    },
    [putRecord],
  );

  const deleteRecord = useCallback(
    async (id: string) => {
      await api.deleteRecords([find(id).id]);
      commit((s) => ({ ...s, records: s.records.filter((r) => r.id !== id) }));
    },
    [commit],
  );

  /** 체크한 기록을 한꺼번에 trash 로 옮기고, 옮긴 개수를 돌려줍니다 */
  const deleteRecords = useCallback(
    async (ids: string[]) => {
      const known = new Set(ref.current.records.map((r) => r.id));
      const targets = ids.filter((id) => known.has(id));
      if (!targets.length) return 0;
      try {
        await api.deleteRecords(targets);
      } catch (err) {
        // 여러 개를 옮기다 멈췄으면 데이터 폴더에 실제로 남은 만큼 화면을 맞춥니다
        await refresh().catch(() => undefined);
        throw err;
      }
      const gone = new Set(targets);
      commit((s) => ({ ...s, records: s.records.filter((r) => !gone.has(r.id)) }));
      return targets.length;
    },
    [commit, refresh],
  );

  const addImages = useCallback(
    async (id: string, files: File[]): Promise<ActionResult & { added: number }> => {
      const current = find(id);
      const prepared = await prepareImages(files, current.images.length);
      if (!prepared.refs.length) return { added: 0, errors: prepared.errors };
      const record: WorkRecord = { ...current, images: [...current.images, ...prepared.refs], updatedAt: Date.now() };
      putRecord(await api.saveRecord({ record, uploads: prepared.uploads }));
      return { added: prepared.refs.length, errors: prepared.errors };
    },
    [putRecord],
  );

  const removeImage = useCallback(
    async (id: string, imageId: string) => {
      const current = find(id);
      const record: WorkRecord = { ...current, images: current.images.filter((i) => i.id !== imageId), updatedAt: Date.now() };
      putRecord(await api.saveRecord({ record, uploads: [] }));
    },
    [putRecord],
  );

  const saveSettings = useCallback(
    async (settings: Settings) => {
      const saved = await api.saveSettings(settings);
      commit((s) => ({ ...s, settings: saved }));
    },
    [commit],
  );

  const insertSamples = useCallback(async () => {
    const { records } = await api.addSamples({ today: todayISO(), toolId: ref.current.settings.tools[0]?.id ?? null });
    commit((s) => ({ ...s, records: sortRecords([...s.records, ...records]) }));
  }, [commit]);

  const clearSamples = useCallback(async () => {
    const ids = ref.current.records.filter((r) => r.sample).map((r) => r.id);
    if (!ids.length) return 0;
    await api.deleteRecords(ids);
    const gone = new Set(ids);
    commit((s) => ({ ...s, records: s.records.filter((r) => !gone.has(r.id)) }));
    return ids.length;
  }, [commit]);

  const clearAll = useCallback(async () => {
    await api.reset();
    commit((s) => ({ ...s, records: [], problems: [] }));
  }, [commit]);

  const exportBackup = useCallback(() => buildBackup(ref.current.records, ref.current.settings, entriesOf(ref.current.records)), []);

  const importBackup = useCallback(
    async (file: File, mode: 'merge' | 'replace'): Promise<{ added: number; skipped: number }> => {
      const backup = await readBackup(file);
      try {
        if (mode === 'replace') {
          await api.reset();
          const saved: WorkRecord[] = [];
          for (const record of backup.records) saved.push(await api.saveRecord(backupPayload(backup, record)));
          const hasSettings = backup.settings.tools.length > 0 || !!backup.settings.team || !!backup.settings.author;
          const settings = hasSettings ? await api.saveSettings(backup.settings) : ref.current.settings;
          commit((s) => ({ ...s, records: sortRecords(saved), settings, problems: [] }));
          return { added: saved.length, skipped: 0 };
        }
        const existing = new Set(ref.current.records.map((r) => r.id));
        const fresh = backup.records.filter((r) => !existing.has(r.id));
        const saved: WorkRecord[] = [];
        for (const record of fresh) saved.push(await api.saveRecord(backupPayload(backup, record)));
        const merged = mergeSettings(ref.current.settings, backup.settings);
        const settings = sameSettings(merged, ref.current.settings) ? ref.current.settings : await api.saveSettings(merged);
        commit((s) => ({ ...s, records: sortRecords([...s.records, ...saved]), settings }));
        return { added: saved.length, skipped: backup.records.length - fresh.length };
      } catch (err) {
        // 여러 건을 저장하다 멈췄으면 데이터 폴더에 실제로 들어간 만큼 화면을 맞춥니다
        await refresh().catch(() => undefined);
        throw err;
      }
    },
    [commit, refresh],
  );

  /** 이 브라우저의 예전 저장소에 남은 기록을 데이터 폴더로 옮깁니다. 예전 저장소는 지우지 않습니다. */
  const migrateLegacy = useCallback(async () => {
    const legacy = await readLegacy();
    if (!legacy) {
      commit((s) => ({ ...s, legacyPending: 0 }));
      return 0;
    }
    const known = new Set(ref.current.records.map((r) => r.id));
    const pending = legacy.records.filter((r) => !r.sample && !known.has(r.id));
    const saved: WorkRecord[] = [];
    try {
      for (const payload of await legacyPayloads(legacy, pending)) saved.push(await api.saveRecord(payload));
    } catch (err) {
      await refresh().catch(() => undefined);
      throw err;
    }
    let settings = ref.current.settings;
    if (legacy.settings) {
      const merged = mergeSettings(settings, legacy.settings);
      if (!sameSettings(merged, settings)) settings = await api.saveSettings(merged);
    }
    await markLegacyMigrated();
    commit((s) => ({ ...s, records: sortRecords([...s.records, ...saved]), settings, legacyPending: 0 }));
    return saved.length;
  }, [commit, refresh]);

  const dismissLegacy = useCallback(() => commit((s) => ({ ...s, legacyPending: 0 })), [commit]);
  const clearNotice = useCallback(() => commit((s) => ({ ...s, notice: null })), [commit]);
  const openFolder = useCallback(async () => {
    await api.openFolder();
  }, []);

  return {
    ...state,
    images,
    refresh,
    addRecord,
    updateRecord,
    deleteRecord,
    deleteRecords,
    addImages,
    removeImage,
    saveSettings,
    insertSamples,
    clearSamples,
    clearAll,
    exportBackup,
    importBackup,
    migrateLegacy,
    dismissLegacy,
    clearNotice,
    openFolder,
  };
}

export type WorklogStore = ReturnType<typeof useWorklog>;
