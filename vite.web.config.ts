import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { version } from './package.json'

// Web / PWA yapılandırması (iPhone, iPad, Mac Safari, herhangi bir tarayıcı)
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react()],
  build: { outDir: 'dist-web' },
  server: { host: true, port: 5180 },
})
