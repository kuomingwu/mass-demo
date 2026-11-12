import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' 讓建置結果使用相對路徑，可直接由靜態主機或 file:// 開啟
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1700,
  },
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
});
