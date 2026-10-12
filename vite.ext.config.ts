import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Chrome extension (Manifest V3) build: popup + full-page app + background service worker → dist-ext/
function copyManifest(): Plugin {
  return {
    name: 'hyperdo-copy-manifest',
    closeBundle() {
      const out = path.resolve('dist-ext')
      fs.mkdirSync(out, { recursive: true })
      fs.copyFileSync(path.resolve('extension/manifest.json'), path.join(out, 'manifest.json'))
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), copyManifest()],
  build: {
    outDir: 'dist-ext',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve('index.html'),
        popup: path.resolve('popup.html'),
        background: path.resolve('extension/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
})
