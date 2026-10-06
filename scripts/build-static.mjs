// 읽기 전용 빌드에 기록과 이미지를 넣습니다.
// 데이터 폴더의 기록과 설정을 <out>/data/data.json 으로 쓰고, 이미지는 <out>/data/files/<기록 id>/ 아래에 같은 파일 이름으로 복사합니다.
// 저장소의 예시 기록(data-sample)도 <out>/sample/ 아래에 같은 모양으로 넣어, 화면의 샘플 보기에서 씁니다.
// 앱은 읽기 전용 빌드에서 저장 서버 대신 이 파일들을 읽습니다(src/lib/api.ts).
// 실행은 node scripts/build-static.mjs <out> [데이터 폴더] 로 합니다.
// 데이터 폴더를 주지 않으면 .env.local 의 WORKLOG_DATA_DIR, 그것도 없으면 프로젝트 안 data 를 씁니다.
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const [outArg, dataArg] = process.argv.slice(2);
if (!outArg) {
  console.error('사용법: node scripts/build-static.mjs <out> [데이터 폴더]');
  process.exit(1);
}

/** .env.local 에 적은 데이터 폴더 위치 */
async function envDataDir() {
  const text = await readFile(path.join(root, '.env.local'), 'utf8').catch(() => '');
  const line = text.split(/\r?\n/).find((l) => /^\s*WORKLOG_DATA_DIR\s*=/.test(l));
  return line ? line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') : '';
}

const warnings = [];

/**
 * 데이터 폴더 하나를 outDir 에 넣고, 넣은 기록과 이미지 수를 글로 돌려줍니다.
 * 기록과 설정은 data.json 으로 쓰고, 이미지는 files/<기록 id>/ 아래에 같은 파일 이름으로 복사합니다.
 */
async function writeBundle(dataDir, outDir) {
  const recordsDir = path.join(dataDir, 'records');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const records = [];
  let imageCount = 0;
  let imageBytes = 0;
  for (const folder of (await readdir(recordsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    let record;
    try {
      record = JSON.parse(await readFile(path.join(recordsDir, folder, 'record.json'), 'utf8'));
    } catch (err) {
      warnings.push(`${path.basename(dataDir)}/${folder}: record.json 을 읽지 못해 뺐어요. (${err.message})`);
      continue;
    }
    for (const image of record.images ?? []) {
      if (!image.file) continue;
      const target = path.join(outDir, 'files', record.id, image.file);
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(path.join(recordsDir, folder, image.file), target);
        imageCount += 1;
        imageBytes += (await stat(target)).size;
      } catch (err) {
        warnings.push(`${path.basename(dataDir)}/${folder}/${image.file}: 이미지를 복사하지 못했어요. (${err.message})`);
      }
    }
    records.push(record);
  }

  const settings = JSON.parse(await readFile(path.join(dataDir, 'settings.json'), 'utf8').catch(() => 'null'));
  // 저장 서버의 /api/data 응답과 같은 모양으로 씁니다
  await writeFile(path.join(outDir, 'data.json'), JSON.stringify({ dataDir: '', initialized: true, settings, records, problems: [] }));
  return `기록 ${records.length}개, 이미지 ${imageCount}장(${(imageBytes / 1024 / 1024).toFixed(1)}MB)`;
}

const mineDir = path.resolve(root, outArg, 'data');
const sampleDir = path.resolve(root, outArg, 'sample');
const mine = await writeBundle(path.resolve(root, dataArg || (await envDataDir()) || 'data'), mineDir);
const sample = await writeBundle(path.join(root, 'data-sample'), sampleDir);

for (const warning of warnings) console.warn(`  주의: ${warning}`);
console.log(`  읽기 전용 빌드에 ${mine}을 넣었어요: ${path.relative(root, mineDir)}`);
console.log(`  샘플 보기용 예시 ${sample}도 넣었어요: ${path.relative(root, sampleDir)}`);
