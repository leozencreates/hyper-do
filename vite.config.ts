import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import { version } from './package.json'

// Electron (masaüstü) yapılandırması
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        // electron-updater is CommonJS with dynamic requires (NSIS / macOS updaters, electron itself): it must stay a
        // runtime dependency loaded from node_modules (electron-builder packs `dependencies`), not be bundled into main.js.
        vite: { build: { rolldownOptions: { external: ['electron-updater'] } } }, // Vite 8 = rolldown (rollupOptions is ignored)
      },
      preload: { input: 'electron/preload.ts' },
    }),
  ],
})
