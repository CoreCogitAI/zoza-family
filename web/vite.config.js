import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['viem'] },
  server: { proxy: { '/api': 'http://127.0.0.1:8790' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
