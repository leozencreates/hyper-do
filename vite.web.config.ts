import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

// Web / PWA yapılandırması (iPhone, iPad, Mac Safari, herhangi bir tarayıcı)
// + the Telegram Mini App entry (tg.html → dist-web/tg.html, served by the desktop app, Phase D)
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  build: {
    outDir: 'dist-web',
    // Vite 8 = rolldown; `rollupOptions` is only a deprecated alias
    rolldownOptions: { input: { index: 'index.html', tg: 'tg.html' } },
  },
  server: { host: true, port: 5180 },
})
