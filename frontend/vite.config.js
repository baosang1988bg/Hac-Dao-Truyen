import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tách vendor thành chunk ổn định (đổi code app không làm đổi hash vendor →
// trình duyệt/service worker giữ cache lâu hơn).
const MARKDOWN_PKGS = /[\\/]node_modules[\\/](react-markdown|remark-[^\\/]+|rehype-[^\\/]+|micromark[^\\/]*|unified|mdast-[^\\/]+|hast-[^\\/]+|unist-[^\\/]+|vfile[^\\/]*|bail|trough|is-plain-obj|devlop|decode-named-character-reference|character-entities[^\\/]*|property-information|space-separated-tokens|comma-separated-tokens|html-url-attributes|zwitch|longest-streak|markdown-table|ccount|estree-util-[^\\/]+|style-to-js|style-to-object|inline-style-parser|trim-lines|unified|extend)[\\/]/
const REACT_PKGS = /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|@remix-run[\\/]router|scheduler)[\\/]/

function manualChunks(id) {
  if (!id.includes('node_modules')) return undefined
  if (REACT_PKGS.test(id)) return 'vendor-react'
  if (/[\\/]node_modules[\\/]axios[\\/]/.test(id)) return 'vendor-axios'
  if (MARKDOWN_PKGS.test(id)) return 'vendor-markdown'
  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
  return undefined
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: { manualChunks },
    },
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
