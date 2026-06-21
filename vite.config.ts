import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  // Served from '/' locally; the GitHub Pages workflow sets GH_PAGES_BASE to './'
  // (relative) so built asset URLs resolve under both the github.io repo subpath
  // and a custom domain root.
  base: process.env.GH_PAGES_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 51800,
  },
})
