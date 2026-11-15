import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 同一份程式碼建置成兩個網站（見 src/app/portal.ts）：
//   vite build --mode customer  →  dist-customer（客戶入口）
//   vite build --mode admin     →  dist-admin（管理後台）
//   vite build                  →  dist（合併主控台，開發與測試用）
// base: './' 讓建置結果使用相對路徑，可直接由靜態主機或 file:// 開啟
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  build: {
    outDir: mode === 'customer' ? 'dist-customer' : mode === 'admin' ? 'dist-admin' : 'dist',
    chunkSizeWarningLimit: 1700,
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
}));
