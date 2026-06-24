import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone browser preview of the renderer (mocked window.api).
// NOT used by the Electron build — that uses electron.vite.config.ts.
export default defineConfig({
  root: resolve(__dirname, 'preview'),
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [resolve(__dirname)] }
  }
})
