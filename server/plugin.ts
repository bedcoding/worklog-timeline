import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { createApiHandler } from './api.ts';
import { createStorage } from './storage.ts';

/**
 * 개발 서버(npm run dev)와 미리보기 서버(npm run preview)에 기록 저장 기능을 붙입니다.
 * 데이터 폴더는 기본이 프로젝트 안 data 이고, .env.local 의 WORKLOG_DATA_DIR 로 바꿀 수 있습니다.
 * PDF 를 만들 브라우저는 Chrome, Edge 를 찾아 쓰고, .env.local 의 WORKLOG_BROWSER 로 실행 파일을 정할 수 있습니다.
 */
export function worklogStorage(): Plugin {
  let dataDir = '';
  let browser = '';
  let handler: ReturnType<typeof createApiHandler> | null = null;
  const middleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) =>
    handler ? handler(req, res, next) : next();
  const isInsideData = (file: string) => {
    const rel = path.relative(dataDir, file);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };

  return {
    name: 'worklog-storage',
    config(config, { mode }) {
      const root = path.resolve(config.root ?? process.cwd());
      const envDir = typeof config.envDir === 'string' ? path.resolve(root, config.envDir) : root;
      const env = loadEnv(mode, envDir, 'WORKLOG_');
      dataDir = path.resolve(root, env.WORKLOG_DATA_DIR?.trim() || 'data');
      browser = env.WORKLOG_BROWSER?.trim() ?? '';
      // 기록을 저장할 때마다 개발 서버가 파일 변경을 쫓지 않게 데이터 폴더는 감시에서 뺍니다
      return { server: { watch: { ignored: [isInsideData] } } };
    },
    configResolved(config) {
      const rel = path.relative(config.root, dataDir);
      const insideRoot = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      // 예시 데이터는 저장소에 들어 있는 data-sample 폴더에서 가져옵니다
      handler = createApiHandler(createStorage(dataDir, path.join(config.root, 'data-sample')), {
        dataDir,
        dataPath: insideRoot ? `/${rel.split(path.sep).join('/')}` : null,
        browser: browser || undefined,
      });
    },
    configureServer(server) {
      server.middlewares.use(middleware);
      server.httpServer?.once('listening', () => server.config.logger.info(`  데이터 폴더: ${dataDir}`));
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
