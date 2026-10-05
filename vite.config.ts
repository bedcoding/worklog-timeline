import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { worklogStorage } from './server/plugin.ts';

// 기록과 이미지는 데이터 폴더(기본: 프로젝트 안 data)에 파일로 저장하고, 개발 서버가 읽기와 쓰기를 맡습니다.
// 서버는 이 PC(localhost)에서만 접속됩니다. 서버 두 개가 같은 폴더에 쓰지 않도록 포트를 고정합니다.
// 다른 출처와 주고받을 일이 없어서 CORS 를 끕니다. 켜 두면 Vite 가 저장 기능보다 먼저 다른 localhost 페이지의 요청을 허락합니다.
export default defineConfig({
  plugins: [react(), worklogStorage()],
  server: { port: 5173, strictPort: true, cors: false },
  preview: { port: 4173, strictPort: true, cors: false },
});
