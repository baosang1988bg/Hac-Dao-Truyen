import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  // Khi dev local, proxy /api → FastAPI backend
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4444',
        changeOrigin: true,
      },
    },
  },
})
